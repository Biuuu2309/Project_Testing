from flask import Blueprint, jsonify, request

from extensions import db
from models import ActionType, Game, GamePlayer, GameResult, Player, PlayerAction
from services.roster_service import MAX_TABLE_PLAYERS, swap_roster
from services.log_service import list_game_activity_logs, list_session_activity_logs
from services.history_service import get_play_history
from services.scoring_service import calculate_game_results, compute_scores, record_action

action_types_bp = Blueprint("action_types", __name__, url_prefix="/api/action-types")
games_bp = Blueprint("games", __name__, url_prefix="/api/games")


@action_types_bp.get("")
def list_action_types():
    types = (
        ActionType.query.filter_by(is_active=True)
        .order_by(ActionType.sort_order, ActionType.id)
        .all()
    )
    return jsonify([t.to_dict() for t in types])


@games_bp.get("")
def list_games():
    status = request.args.get("status")
    query = Game.query
    if status:
        query = query.filter_by(status=status)
    games = query.order_by(Game.played_at.desc()).limit(50).all()
    return jsonify([g.to_dict() for g in games])


@games_bp.post("")
def create_game():
    data = request.get_json(silent=True) or {}
    player_ids = data.get("player_ids", [])

    if not player_ids or len(player_ids) < 2:
        return jsonify({"error": "Cần ít nhất 2 người chơi"}), 400

    if len(player_ids) > MAX_TABLE_PLAYERS:
        return jsonify({"error": f"Tối đa {MAX_TABLE_PLAYERS} người ở bàn"}), 400

    players = Player.query.filter(Player.id.in_(player_ids), Player.is_active.is_(True)).all()
    if len(players) != len(player_ids):
        return jsonify({"error": "Một hoặc nhiều người chơi không hợp lệ"}), 400

    game = Game(
        title=data.get("title"),
        player_count=len(player_ids),
        note=data.get("note"),
    )
    db.session.add(game)
    db.session.flush()

    for idx, pid in enumerate(player_ids, start=1):
        db.session.add(
            GamePlayer(game_id=game.id, player_id=pid, seat_position=idx)
        )

    db.session.commit()
    return jsonify(game.to_dict(include_players=True)), 201


@games_bp.get("/history")
def game_history():
    return jsonify(get_play_history())


@games_bp.get("/<int:game_id>/activity-logs")
def game_activity_logs(game_id):
    Game.query.get_or_404(game_id)
    return jsonify(list_game_activity_logs(game_id))


@games_bp.get("/<int:game_id>")
def get_game(game_id):
    game = Game.query.get_or_404(game_id)
    data = game.to_dict(include_players=True)
    data["actions"] = [a.to_dict() for a in game.actions]
    data["results"] = [r.to_dict() for r in game.results]
    return jsonify(data)


@games_bp.post("/<int:game_id>/actions")
def add_action(game_id):
    data = request.get_json(silent=True) or {}
    action_type_id = data.get("action_type_id")
    actor_player_id = data.get("actor_player_id")

    if not action_type_id or not actor_player_id:
        return jsonify({"error": "action_type_id và actor_player_id là bắt buộc"}), 400

    try:
        actions = record_action(
            game_id=game_id,
            action_type_id=action_type_id,
            actor_player_id=actor_player_id,
            target_player_id=data.get("target_player_id"),
            method_action_type_id=data.get("method_action_type_id"),
            note=data.get("note"),
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    scores = compute_scores(game_id)
    return jsonify({
        "actions": [a.to_dict() for a in actions],
        "scores": scores,
    }), 201


@games_bp.post("/<int:game_id>/actions/batch")
def add_actions_batch(game_id):
    data = request.get_json(silent=True) or {}
    items = data.get("actions", [])

    if not items:
        return jsonify({"error": "Danh sách hành động trống"}), 400

    created_all = []
    try:
        for item in items:
            created = record_action(
                game_id=game_id,
                action_type_id=item["action_type_id"],
                actor_player_id=item["actor_player_id"],
                target_player_id=item.get("target_player_id"),
                method_action_type_id=item.get("method_action_type_id"),
                note=item.get("note"),
            )
            created_all.extend(created)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    scores = compute_scores(game_id)
    return jsonify({
        "actions": [a.to_dict() for a in created_all],
        "scores": scores,
        "count": len(items),
    }), 201


@games_bp.get("/<int:game_id>/scores")
def get_live_scores(game_id):
    Game.query.get_or_404(game_id)
    try:
        scores = compute_scores(game_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(scores)


@games_bp.post("/<int:game_id>/calculate")
def calculate_results(game_id):
    try:
        results, _ = calculate_game_results(game_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({
        "game_id": game_id,
        "results": [r.to_dict() for r in results],
    })


@games_bp.get("/<int:game_id>/actions")
def list_game_actions(game_id):
    Game.query.get_or_404(game_id)
    actions = (
        PlayerAction.query.filter_by(game_id=game_id)
        .order_by(PlayerAction.action_order, PlayerAction.id)
        .all()
    )
    return jsonify([a.to_dict() for a in actions])


@games_bp.post("/<int:game_id>/roster/swap")
def roster_swap(game_id):
    data = request.get_json(silent=True) or {}
    exit_id = data.get("exit_player_id")
    enter_id = data.get("enter_player_id")

    if not exit_id or not enter_id:
        return jsonify({"error": "exit_player_id và enter_player_id là bắt buộc"}), 400

    try:
        swap = swap_roster(game_id, exit_id, enter_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    scores = compute_scores(game_id)
    return jsonify({"swap": swap.to_dict(), "scores": scores}), 201
