from flask import Blueprint, jsonify, request

from extensions import db
from models import Game, GamePlayer, Player

players_bp = Blueprint("players", __name__, url_prefix="/api/players")


@players_bp.get("")
def list_players():
    active_only = request.args.get("active", "true").lower() == "true"
    query = Player.query
    if active_only:
        query = query.filter_by(is_active=True)
    players = query.order_by(Player.name).all()
    return jsonify([p.to_dict() for p in players])


@players_bp.get("/<int:player_id>")
def get_player(player_id):
    player = Player.query.get_or_404(player_id)
    return jsonify(player.to_dict())


@players_bp.post("")
def create_player():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Tên người chơi là bắt buộc"}), 400

    if Player.query.filter_by(name=name).first():
        return jsonify({"error": f"Người chơi '{name}' đã tồn tại"}), 409

    player = Player(
        name=name,
        nickname=data.get("nickname"),
        avatar_url=data.get("avatar_url"),
    )
    db.session.add(player)
    db.session.commit()
    return jsonify(player.to_dict()), 201


@players_bp.put("/<int:player_id>")
def update_player(player_id):
    player = Player.query.get_or_404(player_id)
    data = request.get_json(silent=True) or {}

    if "name" in data:
        name = data["name"].strip()
        if not name:
            return jsonify({"error": "Tên không được để trống"}), 400
        existing = Player.query.filter(Player.name == name, Player.id != player_id).first()
        if existing:
            return jsonify({"error": f"Người chơi '{name}' đã tồn tại"}), 409
        player.name = name

    if "nickname" in data:
        player.nickname = data["nickname"]
    if "avatar_url" in data:
        player.avatar_url = data["avatar_url"]
    if "is_active" in data:
        player.is_active = bool(data["is_active"])

    db.session.commit()
    return jsonify(player.to_dict())


@players_bp.delete("/<int:player_id>")
def delete_player(player_id):
    player = Player.query.get_or_404(player_id)

    in_ongoing = (
        GamePlayer.query.join(Game)
        .filter(
            GamePlayer.player_id == player_id,
            GamePlayer.table_status == "active",
            Game.status == "ongoing",
        )
        .first()
    )
    if in_ongoing:
        return jsonify({"error": "Người chơi đang ở bàn trong ván đang chơi, không thể xóa"}), 400

    has_history = GamePlayer.query.filter_by(player_id=player_id).first()
    if has_history:
        player.is_active = False
        db.session.commit()
        return jsonify({"message": "Đã ẩn người chơi (giữ lịch sử ván)", "player": player.to_dict()})

    db.session.delete(player)
    db.session.commit()
    return jsonify({"message": "Đã xóa người chơi"})
