from extensions import db
from models import ActivityLog, Game, PlayerAction


def _next_sort_order(game_id: int) -> int:
    last = (
        db.session.query(db.func.max(ActivityLog.sort_order))
        .filter_by(game_id=game_id)
        .scalar()
        or 0
    )
    return last + 1


def _session_id_for_game(game_id: int) -> int | None:
    game = Game.query.get(game_id)
    return game.session_id if game else None


def append_activity_log(
    game_id: int,
    event_type: str,
    description: str,
    *,
    session_id: int | None = None,
    actor_player_id: int | None = None,
    target_player_id: int | None = None,
    action_type_id: int | None = None,
    points_delta: int | None = None,
    finish_points: int | None = None,
    chat_points: int | None = None,
    penalty_points: int | None = None,
    total_points: int | None = None,
) -> ActivityLog:
    row = ActivityLog(
        session_id=session_id if session_id is not None else _session_id_for_game(game_id),
        game_id=game_id,
        event_type=event_type,
        description=description,
        actor_player_id=actor_player_id,
        target_player_id=target_player_id,
        action_type_id=action_type_id,
        points_delta=points_delta,
        finish_points=finish_points,
        chat_points=chat_points,
        penalty_points=penalty_points,
        total_points=total_points,
        sort_order=_next_sort_order(game_id),
    )
    db.session.add(row)
    return row


def log_player_action(action: PlayerAction) -> ActivityLog:
    at = action.action_type
    actor_name = action.actor.name if action.actor else "?"
    target_name = action.target.name if action.target else None
    if target_name:
        desc = f"{actor_name}: {at.name} → {target_name} ({action.actor_points:+d}/{action.target_points:+d})"
    else:
        desc = f"{actor_name}: {at.name} ({action.actor_points:+d})"
    return append_activity_log(
        action.game_id,
        at.category if at else "action",
        desc,
        actor_player_id=action.actor_player_id,
        target_player_id=action.target_player_id,
        action_type_id=action.action_type_id,
        points_delta=action.actor_points,
    )


def log_roster_swap(game_id: int, exit_name: str, enter_name: str, swap_id: int) -> ActivityLog:
    return append_activity_log(
        game_id,
        "roster",
        f"{exit_name} rút khỏi bàn, {enter_name} vào bàn",
    )


def rebuild_activity_logs(game_id: int, compute_data: dict) -> list[ActivityLog]:
    ActivityLog.query.filter_by(game_id=game_id).delete()
    session_id = compute_data.get("session_id")
    rows: list[ActivityLog] = []
    order = 0

    for entry in compute_data.get("actions", []):
        order += 1
        row = ActivityLog(
            session_id=session_id,
            game_id=game_id,
            event_type=entry.get("type", "action"),
            description=entry["description"],
            sort_order=order,
        )
        db.session.add(row)
        rows.append(row)

    for score in compute_data.get("scores", []):
        order += 1
        total = score.get("total", 0)
        row = ActivityLog(
            session_id=session_id,
            game_id=game_id,
            event_type="result",
            description=(
                f"Kết quả {score.get('player_name', '?')}: "
                f"về {score.get('finish', 0):+d}, chặt {score.get('chat', 0):+d}, "
                f"phạt {score.get('penalty', 0):+d} → tổng {total:+d}"
            ),
            actor_player_id=score.get("player_id"),
            finish_points=score.get("finish"),
            chat_points=score.get("chat"),
            penalty_points=score.get("penalty"),
            total_points=total,
            sort_order=order,
        )
        db.session.add(row)
        rows.append(row)

    return rows


def list_game_activity_logs(game_id: int) -> list[dict]:
    rows = (
        ActivityLog.query.filter_by(game_id=game_id)
        .order_by(ActivityLog.sort_order, ActivityLog.id)
        .all()
    )
    return [r.to_dict() for r in rows]


def list_session_activity_logs(session_id: int) -> list[dict]:
    rows = (
        ActivityLog.query.filter_by(session_id=session_id)
        .order_by(ActivityLog.game_id, ActivityLog.sort_order, ActivityLog.id)
        .all()
    )
    return [r.to_dict() for r in rows]
