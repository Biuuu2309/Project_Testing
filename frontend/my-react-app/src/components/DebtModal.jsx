import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { formatMatchupBreakdown } from '../utils/matchupUtils'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function DebtModal({ open, onClose, onDebtsChange }) {
  const [debts, setDebts] = useState([])
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(false)
  const [settlingKey, setSettlingKey] = useState(null)
  const [error, setError] = useState('')

  const loadDebts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getDebts()
      const list = Array.isArray(data.debts) ? data.debts : []
      setDebts(list)
      setSettlements(Array.isArray(data.recent_settlements) ? data.recent_settlements : [])
      onDebtsChange?.(list)
    } catch (e) {
      setError(e.message)
      setDebts([])
      setSettlements([])
    } finally {
      setLoading(false)
    }
  }, [onDebtsChange])

  useEffect(() => {
    if (open) loadDebts()
  }, [open, loadDebts])

  const handleSettle = async (debt) => {
    if (debt.is_tie || !debt.winner_id || !debt.loser_id) return
    const key = `${debt.winner_id}-${debt.loser_id}`
    setSettlingKey(key)
    setError('')
    try {
      const result = await api.settleDebt(debt.winner_id, debt.loser_id)
      setDebts(Array.isArray(result.debts) ? result.debts : [])
      onDebtsChange?.(result.debts || [])
      await loadDebts()
    } catch (e) {
      setError(e.message)
    } finally {
      setSettlingKey(null)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay modal-overlay-detail" onClick={onClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Theo dõi nợ</h2>
          <button
            type="button"
            className="btn-delete modal-close"
            title="Đóng"
            aria-label="Đóng"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body history-scroll">
          <p className="hint debt-intro">
            Nợ được cộng dồn sau mỗi ván kết thúc (theo đối đầu ròng). Bấm{' '}
            <strong>Đã trả nợ</strong> để xóa số dư giữa hai người.
          </p>

          {error && <p className="debt-error">{error}</p>}
          {loading && <p className="hint">Đang tải...</p>}

          {!loading && debts.length === 0 && (
            <p className="hint debt-empty">Hiện không ai nợ ai — chơi và kết thúc ván để cập nhật.</p>
          )}

          {!loading && debts.length > 0 && (
            <section className="history-session-stats debt-stats-block">
              <p className="history-section-title">Đang nợ</p>
              <ul className="debt-list">
                {debts.map((d) => {
                  const key = `${d.player_a_id}-${d.player_b_id}`
                  const settling = settlingKey === `${d.winner_id}-${d.loser_id}`
                  return (
                    <li key={key} className="debt-list-item">
                      <div className="debt-list-main">
                        {d.is_tie ? (
                          <span className="debt-summary">
                            {d.player_a_name} hòa {d.player_b_name}
                          </span>
                        ) : (
                          <>
                            <span className="debt-debtor">{d.loser_name}</span>
                            <span className="matchup-vs">đang nợ</span>
                            <span className="debt-creditor">{d.winner_name}</span>
                            <span className="debt-amount neg">−{d.points}</span>
                          </>
                        )}
                      </div>
                      {(d.gross_a_beats_b > 0 || d.gross_b_beats_a > 0) && (
                        <p className="matchup-breakdown">{formatMatchupBreakdown(d)}</p>
                      )}
                      {!d.is_tie && (
                        <button
                          type="button"
                          className="btn btn-outline btn-debt-settle"
                          disabled={settling || loading}
                          onClick={() => handleSettle(d)}
                        >
                          {settling ? 'Đang xử lý...' : 'Đã trả nợ'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {settlements.length > 0 && (
            <section className="debt-settlements">
              <p className="history-subtitle">Lịch sử trả nợ gần đây</p>
              <ul className="debt-settlement-list">
                {settlements.map((s) => (
                  <li key={s.id} className="debt-settlement-item">
                    <span>
                      {s.debtor_name} trả {s.creditor_name}{' '}
                      <strong className="pos">+{s.amount}</strong>
                    </span>
                    {s.settled_at && (
                      <span className="history-date">{formatDate(s.settled_at)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
