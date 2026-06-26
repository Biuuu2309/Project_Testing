from extensions import db
from models import ActionType, Game, GamePlayer, GameResult, GameRosterSwap, Player, PlayerAction
from services.log_service import log_player_action, rebuild_activity_logs
from services.point_rules import effective_base_points
from services.roster_service import get_active_player_ids

FINISH_TRANSFERS = ((1, 4, 10), (2, 3, 5))
THUI_POINTS = {
    "THUI_HEO_DEN": 5,
    "THUI_HEO_DO": 10,
    "THUI_3_DOI_THONG": 5,
    "THUI_TU_QUY": 10,
    "THUI_4_DOI_THONG": 10,
}
VE_TRANG_WHITE_GAIN = 30
VE_TRANG_OTHER_PENALTY = 10


def calculate_action_points(action_type: ActionType) -> tuple[int, int]:
    base = effective_base_points(action_type)
    if action_type.point_role == "actor_gain":
        return base, -base
    if action_type.point_role == "actor_loss":
        return base, 0
    if action_type.point_role == "target_loss":
        return 0, base
    return 0, 0


def _action_points_from_record(action: PlayerAction) -> tuple[int, int]:
    at = action.action_type
    actor_pts, target_pts = calculate_action_points(at)
    if at.point_role == "actor_gain" and action.target_player_id:
        return actor_pts, target_pts
    return action.actor_points, action.target_points


def _get_unresolved_chops(unresolved: list[dict], chopper_id: int) -> list[dict]:
    return [u for u in unresolved if u["actor_id"] == chopper_id and not u["resolved"]]


def _initial_active_set(participants: list[GamePlayer], swaps: list[GameRosterSwap]) -> set[int]:
    swap_enters = {s.enter_player_id for s in swaps}
    swap_exits = {s.exit_player_id for s in swaps}
    result: set[int] = set()
    for gp in participants:
        joined_at_start = getattr(gp, "joined_at_start", None)
        if joined_at_start is not None:
            if joined_at_start:
                result.add(gp.player_id)
        elif gp.player_id not in swap_enters or gp.player_id in swap_exits:
            result.add(gp.player_id)
    return result


def _ensure_player_totals(totals, player_names, pid, player=None):
    if pid in totals:
        return
    name = player_names.get(pid) or (player.name if player else "")
    if not name and player is None:
        p = Player.query.get(pid)
        name = p.name if p else f"#{pid}"
    totals[pid] = {
        "player_id": pid,
        "player_name": name,
        "finish": 0,
        "chat": 0,
        "penalty": 0,
        "total": 0,
        "finish_position": None,
        "is_at_table": False,
        "is_frozen": True,
    }
    player_names[pid] = name


def _add_matchup(matchups, winner_id, loser_id, points):
    if points <= 0 or winner_id == loser_id:
        return
    key = (winner_id, loser_id)
    matchups[key] = matchups.get(key, 0) + points


def _format_matchups(matchups, player_names):
    items = []
    for (winner_id, loser_id), pts in matchups.items():
        items.append({
            "winner_id": winner_id,
            "winner_name": player_names.get(winner_id, "?"),
            "loser_id": loser_id,
            "loser_name": player_names.get(loser_id, "?"),
            "points": pts,
            "label": f"{player_names.get(winner_id, '?')} thắng {player_names.get(loser_id, '?')} +{pts}",
        })
    items.sort(key=lambda x: x["points"], reverse=True)
    return items


def _rank_map(finish_state: dict[int, int | None]) -> dict[int, int]:
    return {rank: pid for pid, rank in finish_state.items() if rank}


def _effective_finish_ranks(
    finish_state: dict[int, int | None],
    nhot_players: set[int],
    player_count: int,
) -> dict[int, int]:
    """Người nhốt chưa khai báo về bài được gán hạng thấp nhất còn trống (để tính thúi heo)."""
    ranks = {pid: rank for pid, rank in finish_state.items() if rank}
    used = set(ranks.values())
    unranked_nhot = sorted(pid for pid in nhot_players if pid not in ranks)
    available = sorted(
        (r for r in range(player_count, 0, -1) if r not in used),
        reverse=True,
    )
    for pid, rank in zip(unranked_nhot, available):
        ranks[pid] = rank
    return ranks


def _apply_finish_transfers(
    finish_state,
    totals,
    matchups,
    player_names,
    action_log,
    nhot_players: set[int] | None = None,
):
    """Nhất +10 từ bốn, nhì +5 từ ba (chuyển điểm, không phạt kép). Người nhốt không bị trừ điểm hạng."""
    nhot = nhot_players or set()
    by_rank = _rank_map(finish_state)
    for winner_rank, loser_rank, pts in FINISH_TRANSFERS:
        if winner_rank not in by_rank or loser_rank not in by_rank:
            continue
        winner_id = by_rank[winner_rank]
        loser_id = by_rank[loser_rank]
        if loser_id in nhot:
            action_log.append({
                "description": (
                    f"{player_names[loser_id]} bị nhốt — không trừ điểm hạng "
                    f"(bỏ qua {player_names[winner_id]} +{pts})"
                ),
                "type": "finish_transfer_skip",
            })
            continue
        totals[winner_id]["finish"] += pts
        totals[loser_id]["finish"] -= pts
        _add_matchup(matchups, winner_id, loser_id, pts)
        action_log.append({
            "description": (
                f"{player_names[winner_id]} (hạng {winner_rank}) +{pts} "
                f"từ {player_names[loser_id]} (hạng {loser_rank})"
            ),
            "type": "finish_transfer",
        })


def _apply_end_round_penalties(
    finish_state,
    totals,
    matchups,
    player_names,
    nhot_players,
    thui_events,
    action_log,
    player_count: int,
):
    by_rank = _rank_map(finish_state)
    effective_ranks = _effective_finish_ranks(finish_state, nhot_players, player_count)
    thui_by_player = {ev["player_id"]: ev for ev in thui_events}

    if nhot_players and 1 in by_rank:
        rank1_id = by_rank[1]
        for nhot_id in nhot_players:
            thui = thui_by_player.get(nhot_id)
            extra = thui["points"] if thui else 0
            total_pts = 20 + extra
            totals[rank1_id]["penalty"] += total_pts
            totals[nhot_id]["penalty"] -= total_pts
            _add_matchup(matchups, rank1_id, nhot_id, total_pts)
            if thui:
                desc = (
                    f"{player_names[nhot_id]} bị nhốt -20, {thui['name']} -{extra} "
                    f"(tổng -{total_pts}) → {player_names[rank1_id]} (nhất) +{total_pts}"
                )
            else:
                desc = (
                    f"{player_names[nhot_id]} bị nhốt -20 → "
                    f"{player_names[rank1_id]} (nhất) +20"
                )
            action_log.append({"description": desc, "type": "end_penalty"})

    for ev in thui_events:
        thui_id = ev["player_id"]
        if thui_id in nhot_players:
            continue
        rank = effective_ranks.get(thui_id)
        if not rank or rank <= 1:
            continue
        receiver_rank = rank - 1
        receiver_rank_map = _rank_map({pid: r for pid, r in effective_ranks.items()})
        if receiver_rank not in receiver_rank_map:
            continue
        receiver_id = receiver_rank_map[receiver_rank]
        pts = ev["points"]
        totals[thui_id]["penalty"] -= pts
        totals[receiver_id]["penalty"] += pts
        _add_matchup(matchups, receiver_id, thui_id, pts)
        action_log.append({
            "description": (
                f"{player_names[thui_id]} {ev.get('name', 'thúi')} (hạng {rank}) -{pts} → "
                f"{player_names[receiver_id]} (hạng {receiver_rank}) +{pts}"
            ),
            "type": "end_penalty",
        })


def compute_scores(game_id: int, apply_end_penalties: bool = True) -> dict:
    game = Game.query.get_or_404(game_id)
    participants = GamePlayer.query.filter_by(game_id=game_id).all()
    player_names = {gp.player_id: gp.player.name for gp in participants}

    if not participants:
        raise ValueError("Ván chơi chưa có người chơi")

    swaps = GameRosterSwap.query.filter_by(game_id=game_id).order_by(
        GameRosterSwap.action_order, GameRosterSwap.id
    ).all()

    totals: dict[int, dict] = {}
    finish_state: dict[int, int | None] = {}
    unresolved: list[dict] = []
    matchups: dict[tuple[int, int], int] = {}
    nhot_players: set[int] = set()
    thui_events: list[dict] = []

    for gp in participants:
        _ensure_player_totals(totals, player_names, gp.player_id, gp.player)
        finish_state[gp.player_id] = None

    active_set = _initial_active_set(participants, swaps)

    actions = (
        PlayerAction.query.filter_by(game_id=game_id)
        .join(ActionType)
        .order_by(PlayerAction.action_order, PlayerAction.id)
        .all()
    )

    timeline: list[tuple] = []
    for s in swaps:
        timeline.append((s.action_order, 0, "swap", s))
    for a in actions:
        timeline.append((a.action_order, 1, "action", a))
    timeline.sort(key=lambda x: (x[0], x[1]))

    action_log: list[dict] = []

    for _, _, kind, item in timeline:
        if kind == "swap":
            swap: GameRosterSwap = item
            exit_id = swap.exit_player_id
            enter_id = swap.enter_player_id
            active_set.discard(exit_id)
            active_set.add(enter_id)
            enter_p = Player.query.get(enter_id)
            _ensure_player_totals(totals, player_names, enter_id, enter_p)
            if enter_id not in finish_state:
                finish_state[enter_id] = None
            action_log.append({
                "action_id": swap.id,
                "description": (
                    f"{player_names.get(exit_id)} rút khỏi bàn (đóng băng), "
                    f"{player_names.get(enter_id)} vào bàn"
                ),
                "type": "roster",
            })
            continue

        action: PlayerAction = item
        at = action.action_type
        actor_id = action.actor_player_id
        target_id = action.target_player_id
        actor_pts, target_pts = _action_points_from_record(action)

        if actor_id not in active_set:
            continue

        if at.code == "VE_TRANG":
            others = [pid for pid in active_set if pid != actor_id]
            penalty_each = VE_TRANG_OTHER_PENALTY
            totals[actor_id]["penalty"] += VE_TRANG_WHITE_GAIN
            for pid in others:
                _ensure_player_totals(totals, player_names, pid)
                totals[pid]["penalty"] -= penalty_each
                _add_matchup(matchups, actor_id, pid, penalty_each)
            action_log.append({
                "action_id": action.id,
                "description": (
                    f"{player_names[actor_id]} về trắng +{VE_TRANG_WHITE_GAIN}, "
                    f"{len(others)} người ở bàn mỗi người -{penalty_each}"
                ),
                "type": "ve_trang",
            })
            continue

        if at.code == "NHOT":
            nhot_players.add(actor_id)
            action_log.append({
                "action_id": action.id,
                "description": f"{player_names[actor_id]} bị nhốt (tính khi kết thúc ván)",
                "type": "nhot_pending",
            })
            continue

        if at.code in THUI_POINTS:
            thui_events.append({
                "player_id": actor_id,
                "points": THUI_POINTS[at.code],
                "code": at.code,
                "name": at.name,
            })
            action_log.append({
                "action_id": action.id,
                "description": f"{player_names[actor_id]} {at.name} (tính khi kết thúc ván)",
                "type": "thui_pending",
            })
            continue

        if at.category == "finish":
            pos_map = {"VE_NHAT": 1, "VE_NHI": 2, "VE_BA": 3, "VE_BON": 4}
            if at.code in pos_map:
                finish_state[actor_id] = pos_map[at.code]
                totals[actor_id]["finish_position"] = pos_map[at.code]
            action_log.append({
                "action_id": action.id,
                "description": f"{player_names[actor_id]}: {at.name}",
                "type": "finish",
            })
            continue

        if at.category == "chat" and target_id:
            if target_id not in active_set:
                continue

            inherited = _get_unresolved_chops(unresolved, target_id)

            if inherited:
                total_gain = sum(u["actor_pts"] for u in inherited)
                total_loss = sum(u["target_pts"] for u in inherited)

                for u in inherited:
                    totals[u["victim_id"]]["chat"] -= u["target_pts"]
                    totals[u["actor_id"]]["chat"] -= u["actor_pts"]
                    _add_matchup(matchups, u["victim_id"], u["actor_id"], u["actor_pts"])
                    u["resolved"] = True

                totals[actor_id]["chat"] += total_gain
                totals[target_id]["chat"] += total_loss
                _add_matchup(matchups, actor_id, target_id, total_gain)

                victims = ", ".join(
                    player_names.get(u["victim_id"], "?") for u in inherited
                )
                action_log.append({
                    "action_id": action.id,
                    "description": (
                        f"{player_names[actor_id]} chặt chồng {player_names[target_id]} "
                        f"bằng {at.name}: +{total_gain} (hoàn cho {victims})"
                    ),
                    "type": "stack",
                })
                unresolved = [u for u in unresolved if not u["resolved"]]
                continue

            totals[actor_id]["chat"] += actor_pts
            totals[target_id]["chat"] += target_pts
            _add_matchup(matchups, actor_id, target_id, actor_pts)
            unresolved.append({
                "action_id": action.id,
                "actor_id": actor_id,
                "victim_id": target_id,
                "actor_pts": actor_pts,
                "target_pts": target_pts,
                "resolved": False,
            })
            action_log.append({
                "action_id": action.id,
                "description": (
                    f"{player_names[actor_id]} {at.name} "
                    f"{player_names[target_id]} ({actor_pts:+d}/{target_pts:+d})"
                ),
                "type": "chat",
            })
            continue

        if at.category in ("penalty", "special"):
            totals[actor_id]["penalty"] += actor_pts
            action_log.append({
                "action_id": action.id,
                "description": f"{player_names[actor_id]}: {at.name} ({actor_pts:+d})",
                "type": "penalty",
            })

    _apply_finish_transfers(
        finish_state, totals, matchups, player_names, action_log, nhot_players,
    )

    if apply_end_penalties:
        _apply_end_round_penalties(
            finish_state, totals, matchups, player_names,
            nhot_players, thui_events, action_log,
            player_count=len(participants),
        )

    for pid, t in totals.items():
        t["total"] = t["finish"] + t["chat"] + t["penalty"]
        t["is_at_table"] = pid in active_set
        t["is_frozen"] = not t["is_at_table"]

    return {
        "game_id": game_id,
        "session_id": game.session_id,
        "round_number": game.round_number,
        "status": game.status,
        "active_player_ids": list(active_set),
        "scores": list(totals.values()),
        "matchups": _format_matchups(matchups, player_names),
        "actions": action_log,
    }


def record_action(
    game_id: int,
    action_type_id: int,
    actor_player_id: int,
    target_player_id: int | None = None,
    method_action_type_id: int | None = None,
    note: str | None = None,
) -> list[PlayerAction]:
    action_type = ActionType.query.get_or_404(action_type_id)
    game = Game.query.get_or_404(game_id)

    if game.status != "ongoing":
        raise ValueError("Ván chơi đã kết thúc, không thể thêm hành động")

    active_ids = get_active_player_ids(game_id)
    if actor_player_id not in active_ids:
        raise ValueError("Người thực hiện không đang ở bàn")

    if action_type.point_role == "actor_gain" and action_type.category == "chat":
        if not target_player_id:
            raise ValueError("Hành động chặt cần chọn người bị chặt")
        if target_player_id == actor_player_id:
            raise ValueError("Không thể chặt chính mình")
        if target_player_id not in active_ids:
            raise ValueError("Người bị chặt không đang ở bàn")

    last_order = (
        db.session.query(db.func.max(PlayerAction.action_order))
        .filter_by(game_id=game_id)
        .scalar()
        or 0
    )
    last_swap = (
        db.session.query(db.func.max(GameRosterSwap.action_order))
        .filter_by(game_id=game_id)
        .scalar()
        or 0
    )
    last_order = max(last_order, last_swap)

    created: list[PlayerAction] = []
    action_ids = [action_type_id]
    if method_action_type_id:
        action_ids.append(method_action_type_id)

    for idx, at_id in enumerate(action_ids):
        at = ActionType.query.get_or_404(at_id)
        actor_pts, target_pts = calculate_action_points(at)

        pa = PlayerAction(
            game_id=game_id,
            action_type_id=at_id,
            actor_player_id=actor_player_id,
            target_player_id=target_player_id,
            stack_level=1,
            actor_points=actor_pts,
            target_points=target_pts,
            note=note if idx == 0 else f"kèm {at.name}",
            action_order=last_order + idx + 1,
        )
        db.session.add(pa)
        created.append(pa)

    db.session.flush()
    for pa in created:
        log_player_action(pa)

    db.session.commit()
    return created


def calculate_game_results(game_id: int, apply_end_penalties: bool = True) -> tuple[list[GameResult], dict]:
    data = compute_scores(game_id, apply_end_penalties=apply_end_penalties)
    game = Game.query.get_or_404(game_id)

    GameResult.query.filter_by(game_id=game_id).delete()

    results = []
    for s in data["scores"]:
        result = GameResult(
            game_id=game_id,
            player_id=s["player_id"],
            finish_points=s["finish"],
            chat_points=s["chat"],
            penalty_points=s["penalty"],
            total_points=s["total"],
            finish_position=s["finish_position"],
        )
        db.session.add(result)
        results.append(result)

    participants = GamePlayer.query.filter_by(game_id=game_id).all()
    for gp in participants:
        score = next((x for x in data["scores"] if x["player_id"] == gp.player_id), None)
        if score:
            gp.finish_position = score["finish_position"]

    game.status = "completed"
    rebuild_activity_logs(game_id, data)
    from services.debt_service import apply_matchups_to_debts

    apply_matchups_to_debts(data.get("matchups", []), game_id=game_id)
    db.session.commit()
    return results, data
