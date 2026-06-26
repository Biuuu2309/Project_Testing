from models import Game, GameSession
from utils.datetime_util import to_iso_utc
from services.matchup_service import consolidate_matchups
from services.scoring_service import compute_scores
from services.session_service import get_cumulative_scores


def _scores_from_game(game, computed: dict) -> list[dict]:
    if game.results:
        return [
            {
                "player_id": r.player_id,
                "player_name": r.player.name if r.player else None,
                "finish": r.finish_points,
                "chat": r.chat_points,
                "penalty": r.penalty_points,
                "total": r.total_points,
                "finish_position": r.finish_position,
            }
            for r in game.results
        ]
    return computed.get("scores", [])


def _merge_matchups(aggregate: dict, matchups: list) -> None:
    for m in matchups:
        key = (m["winner_id"], m["loser_id"])
        if key not in aggregate:
            aggregate[key] = {
                "winner_id": m["winner_id"],
                "loser_id": m["loser_id"],
                "winner_name": m["winner_name"],
                "loser_name": m["loser_name"],
                "points": 0,
            }
        aggregate[key]["points"] += m["points"]


def _format_aggregate(aggregate: dict) -> list[dict]:
    return consolidate_matchups(list(aggregate.values()))


def get_play_history(limit: int = 200) -> dict:
    games = (
        Game.query.filter_by(status="completed")
        .order_by(Game.played_at.desc())
        .limit(limit)
        .all()
    )

    aggregate: dict = {}
    sessions: dict[int, dict] = {}
    standalone: list[dict] = []

    for game in games:
        if not game.actions:
            continue
        try:
            computed = compute_scores(game.id, apply_end_penalties=True)
        except ValueError:
            continue

        scores = _scores_from_game(game, computed)
        matchups = computed.get("matchups", [])
        _merge_matchups(aggregate, matchups)

        item = {
            **game.to_dict(include_players=True),
            "action_count": len(game.actions),
            "results": scores,
            "matchups": matchups,
            "action_log": computed.get("actions", []),
        }

        if game.session_id:
            if game.session_id not in sessions:
                session = GameSession.query.get(game.session_id)
                sessions[game.session_id] = {
                    "session_id": game.session_id,
                    "status": session.status if session else None,
                    "created_at": to_iso_utc(session.created_at) if session else None,
                    "rounds": [],
                    "cumulative_scores": get_cumulative_scores(game.session_id),
                }
            sessions[game.session_id]["rounds"].append(item)
        else:
            standalone.append(item)

    for session in sessions.values():
        session["rounds"].sort(key=lambda r: r.get("round_number") or 0)
        session_agg: dict = {}
        for round_item in session["rounds"]:
            _merge_matchups(session_agg, round_item.get("matchups", []))
        session["session_matchups"] = _format_aggregate(session_agg)

    session_list = sorted(
        sessions.values(),
        key=lambda s: s.get("created_at") or "",
        reverse=True,
    )

    return {
        "aggregate_matchups": _format_aggregate(aggregate),
        "sessions": session_list,
        "standalone_games": standalone,
    }
