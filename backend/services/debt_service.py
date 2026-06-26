from datetime import datetime

from extensions import db
from models import Player, PlayerDebt, DebtSettlement
from services.matchup_service import consolidate_matchups


def _get_names(creditor_id: int, debtor_id: int) -> tuple[str, str]:
    creditor = Player.query.get(creditor_id)
    debtor = Player.query.get(debtor_id)
    return (
        creditor.name if creditor else f"#{creditor_id}",
        debtor.name if debtor else f"#{debtor_id}",
    )


def _get_or_create_debt(creditor_id: int, debtor_id: int) -> PlayerDebt:
    row = PlayerDebt.query.filter_by(creditor_id=creditor_id, debtor_id=debtor_id).first()
    if row:
        return row
    row = PlayerDebt(creditor_id=creditor_id, debtor_id=debtor_id, amount=0)
    db.session.add(row)
    db.session.flush()
    return row


def add_debt(creditor_id: int, debtor_id: int, amount: int, game_id: int | None = None) -> None:
    """Cộng thêm nợ: debtor_id đang nợ creditor_id thêm `amount` điểm."""
    if amount <= 0 or creditor_id == debtor_id:
        return

    reverse = PlayerDebt.query.filter_by(creditor_id=debtor_id, debtor_id=creditor_id).first()
    if reverse and reverse.amount > 0:
        if amount >= reverse.amount:
            amount -= reverse.amount
            reverse.amount = 0
        else:
            reverse.amount -= amount
            amount = 0

    if amount <= 0:
        return

    forward = _get_or_create_debt(creditor_id, debtor_id)
    forward.amount += amount
  # game_id stored only on settlement; optional future: track last_game_id on PlayerDebt


def apply_matchups_to_debts(matchups: list[dict], game_id: int | None = None) -> None:
    """Sau mỗi ván hoàn thành — cộng nợ từ đối đầu ròng (bết lưỡi)."""
    consolidated = consolidate_matchups(matchups)
    for m in consolidated:
        if m.get("is_tie") or not m.get("points"):
            continue
        creditor_id = m["winner_id"]
        debtor_id = m["loser_id"]
        if creditor_id and debtor_id:
            add_debt(creditor_id, debtor_id, int(m["points"]))


def list_debts() -> list[dict]:
    """Danh sách nợ ròng từng cặp (đã gộp hai chiều) để hiển thị."""
    rows = PlayerDebt.query.filter(PlayerDebt.amount > 0).all()
    directed = []
    for row in rows:
        creditor_name, debtor_name = _get_names(row.creditor_id, row.debtor_id)
        directed.append({
            "winner_id": row.creditor_id,
            "loser_id": row.debtor_id,
            "winner_name": creditor_name,
            "loser_name": debtor_name,
            "points": row.amount,
        })
    return consolidate_matchups(directed)


def settle_debt(creditor_id: int, debtor_id: int, note: str | None = None) -> dict:
    """
    Đã trả nợ — xóa số dư nợ ròng giữa hai người (cả hai chiều nếu còn).
    creditor_id / debtor_id là cặp từ bảng nợ ròng (người thua nợ người thắng).
    """
    if creditor_id == debtor_id:
        raise ValueError("Không thể thanh toán nợ với chính mình")

    settled_total = 0
    pairs = [(creditor_id, debtor_id), (debtor_id, creditor_id)]

    for cred, deb in pairs:
        row = PlayerDebt.query.filter_by(creditor_id=cred, debtor_id=deb).first()
        if not row or row.amount <= 0:
            continue
        settled_total += row.amount
        db.session.add(
            DebtSettlement(
                creditor_id=cred,
                debtor_id=deb,
                amount=row.amount,
                note=note or "Đã trả nợ",
                settled_at=datetime.utcnow(),
            )
        )
        row.amount = 0

    if settled_total <= 0:
        raise ValueError("Không có khoản nợ nào giữa hai người này")

    db.session.commit()
    return {"settled_amount": settled_total, "debts": list_debts()}


def list_settlements(limit: int = 50) -> list[dict]:
    rows = (
        DebtSettlement.query.order_by(DebtSettlement.settled_at.desc())
        .limit(limit)
        .all()
    )
    return [r.to_dict() for r in rows]
