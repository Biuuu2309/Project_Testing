from flask import Blueprint, jsonify, request

from extensions import db
from models import Game, GameSession, Player
from services.roster_service import MAX_TABLE_PLAYERS
from services.scoring_service import calculate_game_results, compute_scores
from services.session_service import (
    create_session,
    discard_ongoing_session,
    get_cumulative_scores,
    list_ongoing_sessions,
    start_next_round,
)

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


@sessions_bp.post("")
def start_session():
    data = request.get_json(silent=True) or {}
    player_ids = data.get("player_ids", [])

    if not player_ids or len(player_ids) < 2:
        return jsonify({"error": "Cần ít nhất 2 người chơi"}), 400
    if len(player_ids) > MAX_TABLE_PLAYERS:
        return jsonify({"error": f"Tối đa {MAX_TABLE_PLAYERS} người ở bàn"}), 400

    players = Player.query.filter(Player.id.in_(player_ids), Player.is_active.is_(True)).all()
    if len(players) != len(player_ids):
        return jsonify({"error": "Một hoặc nhiều người chơi không hợp lệ"}), 400

    session, game = create_session(player_ids)
    return jsonify({
        "session": session.to_dict(),
        "game": game.to_dict(include_players=True),
        "round_number": 1,
        "cumulative_scores": [],
    }), 201


@sessions_bp.get("/ongoing")
def ongoing_sessions():
    return jsonify(list_ongoing_sessions())


@sessions_bp.get("/<int:session_id>")
def get_session(session_id):
    session = GameSession.query.get_or_404(session_id)
    current_game = (
        Game.query.filter_by(session_id=session_id, status="ongoing")
        .order_by(Game.round_number.desc())
        .first()
    )
    scores = None
    if current_game:
        try:
            scores = compute_scores(current_game.id)
        except ValueError:
            scores = None
    return jsonify({
        "session": session.to_dict(),
        "current_game": current_game.to_dict(include_players=True) if current_game else None,
        "cumulative_scores": get_cumulative_scores(session_id),
        "round_number": current_game.round_number if current_game else None,
        "scores": scores,
    })


@sessions_bp.delete("/<int:session_id>")
def delete_ongoing_session(session_id):
    try:
        session = discard_ongoing_session(session_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"message": "Đã xóa phiên", "session": session.to_dict()})


@sessions_bp.post("/<int:session_id>/complete-round")
def complete_round(session_id):
    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")

    session = GameSession.query.get_or_404(session_id)
    if session.status != "ongoing":
        return jsonify({"error": "Phiên đã kết thúc"}), 400

    game = Game.query.filter_by(id=game_id, session_id=session_id).first_or_404()
    if game.status != "ongoing":
        return jsonify({"error": "Ván này đã kết thúc"}), 400

    try:
        _, round_data = calculate_game_results(game.id, apply_end_penalties=True)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    cumulative = get_cumulative_scores(session_id)
    next_game = start_next_round(session)

    return jsonify({
        "completed_round": game.round_number,
        "round_scores": round_data,
        "cumulative_scores": cumulative,
        "next_game": next_game.to_dict(include_players=True),
        "round_number": next_game.round_number,
    })


@sessions_bp.post("/<int:session_id>/end")
def end_session(session_id):
    session = GameSession.query.get_or_404(session_id)
    ongoing = Game.query.filter_by(session_id=session_id, status="ongoing").first()
    if ongoing:
        try:
            calculate_game_results(ongoing.id, apply_end_penalties=True)
        except ValueError:
            pass
    session.status = "completed"
    db.session.commit()
    return jsonify({
        "session": session.to_dict(),
        "cumulative_scores": get_cumulative_scores(session_id),
    })
