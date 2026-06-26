import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api/client'
import TourGuide from './components/TourGuide'
import {
  GameGuideBlock,
  GamePlayerColumns,
  GameQueueBlock,
  getGuideMessage,
  hasVeTrangInQueue,
  isRanksCompleteInQueue,
  useGameBoardState,
} from './components/GameBoard'
import { TOUR_STEPS, TOUR_STORAGE_KEY } from './tourSteps'
import { consolidateMatchups, formatMatchupBreakdown } from './utils/matchupUtils'
import './App.css'

const MAX_TABLE = 4
const STEPS = { ACTOR: 'actor', ACTION: 'action', TARGET: 'target' }
const MOBILE_TABS = { PLAYERS: 'players', ACTIONS: 'actions', SCORES: 'scores' }

function isMobileLayout() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
}

const TIMEZONE = 'Asia/Ho_Chi_Minh'

function parseUtcIso(iso) {
  if (!iso) return null
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDate(iso) {
  const d = parseUtcIso(iso)
  if (!d) return ''
  return d.toLocaleString('vi-VN', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function App() {
  const [players, setPlayers] = useState([])
  const [actionTypes, setActionTypes] = useState([])
  const [gameId, setGameId] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [roundNumber, setRoundNumber] = useState(1)
  const [cumulativeScores, setCumulativeScores] = useState([])
  const [scores, setScores] = useState(null)
  const [actionLog, setActionLog] = useState([])
  const [matchups, setMatchups] = useState([])
  const [activePlayerIds, setActivePlayerIds] = useState([])

  const [selectedForTable, setSelectedForTable] = useState([])
  const [step, setStep] = useState(STEPS.ACTOR)
  const [selectedActor, setSelectedActor] = useState(null)
  const [selectedAction, setSelectedAction] = useState(null)

  const [swapStep, setSwapStep] = useState(null)
  const [swapExit, setSwapExit] = useState(null)

  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showHistory, setShowHistory] = useState(false)
  const [historyData, setHistoryData] = useState({
    aggregate_matchups: [],
    sessions: [],
    standalone_games: [],
  })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedHistorySession, setSelectedHistorySession] = useState(null)
  const [showAggregateStats, setShowAggregateStats] = useState(false)

  const [pendingQueue, setPendingQueue] = useState([])
  const [actionsSubmitted, setActionsSubmitted] = useState(false)
  const [ongoingSessions, setOngoingSessions] = useState([])
  const [mobileTab, setMobileTab] = useState(MOBILE_TABS.PLAYERS)

  const [tourOpen, setTourOpen] = useState(false)
  const [tourIndex, setTourIndex] = useState(0)

  const closeTour = useCallback((save = true) => {
    setTourOpen(false)
    if (save) localStorage.setItem(TOUR_STORAGE_KEY, '1')
  }, [])

  const startTour = useCallback(() => {
    setTourIndex(0)
    setTourOpen(true)
    setMobileTab(MOBILE_TABS.PLAYERS)
  }, [])

  useEffect(() => {
    if (!localStorage.getItem(TOUR_STORAGE_KEY)) {
      const t = setTimeout(() => setTourOpen(true), 600)
      return () => clearTimeout(t)
    }
    return undefined
  }, [])

  useEffect(() => {
    if (!tourOpen) return undefined
    const step = TOUR_STEPS[tourIndex]
    if (!step?.tab || !isMobileLayout()) return undefined

    const tabMap = {
      players: MOBILE_TABS.PLAYERS,
      actions: MOBILE_TABS.ACTIONS,
      scores: MOBILE_TABS.SCORES,
    }
    setMobileTab(tabMap[step.tab] || MOBILE_TABS.PLAYERS)
    return undefined
  }, [tourOpen, tourIndex])

  useEffect(() => {
    if (!gameId) {
      setMobileTab(MOBILE_TABS.PLAYERS)
      return
    }
    if (!isMobileLayout()) return
    if (swapStep) {
      setMobileTab(MOBILE_TABS.PLAYERS)
    } else {
      setMobileTab(MOBILE_TABS.ACTIONS)
    }
  }, [gameId, swapStep])

  const loadPlayers = useCallback(async () => {
    const data = await api.getPlayers()
    setPlayers(Array.isArray(data) ? data : [])
  }, [])

  const loadActionTypes = useCallback(async () => {
    const data = await api.getActionTypes()
    setActionTypes(Array.isArray(data) ? data : [])
  }, [])

  const loadOngoingSessions = useCallback(async () => {
    try {
      const data = await api.getOngoingSessions()
      setOngoingSessions(Array.isArray(data) ? data : [])
    } catch {
      setOngoingSessions([])
    }
  }, [])

  useEffect(() => {
    Promise.all([loadPlayers(), loadActionTypes(), loadOngoingSessions()]).catch((e) =>
      setError(e.message),
    )
  }, [loadPlayers, loadActionTypes, loadOngoingSessions])

  useEffect(() => {
    if (!gameId) {
      loadOngoingSessions()
    }
  }, [gameId, loadOngoingSessions])

  const applyScores = (data) => {
    setScores(data)
    setActionLog(data.actions || [])
    setMatchups(data.matchups || [])
    setActivePlayerIds(data.active_player_ids || [])
  }

  const handleDeleteOngoingSession = async (session) => {
    if (
      !window.confirm(
        `Xóa phiên #${session.session_id}? Ván đang chơi sẽ bị hủy, các ván đã kết thúc vẫn giữ trong lịch sử.`,
      )
    ) {
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.deleteOngoingSession(session.session_id)
      await loadOngoingSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const resumeSession = async (id) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getSession(id)
      if (!data.current_game) {
        throw new Error('Phiên này không còn ván đang chơi')
      }
      const playerIds = data.current_game.players.map((p) => p.player_id)
      setSessionId(data.session.id)
      setGameId(data.current_game.id)
      setRoundNumber(data.round_number || 1)
      setCumulativeScores(data.cumulative_scores || [])
      setSelectedForTable(playerIds)
      setActivePlayerIds(data.scores?.active_player_ids || playerIds)
      if (data.scores) {
        applyScores(data.scores)
        setActionsSubmitted(true)
      } else {
        setScores(null)
        setActionLog([])
        setMatchups([])
        setActionsSubmitted(false)
      }
      setPendingQueue([])
      resetSelection()
      setSwapStep(null)
      setSwapExit(null)
      setMobileTab(MOBILE_TABS.ACTIONS)
    } catch (e) {
      setError(e.message)
      await loadOngoingSessions()
    } finally {
      setLoading(false)
    }
  }

  const startGame = async () => {
    if (selectedForTable.length < 2) {
      setError('Chọn ít nhất 2 người để bắt đầu ván')
      return
    }
    if (selectedForTable.length > MAX_TABLE) {
      setError(`Tối đa ${MAX_TABLE} người ở bàn`)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.createSession(selectedForTable)
      setSessionId(result.session.id)
      setGameId(result.game.id)
      setRoundNumber(1)
      setCumulativeScores([])
      setScores(null)
      setActionLog([])
      setMatchups([])
      setActivePlayerIds(selectedForTable)
      setPendingQueue([])
      setActionsSubmitted(false)
      resetSelection()
      setSwapStep(null)
      setSwapExit(null)
      setMobileTab(MOBILE_TABS.ACTIONS)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resetSelection = () => {
    setStep(STEPS.ACTOR)
    setSelectedActor(null)
    setSelectedAction(null)
  }

  const toggleTablePlayer = (id) => {
    setSelectedForTable((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_TABLE) {
        setError(`Chỉ được chọn tối đa ${MAX_TABLE} người ở bàn`)
        return prev
      }
      setError('')
      return [...prev, id]
    })
  }

  const handleAddPlayer = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setLoading(true)
    setError('')
    try {
      await api.createPlayer(name)
      setNewName('')
      await loadPlayers()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePlayer = async (player) => {
    if (!window.confirm(`Xóa người chơi "${player.name}"?`)) return
    setLoading(true)
    setError('')
    try {
      await api.deletePlayer(player.id)
      setSelectedForTable((prev) => prev.filter((id) => id !== player.id))
      await loadPlayers()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const buildActionLabel = (actor, action, target) =>
    [actor?.name, action?.name, target?.name].filter(Boolean).join(' → ')

  const makeQueueItem = (actor, action, target = null) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    actor_player_id: actor.id,
    actor_name: actor.name,
    action_type_id: action.id,
    action_name: action.name,
    target_player_id: target?.id ?? null,
    target_name: target?.name ?? null,
    label: buildActionLabel(actor, action, target),
  })

  const enqueueAction = (actor, action, target = null, { reset = true } = {}) => {
    if (!actor || !action || actionsSubmitted) return
    setPendingQueue((prev) => [...prev, makeQueueItem(actor, action, target)])
    if (reset) resetSelection()
    setError('')
  }

  const enqueueActionBatch = (items) => {
    if (!items?.length) return
    const stamped = items.map((item, i) => ({
      ...makeQueueItem(item.player, item.action, item.target ?? null),
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    }))
    setPendingQueue((prev) => [...prev, ...stamped])
    setError('')
  }

  const handleRemoveQueueItem = (id) => {
    setPendingQueue((prev) => prev.filter((x) => x.id !== id))
  }

  const handleClearQueue = () => {
    if (actionsSubmitted) return
    setPendingQueue([])
  }

  const handleExecuteQueue = async () => {
    if (!gameId || pendingQueue.length === 0) return
    setLoading(true)
    setError('')
    try {
      const payload = pendingQueue.map((item) => ({
        actor_player_id: item.actor_player_id,
        action_type_id: item.action_type_id,
        ...(item.target_player_id ? { target_player_id: item.target_player_id } : {}),
      }))
      const result = await api.addActionsBatch(gameId, payload)
      applyScores(result.scores)
      setPendingQueue([])
      setActionsSubmitted(true)
      resetSelection()
      if (isMobileLayout()) setMobileTab(MOBILE_TABS.SCORES)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteRound = async () => {
    if (!sessionId || !gameId) return
    setLoading(true)
    setError('')
    try {
      const result = await api.completeRound(sessionId, gameId)
      setCumulativeScores(result.cumulative_scores || [])
      setGameId(result.next_game.id)
      setRoundNumber(result.round_number)
      setScores(null)
      setActionLog([])
      setMatchups([])
      setActivePlayerIds(result.next_game.players?.map((p) => p.player_id) || [])
      setPendingQueue([])
      setActionsSubmitted(false)
      resetSelection()
      setSwapStep(null)
      setSwapExit(null)
      setMobileTab(MOBILE_TABS.ACTIONS)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleNewGame = async () => {
    if (sessionId) {
      try {
        await api.endSession(sessionId)
      } catch {
        /* ignore */
      }
    }
    setSessionId(null)
    setGameId(null)
    setRoundNumber(1)
    setCumulativeScores([])
    setScores(null)
    setActionLog([])
    setMatchups([])
    setActivePlayerIds([])
    setPendingQueue([])
    setActionsSubmitted(false)
    resetSelection()
    setSwapStep(null)
    setSwapExit(null)
    await loadOngoingSessions()
  }

  const startSwap = () => {
    setSwapStep('exit')
    setSwapExit(null)
    resetSelection()
    setError('')
  }

  const cancelSwap = () => {
    setSwapStep(null)
    setSwapExit(null)
  }

  const handleSwapExit = (player) => {
    setSwapExit(player)
    setSwapStep('enter')
  }

  const handleSwapEnter = async (player) => {
    if (!swapExit || !gameId) return
    setLoading(true)
    setError('')
    try {
      const result = await api.swapRoster(gameId, swapExit.id, player.id)
      applyScores(result.scores)
      setSwapStep(null)
      setSwapExit(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const openHistory = async () => {
    setShowHistory(true)
    setSelectedHistorySession(null)
    setShowAggregateStats(false)
    setHistoryLoading(true)
    try {
      const data = await api.getHistory()
      setHistoryData({
        aggregate_matchups: data.aggregate_matchups || [],
        sessions: data.sessions || [],
        standalone_games: data.standalone_games || [],
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  const closeHistory = () => {
    setShowHistory(false)
    setSelectedHistorySession(null)
    setShowAggregateStats(false)
  }

  const activeSet = useMemo(() => new Set(activePlayerIds), [activePlayerIds])

  const tablePlayers = useMemo(
    () => players.filter((p) => activeSet.has(p.id)),
    [players, activeSet],
  )

  const poolPlayers = useMemo(
    () => players.filter((p) => !activeSet.has(p.id)),
    [players, activeSet],
  )

  const boardEnqueue = useCallback(
    (player, action, target = null) => enqueueAction(player, action, target, { reset: false }),
    [],
  )
  const boardEnqueueBatch = useCallback((items) => enqueueActionBatch(items), [])
  const ranksLocked = useMemo(
    () => isRanksCompleteInQueue(pendingQueue, actionTypes, tablePlayers.length),
    [pendingQueue, actionTypes, tablePlayers.length],
  )
  const hasVeTrang = useMemo(
    () => hasVeTrangInQueue(pendingQueue, actionTypes),
    [pendingQueue, actionTypes],
  )
  const columnsLocked = hasVeTrang || actionsSubmitted
  const board = useGameBoardState(
    actionTypes,
    tablePlayers,
    boardEnqueue,
    boardEnqueueBatch,
    ranksLocked,
    columnsLocked,
  )

  const guideMessage = getGuideMessage({
    gameId,
    swapStep,
    swapExit,
    chatDraft: board.chatDraft,
    currentRankDef: board.currentRankDef,
    ranksLocked,
    hasVeTrang,
    actionsSubmitted,
  })

  const panelTabClass = (tab) => (mobileTab === tab ? 'mobile-panel-active' : '')

  return (
    <div className={`app${loading ? ' app--loading' : ''}`}>
      <header className="header">
        <div className="header-brand">
          <div className="header-logo" aria-hidden="true">
            <span className="header-logo-suit">♠</span>
          </div>
          <div className="header-title">
            <h1>Tính điểm Tiến Lên</h1>
            <p className="header-subtitle">Chấm điểm nhanh · theo dõi phiên</p>
          </div>
          {sessionId && (
            <span className="round-badge">Ván {roundNumber}</span>
          )}
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-outline btn-tour-help"
            title="Hướng dẫn sử dụng"
            aria-label="Hướng dẫn sử dụng"
            onClick={startTour}
          >
            <span className="btn-tour-help-icon" aria-hidden="true">
              ?
            </span>
            <span className="btn-tour-help-label">Hướng dẫn</span>
          </button>
          {!gameId ? (
            <button
              type="button"
              className="btn btn-primary"
              data-tour="start-session"
              disabled={loading || selectedForTable.length < 2}
              onClick={startGame}
            >
              Bắt đầu phiên ({selectedForTable.length}/{MAX_TABLE})
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                data-tour="end-round"
                disabled={loading || !scores}
                onClick={handleCompleteRound}
              >
                Kết thúc ván {roundNumber}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                data-tour="history-btn"
                disabled={loading}
                onClick={openHistory}
              >
                Lịch sử đã chơi
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                data-tour="end-session"
                disabled={loading}
                onClick={handleNewGame}
              >
                Kết thúc phiên
              </button>
            </>
          )}
          {gameId === null && (
            <button
              type="button"
              className="btn btn-outline"
              data-tour="history-btn"
              disabled={loading}
              onClick={openHistory}
            >
              Lịch sử đã chơi
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="layout">
        <section className={`panel panel-left ${panelTabClass(MOBILE_TABS.PLAYERS)}`}>
          <form className="add-form" onSubmit={handleAddPlayer}>
            <input
              type="text"
              placeholder="Tên người chơi..."
              data-tour="player-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              data-tour="player-add"
              disabled={loading || !newName.trim()}
            >
              + Thêm người chơi
            </button>
          </form>

          {gameId && !swapStep && (
            <button
              type="button"
              className="btn btn-outline btn-swap"
              disabled={loading || actionsSubmitted}
              onClick={startSwap}
            >
              Đổi người
            </button>
          )}

          {swapStep && (
            <button type="button" className="btn btn-link btn-swap-cancel" onClick={cancelSwap}>
              Hủy đổi người
            </button>
          )}

          {gameId && swapStep === 'exit' && (
            <div className="btn-grid">
              {tablePlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-player active-step"
                  onClick={() => handleSwapExit(p)}
                  disabled={loading}
                >
                  {p.name}
                  <small>Rút bàn</small>
                </button>
              ))}
            </div>
          )}

          {gameId && swapStep === 'enter' && (
            <div className="btn-grid">
              {poolPlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-player active-step"
                  onClick={() => handleSwapEnter(p)}
                  disabled={loading}
                >
                  {p.name}
                  <small>Vào bàn</small>
                </button>
              ))}
              {poolPlayers.length === 0 && <p className="hint">Thêm người chơi mới vào danh sách</p>}
            </div>
          )}

          {!gameId && ongoingSessions.length > 0 && (
            <div className="ongoing-sessions">
              <h3 className="sub-panel-title">Phiên đang dở</h3>
              <div className="ongoing-session-list">
                {ongoingSessions.map((s) => (
                  <div key={s.session_id} className="ongoing-session-btn">
                    <button
                      type="button"
                      className="ongoing-session-main"
                      disabled={loading}
                      onClick={() => resumeSession(s.session_id)}
                    >
                      <span className="ongoing-session-title">Phiên #{s.session_id}</span>
                      <span className="ongoing-session-meta">
                        Ván {s.round_number}
                        {s.completed_rounds > 0 && ` · ${s.completed_rounds} ván xong`}
                      </span>
                      {s.player_names?.length > 0 && (
                        <span className="ongoing-session-players">{s.player_names.join(' · ')}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-delete ongoing-session-delete"
                      title="Xóa phiên"
                      disabled={loading}
                      onClick={() => handleDeleteOngoingSession(s)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="sub-panel-title">Tất cả người chơi</h3>
          {!gameId && <p className="hint">Chọn 2–{MAX_TABLE} người để bắt đầu phiên</p>}

          <div className="btn-grid player-picker-scroll" data-tour="player-select">
            {players.map((p) => {
              const atTable = activeSet.has(p.id)
              return (
                <div
                  key={p.id}
                  className={`player-check ${!gameId && selectedForTable.includes(p.id) ? 'checked' : ''}${gameId && atTable ? ' at-table' : ''}`}
                >
                  {!gameId ? (
                    <label className="player-check-label">
                      <input
                        type="checkbox"
                        checked={selectedForTable.includes(p.id)}
                        onChange={() => toggleTablePlayer(p.id)}
                        disabled={loading}
                      />
                      <span>{p.name}</span>
                    </label>
                  ) : (
                    <span className="player-check-label player-check-name">
                      {p.name}
                      {atTable && <span className="status-tag active-tag">ở bàn</span>}
                      {!atTable && gameId && <span className="status-tag">ngoài bàn</span>}
                    </span>
                  )}
                  {!gameId && (
                    <button
                      type="button"
                      className="btn-delete"
                      title="Xóa người chơi"
                      disabled={loading}
                      onClick={() => handleDeletePlayer(p)}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {players.length === 0 && <p className="hint">Chưa có người chơi</p>}
        </section>

        <section className={`panel panel-center ${panelTabClass(MOBILE_TABS.ACTIONS)}`}>
          <div className="board-stack">
            <GameGuideBlock
              message={guideMessage}
              chatDraft={board.chatDraft}
              onCancelChat={board.cancelChat}
              loading={loading}
              actionsSubmitted={actionsSubmitted}
            />

            {gameId && !swapStep && (
              <GameQueueBlock
                pendingQueue={pendingQueue}
                loading={loading}
                onClear={handleClearQueue}
                onExecute={handleExecuteQueue}
                onRemove={handleRemoveQueueItem}
                actionsSubmitted={actionsSubmitted}
              />
            )}

            {gameId && !swapStep && (
              <GamePlayerColumns
                tablePlayers={tablePlayers}
                actionTypes={actionTypes}
                board={board}
                loading={loading}
                ranksLocked={ranksLocked}
                columnsLocked={columnsLocked}
              />
            )}

            {!gameId && (
              <div className="welcome-card board-welcome">
                <div className="welcome-card-icon" aria-hidden="true">
                  <span>♠</span>
                  <span>♥</span>
                  <span>♦</span>
                  <span>♣</span>
                </div>
                <h3>Sẵn sàng chơi</h3>
                <p>
                  Thêm người chơi bên trái, chọn 2–{MAX_TABLE} người rồi bấm{' '}
                  <strong>Bắt đầu phiên</strong>.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className={`panel panel-right ${panelTabClass(MOBILE_TABS.SCORES)}`}>
          <h2 className="right-section-title">Tổng kết quả phiên</h2>
          {cumulativeScores.length > 0 ? (
            <CumulativeTable scores={cumulativeScores} />
          ) : (
            <p className="hint">Chưa có dữ liệu tổng phiên</p>
          )}

          <h2 className="right-section-title right-section-gap">
            Kết quả ván {sessionId ? roundNumber : 'hiện tại'}
          </h2>
          {!scores && (
            <p className="hint">
              {pendingQueue.length > 0
                ? 'Bấm Xác nhận & tổng hợp để tính điểm'
                : 'Điểm hiển thị sau khi xác nhận hành động'}
            </p>
          )}
          {scores && (
            <>
              <ScoreTable scores={scores.scores} />
              <MatchupTable matchups={matchups} title="Đối đầu ván (ròng)" mode="loss" />
              {actionLog.length > 0 && (
                <div className="log">
                  <h3>Lịch sử ván</h3>
                  <ul>
                    {actionLog.map((item, i) => (
                      <li key={i}>{item.description}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {showHistory && (
        <div className="modal-overlay" onClick={closeHistory}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lịch sử đã chơi</h2>
              <button
                type="button"
                className="btn-delete modal-close"
                title="Đóng"
                aria-label="Đóng"
                onClick={closeHistory}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {historyLoading && <p className="hint">Đang tải...</p>}
              {!historyLoading &&
                historyData.aggregate_matchups.length === 0 &&
                historyData.sessions.length === 0 &&
                historyData.standalone_games.length === 0 && (
                  <p className="hint">Chưa có ván nào được ghi nhận</p>
                )}
              {!historyLoading && historyData.aggregate_matchups.length > 0 && (
                <div className="history-session-list history-aggregate-entry">
                  <button
                    type="button"
                    className="history-session-btn"
                    onClick={() => setShowAggregateStats(true)}
                  >
                    <span className="history-session-btn-main">
                      <span className="history-session-btn-title">Thống kê đối đầu (tất cả)</span>
                    </span>
                    <span className="history-session-btn-meta">
                      <span className="history-badge">{historyData.aggregate_matchups.length} cặp</span>
                    </span>
                  </button>
                </div>
              )}
              {!historyLoading && historyData.sessions.length > 0 && (
                <div className="history-session-list" data-tour="history-sessions">
                  <p className="history-subtitle">Danh sách phiên</p>
                  {historyData.sessions.map((session) => (
                    <HistorySessionButton
                      key={session.session_id}
                      session={session}
                      onClick={() => setSelectedHistorySession(session)}
                    />
                  ))}
                </div>
              )}
              {!historyLoading && historyData.standalone_games.length > 0 && (
                <div className="history-session-list">
                  <HistorySessionButton
                    session={{
                      isStandalone: true,
                      title: 'Ván đơn lẻ',
                      rounds: historyData.standalone_games,
                      cumulative_scores: [],
                      created_at: historyData.standalone_games[0]?.played_at,
                    }}
                    onClick={() =>
                      setSelectedHistorySession({
                        isStandalone: true,
                        title: 'Ván đơn lẻ',
                        rounds: historyData.standalone_games,
                        cumulative_scores: [],
                        created_at: historyData.standalone_games[0]?.played_at,
                      })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAggregateStats && (
        <HistoryAggregateStatsModal
          matchups={historyData.aggregate_matchups}
          totalGames={
            historyData.sessions.reduce((n, s) => n + (s.rounds?.length || 0), 0) +
            historyData.standalone_games.length
          }
          onClose={() => setShowAggregateStats(false)}
        />
      )}

      {selectedHistorySession && (
        <HistorySessionDetailModal
          session={selectedHistorySession}
          onClose={() => setSelectedHistorySession(null)}
        />
      )}

      <TourGuide
        open={tourOpen}
        step={tourIndex}
        steps={TOUR_STEPS}
        onNext={() => setTourIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1))}
        onPrev={() => setTourIndex((i) => Math.max(i - 1, 0))}
        onSkip={() => closeTour(true)}
        onFinish={() => closeTour(true)}
      />

      <nav className="mobile-nav" aria-label="Điều hướng chính">
        <button
          type="button"
          className={`mobile-nav-btn ${mobileTab === MOBILE_TABS.PLAYERS ? 'active' : ''}`}
          onClick={() => setMobileTab(MOBILE_TABS.PLAYERS)}
        >
          Người chơi
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${mobileTab === MOBILE_TABS.ACTIONS ? 'active' : ''}`}
          onClick={() => setMobileTab(MOBILE_TABS.ACTIONS)}
          disabled={!gameId}
        >
          Hành động
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${mobileTab === MOBILE_TABS.SCORES ? 'active' : ''}`}
          onClick={() => setMobileTab(MOBILE_TABS.SCORES)}
          disabled={!gameId}
        >
          Kết quả
        </button>
      </nav>
    </div>
  )
}

function HistoryAggregateStatsModal({ matchups, totalGames, onClose }) {
  return (
    <div className="modal-overlay modal-overlay-detail" onClick={onClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Thống kê đối đầu (tất cả)</h2>
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
          <div className="history-detail-meta">
            <span className="history-badge">{matchups.length} cặp</span>
            {totalGames > 0 && <span className="history-badge">{totalGames} ván</span>}
          </div>

          <section className="history-session-stats">
            <p className="history-section-title">Thống kê đối đầu</p>
            {matchups.length > 0 ? (
              <>
                <p className="hint history-stats-hint history-matchup-hint">
                  Mỗi dòng là kết quả ròng giữa 2 người — xem chi tiết hai chiều bên dưới từng dòng
                </p>
                <MatchupTable matchups={matchups} title="Ai thua ai (ròng)" mode="loss" />
              </>
            ) : (
              <p className="hint history-stats-empty">Chưa có dữ liệu đối đầu.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function HistorySessionButton({ session, onClick }) {
  const playerNames = session.rounds[0]?.players?.map((p) => p.player_name).join(' · ') || ''
  const title = session.isStandalone
    ? session.title
    : `Phiên #${session.session_id}`
  return (
    <button type="button" className="history-session-btn" onClick={onClick}>
      <span className="history-session-btn-main">
        <span className="history-session-btn-title">{title}</span>
        {session.status === 'ongoing' && <span className="history-badge">đang chơi</span>}
      </span>
      <span className="history-session-btn-meta">
        {session.created_at && (
          <span className="history-date">{formatDate(session.created_at)}</span>
        )}
        <span className="history-badge">{session.rounds.length} ván</span>
      </span>
      {playerNames && <span className="history-session-btn-players">{playerNames}</span>}
    </button>
  )
}

function aggregateSessionMatchups(rounds) {
  const directed = []
  for (const round of rounds || []) {
    directed.push(...(round.matchups || []))
  }
  return consolidateMatchups(directed)
}

function getSessionCumulativeScores(session) {
  if (session.cumulative_scores?.length) return session.cumulative_scores
  const totals = {}
  for (const round of session.rounds || []) {
    for (const row of round.results || []) {
      const pid = row.player_id
      if (!totals[pid]) {
        totals[pid] = {
          player_id: pid,
          player_name: row.player_name,
          finish: 0,
          chat: 0,
          penalty: 0,
          total: 0,
          rounds_played: 0,
        }
      }
      const t = totals[pid]
      t.finish += row.finish ?? row.finish_points ?? 0
      t.chat += row.chat ?? row.chat_points ?? 0
      t.penalty += row.penalty ?? row.penalty_points ?? 0
      t.total += row.total ?? row.total_points ?? 0
      t.rounds_played += 1
    }
  }
  return Object.values(totals).sort((a, b) => b.total - a.total)
}

function HistorySessionDetailModal({ session, onClose }) {
  const [activityLogs, setActivityLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)

  const playerNames = session.rounds[0]?.players?.map((p) => p.player_name).join(' · ') || ''
  const title = session.isStandalone
    ? session.title
    : `Phiên #${session.session_id}`

  const cumulativeScores = useMemo(() => getSessionCumulativeScores(session), [session])
  const sessionMatchups = useMemo(
    () =>
      session.session_matchups?.length
        ? session.session_matchups
        : aggregateSessionMatchups(session.rounds),
    [session],
  )

  useEffect(() => {
    let cancelled = false
    const loadLogs = async () => {
      setLogsLoading(true)
      try {
        let data = []
        if (session.session_id) {
          data = await api.getSessionActivityLogs(session.session_id)
        } else if (session.rounds?.length === 1) {
          data = await api.getGameActivityLogs(session.rounds[0].id)
        } else if (session.rounds?.length > 1) {
          const chunks = await Promise.all(
            session.rounds.map((g) => api.getGameActivityLogs(g.id)),
          )
          data = chunks.flat()
        }
        if (!cancelled) setActivityLogs(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setActivityLogs([])
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    }
    loadLogs()
    return () => {
      cancelled = true
    }
  }, [session])

  const topPlayer = cumulativeScores[0]
  const bottomPlayer = cumulativeScores[cumulativeScores.length - 1]

  return (
    <div className="modal-overlay modal-overlay-detail" onClick={onClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
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
        <div className="modal-body history-scroll" data-tour="history-detail">
          <div className="history-detail-meta">
            {session.created_at && (
              <span className="history-date">{formatDate(session.created_at)}</span>
            )}
            {session.status === 'ongoing' && <span className="history-badge">đang chơi</span>}
            <span className="history-badge">{session.rounds.length} ván</span>
          </div>
          {playerNames && <p className="history-players">{playerNames}</p>}

          <section className="history-session-stats">
            <p className="history-section-title">Thống kê phiên</p>

            {cumulativeScores.length > 0 && (
              <>
                {topPlayer && (
                  <div className="history-rank-summary">
                    {cumulativeScores.length > 1 &&
                      topPlayer.total !== bottomPlayer?.total && (
                      <span className="history-rank-chip history-rank-chip--top">
                        Dẫn điểm: <strong>{topPlayer.player_name}</strong>{' '}
                        <span className="pos">+{topPlayer.total}</span>
                      </span>
                    )}
                    {bottomPlayer &&
                      cumulativeScores.length > 1 &&
                      bottomPlayer.player_id !== topPlayer?.player_id && (
                      <span className="history-rank-chip history-rank-chip--bottom">
                        Thua nhiều nhất: <strong>{bottomPlayer.player_name}</strong>{' '}
                        <span className={bottomPlayer.total >= 0 ? 'pos' : 'neg'}>
                          {bottomPlayer.total > 0 ? `+${bottomPlayer.total}` : bottomPlayer.total}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <div className="history-cumulative">
                  <p className="history-subtitle">Bảng tổng điểm</p>
                  <CumulativeTable scores={cumulativeScores} />
                </div>
              </>
            )}

            {sessionMatchups.length > 0 ? (
              <>
                <p className="hint history-stats-hint history-matchup-hint">
                  Mỗi dòng là kết quả ròng giữa 2 người — xem chi tiết hai chiều bên dưới từng dòng
                </p>
                <MatchupTable
                  matchups={sessionMatchups}
                  title="Ai thua ai (ròng)"
                  mode="loss"
                />
              </>
            ) : (
              <p className="hint history-stats-empty">Chưa có dữ liệu đối đầu trong phiên này.</p>
            )}
          </section>

          <section className="history-activity-log">
            <p className="history-subtitle">Nhật ký hành động &amp; kết quả</p>
            {logsLoading && <p className="hint">Đang tải nhật ký...</p>}
            {!logsLoading && activityLogs.length === 0 && (
              <p className="hint">Chưa có nhật ký (ván hoàn thành sau khi cập nhật sẽ có dữ liệu).</p>
            )}
            {!logsLoading && activityLogs.length > 0 && (
              <ActivityLogTable logs={activityLogs} />
            )}
          </section>

          <p className="history-subtitle">Chi tiết từng ván</p>
          {session.rounds.map((game) => (
            <HistoryRoundBlock
              key={game.id}
              game={game}
              showStandalone={session.isStandalone}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function HistoryRoundBlock({ game, showStandalone }) {
  const players = (game.players || []).map((p) => p.player_name).join(' · ')
  const title = showStandalone
    ? formatDate(game.played_at)
    : `Ván ${game.round_number || '?'}`
  return (
    <div className="history-round-block">
      <div className="history-round-header">
        <span className="history-round-title">{title}</span>
        <span className="history-summary-meta">
          {!showStandalone && game.played_at && (
            <span className="history-date">{formatDate(game.played_at)}</span>
          )}
          <span className="history-badge">{game.action_count} hành động</span>
        </span>
      </div>
      {players && <p className="history-players">{players}</p>}
      <ScoreTable scores={game.results} compact />
      {game.matchups?.length > 0 && (
        <MatchupTable
          matchups={game.matchups}
          compact
          title="Ai thua ai (ròng)"
          mode="loss"
        />
      )}
      {game.action_log?.length > 0 && (
        <div className="log history-round-log">
          <h3>Lịch sử ván</h3>
          <ul>
            {game.action_log.map((item, i) => (
              <li key={i}>{item.description}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function normalizeScore(s) {
  return {
    ...s,
    finish: s.finish ?? s.finish_points ?? 0,
    chat: s.chat ?? s.chat_points ?? 0,
    penalty: s.penalty ?? s.penalty_points ?? 0,
    total: s.total ?? s.total_points ?? 0,
  }
}

function CumulativeTable({ scores }) {
  if (!scores?.length) return null
  return (
    <div className="score-table cumulative compact">
      <div className="score-header">
        <span>Người chơi</span>
        <span>Ván</span>
        <span>Tổng</span>
      </div>
      {scores.map((s) => (
        <div key={s.player_id} className="score-row">
          <span className="name">{s.player_name}</span>
          <span>{s.rounds_played}</span>
          <span className={`total ${s.total >= 0 ? 'pos' : 'neg'}`}>{s.total}</span>
        </div>
      ))}
    </div>
  )
}

function ActivityLogTable({ logs }) {
  return (
    <ul className="activity-log-list">
      {logs.map((log) => (
        <li key={log.id} className={`activity-log-item activity-log-${log.event_type}`}>
          <span className="activity-log-text">{log.description}</span>
          {log.total_points != null && log.event_type === 'result' && (
            <span className={`activity-log-total ${log.total_points >= 0 ? 'pos' : 'neg'}`}>
              {log.total_points > 0 ? `+${log.total_points}` : log.total_points}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function MatchupTable({ matchups, compact, title = 'Đối đầu ròng', mode = 'loss' }) {
  const consolidated = useMemo(() => consolidateMatchups(matchups || []), [matchups])
  if (!consolidated.length) return null
  const lossView = mode === 'loss'

  return (
    <div className={`matchup-block ${compact ? 'compact' : ''}${lossView ? ' matchup-block--loss' : ''}`}>
      <h3>{title}</h3>
      <ul className="matchup-list">
        {consolidated.map((m) => (
          <li key={`${m.player_a_id}-${m.player_b_id}`} className="matchup-list-item">
            <div className="matchup-net-row">
              {m.is_tie ? (
                <>
                  <span className="matchup-winner">{m.player_a_name}</span>
                  <span className="matchup-vs">hòa</span>
                  <span className="matchup-loser">{m.player_b_name}</span>
                  <span className="matchup-detail">0</span>
                </>
              ) : lossView ? (
                <>
                  <span className="matchup-loser matchup-focus">{m.loser_name}</span>
                  <span className="matchup-vs">thua ròng</span>
                  <span className="matchup-winner">{m.winner_name}</span>
                  <span className="matchup-detail neg">−{m.points}</span>
                </>
              ) : (
                <>
                  <span className="matchup-winner">{m.winner_name}</span>
                  <span className="matchup-vs">lời ròng</span>
                  <span className="matchup-loser">{m.loser_name}</span>
                  <span className="matchup-detail pos">+{m.points}</span>
                </>
              )}
            </div>
            {(m.gross_a_beats_b > 0 || m.gross_b_beats_a > 0) && (
              <p className="matchup-breakdown">{formatMatchupBreakdown(m)}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScoreTable({ scores, compact }) {
  if (!scores?.length) return null
  return (
    <div className={`score-table ${compact ? 'compact' : ''}`}>
      <div className="score-header">
        <span>Người chơi</span>
        <span>Về</span>
        <span>Chặt</span>
        <span>Phạt</span>
        <span>Tổng</span>
      </div>
      {[...scores]
        .map(normalizeScore)
        .sort((a, b) => b.total - a.total)
        .map((s) => (
          <div
            key={s.player_id}
            className={`score-row ${s.is_frozen ? 'frozen-row' : ''}`}
          >
            <span className="name">
              {s.player_name}
              {s.is_frozen && <span className="status-tag">đóng băng</span>}
              {s.is_at_table && <span className="status-tag active-tag">ở bàn</span>}
            </span>
            <span className={s.finish >= 0 ? 'pos' : 'neg'}>{s.finish}</span>
            <span className={s.chat >= 0 ? 'pos' : 'neg'}>{s.chat}</span>
            <span className={s.penalty >= 0 ? 'pos' : 'neg'}>{s.penalty}</span>
            <span className={`total ${s.total >= 0 ? 'pos' : 'neg'}`}>{s.total}</span>
          </div>
        ))}
    </div>
  )
}

export default App
