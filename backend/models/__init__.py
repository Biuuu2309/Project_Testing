from datetime import datetime

from extensions import db
from utils.datetime_util import to_iso_utc


class Player(db.Model):
    __tablename__ = "players"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    nickname = db.Column(db.String(50))
    avatar_url = db.Column(db.String(255))
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    game_links = db.relationship("GamePlayer", back_populates="player", lazy="dynamic")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "nickname": self.nickname,
            "avatar_url": self.avatar_url,
            "is_active": self.is_active,
            "created_at": to_iso_utc(self.created_at),
        }


class ActionType(db.Model):
    __tablename__ = "action_types"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), nullable=False, unique=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.Enum("finish", "chat", "penalty", "special"), nullable=False)
    base_points = db.Column(db.Integer, nullable=False)
    point_role = db.Column(
        db.Enum("actor_gain", "actor_loss", "target_loss", "all_loss"),
        nullable=False,
    )
    can_stack = db.Column(db.Boolean, nullable=False, default=False)
    sort_order = db.Column(db.SmallInteger, nullable=False, default=0)
    description = db.Column(db.String(255))
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "category": self.category,
            "base_points": self.base_points,
            "point_role": self.point_role,
            "can_stack": bool(self.can_stack),
            "sort_order": self.sort_order,
            "description": self.description,
        }


class GameSession(db.Model):
    __tablename__ = "game_sessions"

    id = db.Column(db.Integer, primary_key=True)
    status = db.Column(
        db.Enum("ongoing", "completed"),
        nullable=False,
        default="ongoing",
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    games = db.relationship("Game", back_populates="session", lazy="dynamic")
    session_players = db.relationship(
        "GameSessionPlayer", back_populates="session", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "created_at": to_iso_utc(self.created_at),
        }


class GameSessionPlayer(db.Model):
    __tablename__ = "game_session_players"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("game_sessions.id"), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    seat_position = db.Column(db.SmallInteger)

    session = db.relationship("GameSession", back_populates="session_players")
    player = db.relationship("Player")

    __table_args__ = (
        db.UniqueConstraint("session_id", "player_id", name="uk_session_player"),
    )


class Game(db.Model):
    __tablename__ = "games"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("game_sessions.id"), nullable=True)
    round_number = db.Column(db.SmallInteger, nullable=False, default=1)
    title = db.Column(db.String(150))
    status = db.Column(
        db.Enum("ongoing", "completed", "cancelled"),
        nullable=False,
        default="ongoing",
    )
    player_count = db.Column(db.SmallInteger, nullable=False, default=4)
    played_at = db.Column(db.DateTime, default=datetime.utcnow)
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    participants = db.relationship("GamePlayer", back_populates="game", cascade="all, delete-orphan")
    actions = db.relationship("PlayerAction", back_populates="game", cascade="all, delete-orphan")
    results = db.relationship("GameResult", back_populates="game", cascade="all, delete-orphan")
    roster_swaps = db.relationship("GameRosterSwap", back_populates="game", cascade="all, delete-orphan")
    session = db.relationship("GameSession", back_populates="games")

    def to_dict(self, include_players=False):
        data = {
            "id": self.id,
            "session_id": self.session_id,
            "round_number": self.round_number,
            "title": self.title,
            "status": self.status,
            "player_count": self.player_count,
            "played_at": to_iso_utc(self.played_at),
            "note": self.note,
        }
        if include_players:
            data["players"] = [gp.to_dict() for gp in self.participants]
        return data


class GamePlayer(db.Model):
    __tablename__ = "game_players"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey("games.id"), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    seat_position = db.Column(db.SmallInteger)
    finish_position = db.Column(db.SmallInteger)
    table_status = db.Column(db.Enum("active", "frozen"), nullable=False, default="active")
    joined_at_start = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship("Game", back_populates="participants")
    player = db.relationship("Player", back_populates="game_links")

    __table_args__ = (
        db.UniqueConstraint("game_id", "player_id", name="uk_game_player"),
        db.UniqueConstraint("game_id", "seat_position", name="uk_game_seat"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "game_id": self.game_id,
            "player_id": self.player_id,
            "player_name": self.player.name if self.player else None,
            "seat_position": self.seat_position,
            "finish_position": self.finish_position,
            "table_status": self.table_status,
            "joined_at_start": bool(self.joined_at_start),
        }


class GameRosterSwap(db.Model):
    __tablename__ = "game_roster_swaps"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey("games.id"), nullable=False)
    exit_player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    enter_player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    action_order = db.Column(db.SmallInteger, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship("Game", back_populates="roster_swaps")
    exit_player = db.relationship("Player", foreign_keys=[exit_player_id])
    enter_player = db.relationship("Player", foreign_keys=[enter_player_id])

    def to_dict(self):
        return {
            "id": self.id,
            "game_id": self.game_id,
            "exit_player_id": self.exit_player_id,
            "exit_player_name": self.exit_player.name if self.exit_player else None,
            "enter_player_id": self.enter_player_id,
            "enter_player_name": self.enter_player.name if self.enter_player else None,
            "action_order": self.action_order,
        }


class PlayerAction(db.Model):
    __tablename__ = "player_actions"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey("games.id"), nullable=False)
    action_type_id = db.Column(db.Integer, db.ForeignKey("action_types.id"), nullable=False)
    actor_player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    target_player_id = db.Column(db.Integer, db.ForeignKey("players.id"))
    stack_level = db.Column(db.SmallInteger, nullable=False, default=1)
    parent_action_id = db.Column(db.Integer, db.ForeignKey("player_actions.id"))
    actor_points = db.Column(db.Integer, nullable=False, default=0)
    target_points = db.Column(db.Integer, nullable=False, default=0)
    note = db.Column(db.String(255))
    action_order = db.Column(db.SmallInteger, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship("Game", back_populates="actions")
    action_type = db.relationship("ActionType")
    actor = db.relationship("Player", foreign_keys=[actor_player_id])
    target = db.relationship("Player", foreign_keys=[target_player_id])
    parent_action = db.relationship("PlayerAction", remote_side=[id])

    def to_dict(self):
        return {
            "id": self.id,
            "game_id": self.game_id,
            "action_type": self.action_type.to_dict() if self.action_type else None,
            "actor_player_id": self.actor_player_id,
            "actor_name": self.actor.name if self.actor else None,
            "target_player_id": self.target_player_id,
            "target_name": self.target.name if self.target else None,
            "stack_level": self.stack_level,
            "parent_action_id": self.parent_action_id,
            "actor_points": self.actor_points,
            "target_points": self.target_points,
            "note": self.note,
            "action_order": self.action_order,
            "created_at": to_iso_utc(self.created_at),
        }


class GameResult(db.Model):
    __tablename__ = "game_results"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey("games.id"), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey("players.id"), nullable=False)
    finish_points = db.Column(db.Integer, nullable=False, default=0)
    chat_points = db.Column(db.Integer, nullable=False, default=0)
    penalty_points = db.Column(db.Integer, nullable=False, default=0)
    total_points = db.Column(db.Integer, nullable=False, default=0)
    finish_position = db.Column(db.SmallInteger)
    calculated_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship("Game", back_populates="results")
    player = db.relationship("Player")

    __table_args__ = (db.UniqueConstraint("game_id", "player_id", name="uk_game_result"),)

    def to_dict(self):
        return {
            "id": self.id,
            "game_id": self.game_id,
            "player_id": self.player_id,
            "player_name": self.player.name if self.player else None,
            "finish_points": self.finish_points,
            "chat_points": self.chat_points,
            "penalty_points": self.penalty_points,
            "total_points": self.total_points,
            "finish_position": self.finish_position,
            "calculated_at": to_iso_utc(self.calculated_at),
        }
