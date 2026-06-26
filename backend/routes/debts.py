from flask import Blueprint, jsonify, request

from services.debt_service import list_debts, list_settlements, settle_debt

debts_bp = Blueprint("debts", __name__, url_prefix="/api/debts")


@debts_bp.get("")
def get_debts():
    return jsonify({
        "debts": list_debts(),
        "recent_settlements": list_settlements(30),
    })


@debts_bp.post("/settle")
def settle():
    data = request.get_json(silent=True) or {}
    creditor_id = data.get("creditor_id")
    debtor_id = data.get("debtor_id")
    if not creditor_id or not debtor_id:
        return jsonify({"error": "creditor_id và debtor_id là bắt buộc"}), 400
    try:
        result = settle_debt(int(creditor_id), int(debtor_id), data.get("note"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(result)
