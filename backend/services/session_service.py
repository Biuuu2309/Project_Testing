from extensions import db
from models import Game, GamePlayer, GameSession, GameSessionPlayer, Player
from utils.datetime_util import to_iso_utc


def _add_session_players(session_id: int, player_ids: list[int]) -> None:
    for idx, pid in enumerate(player_ids, start=1):
        db.session.add(
            GameSessionPlayer(
                session_id=session_id,
                player_id=pid,
                seat_position=idx,
            )
        )


def _create_round_game(session: GameSession, round_number: int, player_ids: list[int]) -> Game:
    game = Game(
        session_id=session.id,
        round_number=round_number,
        title=f"Ván {round_number}",
        player_count=len(player_ids),
    )
    db.session.add(game)
    db.session.flush()

    for idx, pid in enumerate(player_ids, start=1):
        db.session.add(
            GamePlayer(
                game_id=game.id,
                player_id=pid,
                seat_position=idx,
                table_status="active",
                joined_at_start=True,
            )
        )
    return game


def create_session(player_ids: list[int]) -> tuple[GameSession, Game]:
    session = GameSession(status="ongoing")
    db.session.add(session)
    db.session.flush()
    _add_session_players(session.id, player_ids)
    game = _create_round_game(session, 1, player_ids)
    db.session.commit()
    return session, game


def get_cumulative_scores(session_id: int) -> list[dict]:
    """Tổng điểm qua các ván đã hoàn thành trong phiên."""
    completed_games = (
        Game.query.filter_by(session_id=session_id, status="completed")
        .order_by(Game.round_number)
        .all()
    )
    totals: dict[int, dict] = {}

    for game in completed_games:
        for result in game.results:
            pid = result.player_id
            if pid not in totals:
                totals[pid] = {
                    "player_id": pid,
                    "player_name": result.player.name if result.player else "",
                    "finish": 0,
                    "chat": 0,
                    "penalty": 0,
                    "total": 0,
                    "rounds_played": 0,
                }
            t = totals[pid]
            t["finish"] += result.finish_points
            t["chat"] += result.chat_points
            t["penalty"] += result.penalty_points
            t["total"] += result.total_points
            t["rounds_played"] += 1

    return sorted(totals.values(), key=lambda x: x["total"], reverse=True)


def get_active_roster_from_game(game_id: int) -> list[int]:
    """Người đang active ở bàn sau đổi người (dùng cho ván tiếp theo)."""
    from services.roster_service import get_active_players

    return [gp.player_id for gp in get_active_players(game_id)]


def sync_session_players(session_id: int, player_ids: list[int]) -> None:
    GameSessionPlayer.query.filter_by(session_id=session_id).delete()
    _add_session_players(session_id, player_ids)


def get_session_player_ids(session_id: int) -> list[int]:
    rows = (
        GameSessionPlayer.query.filter_by(session_id=session_id)
        .order_by(GameSessionPlayer.seat_position)
        .all()
    )
    return [r.player_id for r in rows]


def list_ongoing_sessions() -> list[dict]:
    sessions = (
        GameSession.query.filter_by(status="ongoing")
        .order_by(GameSession.created_at.desc())
        .all()
    )
    items = []
    for session in sessions:
        current_game = (
            Game.query.filter_by(session_id=session.id, status="ongoing")
            .order_by(Game.round_number.desc())
            .first()
        )
        if not current_game:
            continue
        session_players = (
            GameSessionPlayer.query.filter_by(session_id=session.id)
            .order_by(GameSessionPlayer.seat_position)
            .all()
        )
        completed_rounds = (
            Game.query.filter_by(session_id=session.id, status="completed").count()
        )
        player_names = [
            sp.player.name for sp in session_players if sp.player and sp.player.name
        ]
        items.append({
            "session_id": session.id,
            "created_at": to_iso_utc(session.created_at),
            "round_number": current_game.round_number if current_game else completed_rounds,
            "current_game_id": current_game.id if current_game else None,
            "completed_rounds": completed_rounds,
            "players": [
                {
                    "player_id": sp.player_id,
                    "player_name": sp.player.name if sp.player else "",
                }
                for sp in session_players
            ],
            "player_names": player_names,
        })
    return items


def discard_ongoing_session(session_id: int) -> GameSession:
    session = GameSession.query.get(session_id)
    if not session:
        raise ValueError("Không tìm thấy phiên")
    if session.status != "ongoing":
        raise ValueError("Chỉ xóa được phiên đang dở")

    ongoing_games = Game.query.filter_by(session_id=session_id, status="ongoing").all()
    for game in ongoing_games:
        game.status = "cancelled"

    session.status = "completed"
    db.session.commit()
    return session


def start_next_round(session: GameSession, previous_game_id: int | None = None) -> Game:
    if previous_game_id:
        player_ids = get_active_roster_from_game(previous_game_id)
        if len(player_ids) < 2:
            player_ids = get_session_player_ids(session.id)
        sync_session_players(session.id, player_ids)
    else:
        player_ids = get_session_player_ids(session.id)

    last_round = (
        db.session.query(db.func.max(Game.round_number))
        .filter_by(session_id=session.id)
        .scalar()
        or 0
    )
    game = _create_round_game(session, last_round + 1, player_ids)
    db.session.commit()
    return game
