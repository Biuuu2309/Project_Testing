import { useMemo, useState } from 'react'

const RANK_DEFS = [
  { code: 'VE_NHAT', label: 'Về nhất', short: 'Nhất' },
  { code: 'VE_NHI', label: 'Về nhì', short: 'Nhì' },
  { code: 'VE_BA', label: 'Về ba', short: 'Ba' },
  { code: 'VE_BON', label: 'Về bốn', short: 'Bét' },
]

const PENALTY_QUICK = [
  { code: 'NHOT', label: 'Nhốt' },
  { code: 'THUI_HEO_DEN', label: 'Thúi đen' },
  { code: 'THUI_HEO_DO', label: 'Thúi đỏ' },
  { code: 'VE_TRANG', label: 'Về trắng' },
]

function actionByCode(actionTypes, code) {
  return actionTypes.find((a) => a.code === code)
}

export function useQuickGameState(actionTypes, tablePlayers, onEnqueue, onEnqueueBatch) {
  const rankDefs = useMemo(
    () => RANK_DEFS.slice(0, tablePlayers.length),
    [tablePlayers.length],
  )

  const [rankStep, setRankStep] = useState(0)
  const [rankAssignments, setRankAssignments] = useState([])
  const [chatAction, setChatAction] = useState(null)
  const [chatActor, setChatActor] = useState(null)

  const pickedIds = useMemo(
    () => new Set(rankAssignments.map((r) => r.player.id)),
    [rankAssignments],
  )

  const rankPicksByPlayer = useMemo(() => {
    const map = {}
    for (const r of rankAssignments) map[r.player.id] = r
    return map
  }, [rankAssignments])

  const resetRank = () => {
    setRankStep(0)
    setRankAssignments([])
  }

  const currentRankDef = rankStep < rankDefs.length ? rankDefs[rankStep] : null

  const handleRankPlayerPick = (player) => {
    if (rankStep >= rankDefs.length) return
    const def = rankDefs[rankStep]
    const action = actionByCode(actionTypes, def.code)
    if (!action) return

    const next = [...rankAssignments, { ...def, player, action }]
    setRankAssignments(next)

    if (next.length >= rankDefs.length) {
      onEnqueueBatch(next.map((r) => ({ player: r.player, action: r.action })))
      resetRank()
    } else {
      setRankStep(rankStep + 1)
    }
  }

  const handleQuickPenalty = (player, action) => {
    onEnqueue(player, action)
  }

  const handlePlayerClick = (player) => {
    if (currentRankDef && !pickedIds.has(player.id)) {
      handleRankPlayerPick(player)
      return
    }
    if (chatAction) {
      if (!chatActor) {
        setChatActor(player)
      } else if (player.id !== chatActor.id) {
        onEnqueue(chatActor, chatAction, player)
        setChatActor(null)
        setChatAction(null)
      }
    }
  }

  const selectChatAction = (action) => {
    setChatAction(action)
    setChatActor(null)
  }

  const cancelChat = () => {
    setChatAction(null)
    setChatActor(null)
  }

  return {
    rankDefs,
    rankStep,
    rankAssignments,
    currentRankDef,
    rankPicksByPlayer,
    pickedIds,
    resetRank,
    chatAction,
    chatActor,
    handleQuickPenalty,
    handlePlayerClick,
    selectChatAction,
    cancelChat,
  }
}

export function QuickActionCenter({
  rankDefs,
  rankStep,
  rankAssignments,
  currentRankDef,
  resetRank,
  chatAction,
  chatActor,
  groupedActions,
  loading,
  selectChatAction,
  cancelChat,
}) {
  return (
    <div className="quick-action-panel" data-tour="action-panel">
      <section className="quick-section">
        <h3 className="quick-section-title">Xếp hạng ván</h3>
        <p className="hint quick-hint">
          {currentRankDef
            ? `Bấm tên người ở bàn → ${currentRankDef.label} (${rankStep + 1}/${rankDefs.length})`
            : rankDefs.length
              ? 'Đã thêm xếp hạng vào danh sách chờ'
              : 'Cần ít nhất 2 người ở bàn'}
        </p>
        <div className="quick-rank-slots">
          {rankDefs.map((def, i) => {
            const assigned = rankAssignments[i]
            return (
              <div
                key={def.code}
                className={`quick-rank-slot${i === rankStep ? ' active' : ''}${assigned ? ' filled' : ''}`}
              >
                <span className="quick-rank-label">{def.short}</span>
                <span className="quick-rank-value">{assigned ? assigned.player.name : '—'}</span>
              </div>
            )
          })}
        </div>
        {rankAssignments.length > 0 && currentRankDef && (
          <button type="button" className="btn btn-link quick-reset" onClick={resetRank}>
            Làm lại xếp hạng
          </button>
        )}
      </section>

      <section className="quick-section">
        <h3 className="quick-section-title">Chặt nhanh</h3>
        {!chatAction ? (
          <div className="quick-chat-types btn-grid">
            {groupedActions.chat.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn btn-action"
                disabled={loading}
                onClick={() => selectChatAction(a)}
              >
                {a.name}
                <small>{a.base_points > 0 ? `+${a.base_points}` : a.base_points}</small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="hint quick-hint">
              {!chatActor
                ? `「${chatAction.name}」— bấm người chặt (tab Người chơi)`
                : 'Bấm người bị chặt (tab Người chơi)'}
            </p>
            <button type="button" className="btn btn-link quick-reset" onClick={cancelChat}>
              Hủy
            </button>
          </>
        )}
      </section>

      <section className="quick-section quick-section-muted">
        <h3 className="quick-section-title">Phạt nhanh</h3>
        <p className="hint quick-hint">Nút Nhốt / Thúi / Về trắng cạnh tên mỗi người (tab Người chơi)</p>
      </section>
    </div>
  )
}

export function QuickPlayerListLeft({
  tablePlayers,
  poolPlayers,
  quick,
  actionTypes,
  loading,
}) {
  const {
    currentRankDef,
    rankPicksByPlayer,
    pickedIds,
    chatAction,
    chatActor,
    handleQuickPenalty,
    handlePlayerClick,
  } = quick

  const rankActive = Boolean(currentRankDef)
  const chatActive = Boolean(chatAction)

  return (
    <>
      <p className="section-label">Đang ở bàn</p>
      {(rankActive || chatActive) && (
        <p className="hint quick-panel-hint">
          {rankActive && currentRankDef
            ? `Đang chọn: ${currentRankDef.label}`
            : chatAction && !chatActor
              ? `Chặt: ${chatAction.name} — chọn người chặt`
              : chatAction
                ? `Chặt: ${chatAction.name} — chọn người bị chặt`
                : ''}
        </p>
      )}
      <div className="btn-grid quick-player-list" data-tour="table-players">
        {tablePlayers.map((p) => (
          <div key={p.id} className="quick-player-row">
            <button
              type="button"
              className={[
                'btn',
                'btn-player',
                'quick-player-name',
                rankActive && !pickedIds.has(p.id) ? 'active-step' : '',
                chatActor?.id === p.id ? 'selected' : '',
                chatActive && chatActor && chatActor.id !== p.id ? 'active-step' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={loading || (rankActive && pickedIds.has(p.id))}
              onClick={() => handlePlayerClick(p)}
            >
              {p.name}
              {rankPicksByPlayer[p.id] && (
                <small className="quick-rank-tag">{rankPicksByPlayer[p.id].short}</small>
              )}
            </button>
            <div className="quick-penalty-btns">
              {PENALTY_QUICK.map((pen) => {
                const action = actionByCode(actionTypes, pen.code)
                if (!action) return null
                return (
                  <button
                    key={pen.code}
                    type="button"
                    className="btn btn-quick-penalty"
                    disabled={loading}
                    onClick={() => handleQuickPenalty(p, action)}
                  >
                    {pen.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {poolPlayers.length > 0 && (
        <>
          <p className="section-label muted">Ngoài bàn</p>
          <div className="frozen-list">
            {poolPlayers.map((p) => (
              <span key={p.id} className="frozen-chip">
                {p.name}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}
