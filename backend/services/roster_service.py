from extensions import db
from models import Game, GamePlayer, GameRosterSwap, Player
from services.log_service import log_roster_swap


MAX_TABLE_PLAYERS = 4


def get_active_players(game_id: int) -> list[GamePlayer]:
    return (
        GamePlayer.query.filter_by(game_id=game_id, table_status="active")
        .order_by(GamePlayer.seat_position)
        .all()
    )


def get_active_player_ids(game_id: int) -> set[int]:
    return {gp.player_id for gp in get_active_players(game_id)}


def _next_action_order(game_id: int) -> int:
    from models import PlayerAction

    last_action = (
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
    return max(last_action, last_swap) + 1


def swap_roster(game_id: int, exit_player_id: int, enter_player_id: int) -> GameRosterSwap:
    game = Game.query.get_or_404(game_id)
    if game.status != "ongoing":
        raise ValueError("Ván chơi đã kết thúc")

    if exit_player_id == enter_player_id:
        raise ValueError("Người ra và người vào phải khác nhau")

    exit_gp = GamePlayer.query.filter_by(
        game_id=game_id, player_id=exit_player_id, table_status="active"
    ).first()
    if not exit_gp:
        raise ValueError("Người rút khỏi bàn không hợp lệ hoặc không đang ở bàn")

    enter_player = Player.query.filter_by(id=enter_player_id, is_active=True).first()
    if not enter_player:
        raise ValueError("Người vào bàn không hợp lệ")

    if enter_player_id in get_active_player_ids(game_id):
        raise ValueError("Người này đang ở bàn, không thể vào lại")

    seat = exit_gp.seat_position
    exit_gp.table_status = "frozen"
    exit_gp.seat_position = None

    enter_gp = GamePlayer.query.filter_by(game_id=game_id, player_id=enter_player_id).first()
    if enter_gp:
        if enter_gp.table_status == "active":
            raise ValueError("Người này đang ở bàn")
        enter_gp.table_status = "active"
        enter_gp.seat_position = seat
    else:
        enter_gp = GamePlayer(
            game_id=game_id,
            player_id=enter_player_id,
            seat_position=seat,
            table_status="active",
            joined_at_start=False,
        )
        db.session.add(enter_gp)

    swap = GameRosterSwap(
        game_id=game_id,
        exit_player_id=exit_player_id,
        enter_player_id=enter_player_id,
        action_order=_next_action_order(game_id),
    )
    db.session.add(swap)
    exit_name = exit_gp.player.name if exit_gp.player else "?"
    enter_name = enter_player.name
    log_roster_swap(game_id, exit_name, enter_name, swap.id)
    db.session.commit()
    return swap
