import { useMemo, useState } from 'react'

const RANK_DEFS = [
  { code: 'VE_NHAT', label: 'về nhất', short: 'Nhất' },
  { code: 'VE_NHI', label: 'về nhì', short: 'Nhì' },
  { code: 'VE_BA', label: 'về ba', short: 'Ba' },
  { code: 'VE_BON', label: 'về bốn', short: 'Bét' },
]

const FINISH_CODES = new Set(RANK_DEFS.map((r) => r.code))

const PENALTY_BTNS = [
  { code: 'NHOT', label: 'Bị nhốt' },
  { code: 'THUI_HEO_DEN', label: 'Thúi đen' },
  { code: 'THUI_HEO_DO', label: 'Thúi đỏ' },
  { code: 'THUI_TU_QUY', label: 'Thúi tứ quý' },
  { code: 'THUI_3_DOI_THONG', label: 'Thúi 3 đôi thông' },
  { code: 'THUI_4_DOI_THONG', label: 'Thúi 4 đôi thông' },
  { code: 'VE_TRANG', label: 'Về trắng' },
]

const CHAT_BTNS = [
  { code: 'CHAT_HEO_DEN', label: 'Chặt heo đen' },
  { code: 'CHAT_HEO_DO', label: 'Chặt heo đỏ' },
  { code: 'CHAT_3_DOI_THONG', label: 'Chặt 3 đôi thông' },
  { code: 'CHAT_4_DOI_THONG', label: 'Chặt 4 đôi thông' },
  { code: 'CHAT_TU_QUY', label: 'Chặt tứ quý' },
]

function actionByCode(actionTypes, code) {
  return actionTypes.find((a) => a.code === code)
}

export function isRanksCompleteInQueue(pendingQueue, actionTypes, tablePlayerCount) {
  if (!tablePlayerCount) return false
  const finishIds = new Set(
    actionTypes.filter((a) => FINISH_CODES.has(a.code)).map((a) => a.id),
  )
  const count = pendingQueue.filter((item) => finishIds.has(item.action_type_id)).length
  return count >= tablePlayerCount
}

export function useGameBoardState(
  actionTypes,
  tablePlayers,
  onEnqueue,
  onEnqueueBatch,
  ranksLocked,
) {
  const rankDefs = useMemo(
    () => RANK_DEFS.slice(0, tablePlayers.length),
    [tablePlayers.length],
  )

  const [rankStep, setRankStep] = useState(0)
  const [rankAssignments, setRankAssignments] = useState([])
  const [chatDraft, setChatDraft] = useState(null)

  const pickedIds = useMemo(
    () => new Set(rankAssignments.map((r) => r.player.id)),
    [rankAssignments],
  )

  const rankByPlayer = useMemo(() => {
    const map = {}
    for (const r of rankAssignments) map[r.player.id] = r
    return map
  }, [rankAssignments])

  const currentRankDef =
    !ranksLocked && rankStep < rankDefs.length ? rankDefs[rankStep] : null

  const resetRank = () => {
    setRankStep(0)
    setRankAssignments([])
  }

  const handleRankPick = (player) => {
    if (ranksLocked || !currentRankDef || pickedIds.has(player.id) || chatDraft) return
    const action = actionByCode(actionTypes, currentRankDef.code)
    if (!action) return

    const next = [...rankAssignments, { ...currentRankDef, player, action }]
    setRankAssignments(next)

    if (next.length >= rankDefs.length) {
      onEnqueueBatch(next.map((r) => ({ player: r.player, action: r.action })))
      resetRank()
    } else {
      setRankStep(rankStep + 1)
    }
  }

  const handlePenalty = (player, action) => {
    if (chatDraft) return
    onEnqueue(player, action)
  }

  const startChat = (actor, action) => {
    setChatDraft({ actor, action })
  }

  const pickChatTarget = (target) => {
    if (!chatDraft || target.id === chatDraft.actor.id) return
    onEnqueue(chatDraft.actor, chatDraft.action, target)
    setChatDraft(null)
  }

  const cancelChat = () => setChatDraft(null)

  return {
    rankDefs,
    rankStep,
    rankAssignments,
    currentRankDef,
    rankByPlayer,
    pickedIds,
    resetRank,
    chatDraft,
    handleRankPick,
    handlePenalty,
    startChat,
    pickChatTarget,
    cancelChat,
  }
}

export function getGuideMessage({
  gameId,
  swapStep,
  swapExit,
  chatDraft,
  currentRankDef,
  ranksLocked,
}) {
  if (swapStep === 'exit') return 'Chọn người rút khỏi bàn — dùng panel bên trái'
  if (swapStep === 'enter') {
    return `Chọn người vào thay ${swapExit?.name} — dùng panel bên trái`
  }
  if (!gameId) {
    return 'Thêm người chơi bên trái, chọn 2–4 người rồi bấm Bắt đầu phiên'
  }
  if (chatDraft) {
    return `${chatDraft.actor.name} — ${chatDraft.action.name}: bấm tên người bị chặt ở cột bên dưới`
  }
  if (ranksLocked) {
    return 'Đã xếp đủ thứ hạng 4 người — dùng phạt / chặt hoặc xác nhận danh sách'
  }
  if (currentRankDef) {
    return `Chọn người ${currentRankDef.label} (bấm tên ở cột người chơi bên dưới)`
  }
  return 'Ghi phạt / chặt bằng nút trong cột người chơi, hoặc bấm tên để xếp hạng'
}

function formatQueueLabel(item) {
  const finishShort = {
    'Về nhất': 'Nhất',
    'Về nhì': 'Nhì',
    'Về ba': 'Ba',
    'Về bốn': 'Bét',
  }
  if (item.target_name) {
    return `${item.actor_name} → ${item.action_name} → ${item.target_name}`
  }
  const short = finishShort[item.action_name]
  if (short) return `${item.actor_name} → ${short}`
  return item.label
}

export function GameGuideBlock({ message, chatDraft, onCancelChat, loading }) {
  return (
    <section className="board-block board-guide" data-tour="action-panel">
      <h3 className="board-block-title">Hướng dẫn</h3>
      <p className="board-guide-text">{message}</p>
      {chatDraft && (
        <button
          type="button"
          className="btn btn-link board-guide-cancel"
          disabled={loading}
          onClick={onCancelChat}
        >
          Hủy chặt
        </button>
      )}
    </section>
  )
}

export function GameQueueBlock({
  pendingQueue,
  loading,
  onClear,
  onExecute,
  onRemove,
}) {
  return (
    <section className="board-block board-queue" data-tour="queue-execute">
      <div className="board-queue-header">
        <h3 className="board-block-title">Hành động chờ xác nhận ({pendingQueue.length})</h3>
        <div className="board-queue-actions">
          <button
            type="button"
            className="btn btn-secondary btn-queue-sm"
            disabled={loading || pendingQueue.length === 0}
            onClick={onClear}
          >
            Xóa hết
          </button>
          <button
            type="button"
            className="btn btn-primary btn-queue-run"
            disabled={loading || pendingQueue.length === 0}
            onClick={onExecute}
          >
            {loading ? 'Đang tính...' : 'Xác nhận & tổng hợp'}
          </button>
        </div>
      </div>
      {pendingQueue.length === 0 ? (
        <p className="hint board-queue-empty">Chưa có hành động — xếp hạng, phạt hoặc chặt để thêm</p>
      ) : (
        <ul className="queue-list board-queue-list">
          {pendingQueue.map((item, i) => (
            <li key={item.id} className="queue-item">
              <span className="queue-index">{i + 1}.</span>
              <span className="queue-text">{formatQueueLabel(item)}</span>
              <button
                type="button"
                className="btn-delete queue-delete"
                title="Xóa"
                disabled={loading}
                onClick={() => onRemove(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function GamePlayerColumns({
  tablePlayers,
  actionTypes,
  board,
  loading,
  ranksLocked,
}) {
  const {
    currentRankDef,
    rankByPlayer,
    pickedIds,
    chatDraft,
    handleRankPick,
    handlePenalty,
    startChat,
    pickChatTarget,
  } = board

  const rankActive = Boolean(currentRankDef) && !chatDraft && !ranksLocked
  const chatTargetMode = Boolean(chatDraft)

  return (
    <section className="board-block board-columns" data-tour="table-players">
      <h3 className="board-block-title">Người ở bàn</h3>
      <div className="player-columns-grid">
        {tablePlayers.map((player) => {
          const isActor = chatDraft?.actor.id === player.id
          const isChatTarget = chatTargetMode && !isActor

          if (chatTargetMode && isActor) {
            return (
              <div key={player.id} className="player-column player-column--chat-actor">
                <button type="button" className="player-column-name chat-actor" disabled>
                  {player.name}
                  <span className="player-column-chat-hint">{chatDraft.action.name}</span>
                </button>
              </div>
            )
          }

          if (chatTargetMode && isChatTarget) {
            return (
              <div key={player.id} className="player-column player-column--chat-target">
                <button
                  type="button"
                  className="player-column-name active-step chat-target"
                  disabled={loading}
                  onClick={() => pickChatTarget(player)}
                >
                  {player.name}
                  <span className="player-column-chat-hint">Bị chặt</span>
                </button>
              </div>
            )
          }

          return (
            <div key={player.id} className="player-column">
              <button
                type="button"
                className={[
                  'player-column-name',
                  rankActive && !pickedIds.has(player.id) ? 'active-step' : '',
                  rankByPlayer[player.id] ? 'has-rank' : '',
                  ranksLocked ? 'rank-locked' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={
                  loading ||
                  ranksLocked ||
                  (rankActive && pickedIds.has(player.id))
                }
                onClick={() => handleRankPick(player)}
              >
                {player.name}
                {rankByPlayer[player.id] && (
                  <span className="player-column-rank">{rankByPlayer[player.id].short}</span>
                )}
              </button>

              <div className="player-column-group">
                <span className="player-column-label">Phạt</span>
                {PENALTY_BTNS.map((pen) => {
                  const action = actionByCode(actionTypes, pen.code)
                  if (!action) return null
                  return (
                    <button
                      key={pen.code}
                      type="button"
                      className="btn btn-col-penalty"
                      disabled={loading}
                      onClick={() => handlePenalty(player, action)}
                    >
                      {pen.label}
                    </button>
                  )
                })}
              </div>

              <div className="player-column-group">
                <span className="player-column-label">Chặt</span>
                {CHAT_BTNS.map((chat) => {
                  const action = actionByCode(actionTypes, chat.code)
                  if (!action) return null
                  return (
                    <button
                      key={chat.code}
                      type="button"
                      className="btn btn-col-chat"
                      disabled={loading}
                      onClick={() => startChat(player, action)}
                    >
                      {chat.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
