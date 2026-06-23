from flask import Flask, jsonify
from flask_cors import CORS

from config import Config
from extensions import db
from routes.games import action_types_bp, games_bp
from routes.players import players_bp
from routes.sessions import sessions_bp


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    CORS(app, resources={r"/api/*": {"origins": "*"}})
    db.init_app(app)

    app.register_blueprint(players_bp)
    app.register_blueprint(action_types_bp)
    app.register_blueprint(games_bp)
    app.register_blueprint(sessions_bp)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "tien_len_scoring"})

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Không tìm thấy"}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Lỗi máy chủ"}), 500

    return app
