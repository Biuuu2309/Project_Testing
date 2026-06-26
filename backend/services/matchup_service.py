"""Gộp đối đầu có hướng (A thắng B) thành kết quả ròng từng cặp người chơi."""

from collections import defaultdict


def consolidate_matchups(directed: list[dict]) -> list[dict]:
    """
    Với mỗi cặp (A, B):
      ròng = điểm A thắng B − điểm B thắng A
    Trả về một dòng / cặp, kèm chi tiết hai chiều để minh bạch.
    """
    if not directed:
        return []

    if all(
        m.get("player_a_id") is not None
        and m.get("player_b_id") is not None
        and (m.get("gross_a_beats_b") is not None or m.get("gross_b_beats_a") is not None)
        for m in directed
    ):
        return sorted(
            directed,
            key=lambda x: (x.get("is_tie", False), -(x.get("points") or 0)),
        )

    edges: dict[tuple[int, int], int] = defaultdict(int)
    names: dict[int, str] = {}

    for m in directed or []:
        pts = int(m.get("points") or 0)
        if pts <= 0:
            continue
        w = m.get("winner_id")
        l = m.get("loser_id")
        if w is None or l is None or w == l:
            continue
        edges[(w, l)] += pts
        if m.get("winner_name"):
            names[w] = m["winner_name"]
        if m.get("loser_name"):
            names[l] = m["loser_name"]

    pairs: set[tuple[int, int]] = set()
    for w, l in edges:
        pairs.add((min(w, l), max(w, l)))

    results: list[dict] = []
    for a, b in pairs:
        gross_ab = edges.get((a, b), 0)
        gross_ba = edges.get((b, a), 0)
        net = gross_ab - gross_ba
        name_a = names.get(a, f"#{a}")
        name_b = names.get(b, f"#{b}")

        item: dict = {
            "player_a_id": a,
            "player_b_id": b,
            "player_a_name": name_a,
            "player_b_name": name_b,
            "gross_a_beats_b": gross_ab,
            "gross_b_beats_a": gross_ba,
            "points": abs(net),
            "is_tie": net == 0,
        }

        if net > 0:
            item.update(
                winner_id=a,
                loser_id=b,
                winner_name=name_a,
                loser_name=name_b,
            )
        elif net < 0:
            item.update(
                winner_id=b,
                loser_id=a,
                winner_name=name_b,
                loser_name=name_a,
            )
        else:
            item.update(
                winner_id=None,
                loser_id=None,
                winner_name=name_a,
                loser_name=name_b,
            )

        if item["is_tie"]:
            item["label"] = f"{name_a} – {name_b}: hòa (mỗi chiều +{gross_ab})"
        else:
            item["label"] = (
                f"{item['loser_name']} thua ròng {item['winner_name']} −{item['points']} "
                f"({name_a}→{name_b} +{gross_ab}, {name_b}→{name_a} +{gross_ba})"
            )
        results.append(item)

    results.sort(key=lambda x: (x["is_tie"], -x["points"]))
    return results
