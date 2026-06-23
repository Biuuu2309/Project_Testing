import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api/client'
import TourGuide from './components/TourGuide'
import { TOUR_STEPS, TOUR_STORAGE_KEY } from './tourSteps'
import './App.css'

const MAX_TABLE = 4
const STEPS = { ACTOR: 'actor', ACTION: 'action', TARGET: 'target' }
const MOBILE_TABS = { PLAYERS: 'players', ACTIONS: 'actions', SCORES: 'scores' }

function isMobileLayout() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
}

const CHAT_CODES = new Set([
  'CHAT_HEO_DEN',
  'CHAT_HEO_DO',
  'CHAT_3_DOI_THONG',
  'CHAT_4_DOI_THONG',
  'CHAT_TU_QUY',
])

function needsTarget(action) {
  return action?.category === 'chat'
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

  const [pendingQueue, setPendingQueue] = useState([])
  const [ongoingSessions, setOngoingSessions] = useState([])
  const [mobileTab, setMobileTab] = useState(MOBILE_TABS.PLAYERS)

  const [tourOpen, setTourOpen] = useState(false)
  const [tourIndex, setTourIndex] = useState(0)
  const tourBaseline = useRef({ playersOnEnter: 0, hadScores: false })
  const tourAdvanceTimer = useRef(null)

  const advanceTour = useCallback((delay = 450) => {
    if (tourAdvanceTimer.current) clearTimeout(tourAdvanceTimer.current)
    tourAdvanceTimer.current = setTimeout(() => {
      setTourIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1))
    }, delay)
  }, [])

  const closeTour = useCallback((save = true) => {
    if (tourAdvanceTimer.current) clearTimeout(tourAdvanceTimer.current)
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
    if (!step) return undefined

    if (step.tab && isMobileLayout()) {
      const tabMap = {
        players: MOBILE_TABS.PLAYERS,
        actions: MOBILE_TABS.ACTIONS,
        scores: MOBILE_TABS.SCORES,
      }
      setMobileTab(tabMap[step.tab] || MOBILE_TABS.PLAYERS)
    }

    if (step.id === 'player-add') {
      tourBaseline.current.playersOnEnter = players.length
    }
    if (step.id === 'queue-execute') {
      tourBaseline.current.hadScores = Boolean(scores)
    }
    if (step.id === 'end-session') {
      tourBaseline.current.hadGameOnEndSessionStep = Boolean(gameId || sessionId)
    }

    return undefined
  }, [tourOpen, tourIndex, players.length, scores])

  useEffect(() => {
    if (!tourOpen || tourIndex >= TOUR_STEPS.length - 1) return undefined
    const id = TOUR_STEPS[tourIndex]?.id
    let ready = false

    switch (id) {
      case 'player-name':
        ready = newName.trim().length > 0
        break
      case 'player-add':
        ready = players.length > tourBaseline.current.playersOnEnter
        break
      case 'player-select':
        ready = selectedForTable.length >= 2
        break
      case 'start-session':
        ready = Boolean(gameId)
        break
      case 'pick-actor':
        ready = Boolean(selectedActor)
        break
      case 'pick-action':
        ready = pendingQueue.length > 0
        break
      case 'queue-execute':
        ready = Boolean(scores) && !tourBaseline.current.hadScores
        break
      case 'end-round':
        ready = cumulativeScores.length > 0
        break
      case 'end-session':
        ready = !gameId && !sessionId && tourBaseline.current.hadGameOnEndSessionStep
        break
      case 'open-history':
        ready = showHistory
        break
      case 'pick-session':
        ready = Boolean(selectedHistorySession)
        break
      default:
        break
    }

    if (!ready) return undefined
    const delay = id === 'player-name' ? 700 : 450
    advanceTour(delay)
    return () => {
      if (tourAdvanceTimer.current) clearTimeout(tourAdvanceTimer.current)
    }
  }, [
    tourOpen,
    tourIndex,
    newName,
    players.length,
    selectedForTable.length,
    gameId,
    sessionId,
    selectedActor,
    pendingQueue.length,
    scores,
    cumulativeScores.length,
    showHistory,
    selectedHistorySession,
    advanceTour,
  ])

  const tourSteps = useMemo(
    () =>
      TOUR_STEPS.map((s) => ({
        ...s,
        requireAction: tourIndex < TOUR_STEPS.length - 1,
      })),
    [tourIndex],
  )

  useEffect(() => {
    if (!gameId) {
      setMobileTab(MOBILE_TABS.PLAYERS)
      return
    }
    if (!isMobileLayout()) return
    if (swapStep || step === STEPS.ACTOR || step === STEPS.TARGET) {
      setMobileTab(MOBILE_TABS.PLAYERS)
    } else if (step === STEPS.ACTION) {
      setMobileTab(MOBILE_TABS.ACTIONS)
    }
  }, [gameId, step, swapStep])

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
      } else {
        setScores(null)
        setActionLog([])
        setMatchups([])
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

  const handleSelectActor = (player) => {
    if (step !== STEPS.ACTOR) return
    setSelectedActor(player)
    setStep(STEPS.ACTION)
  }

  const buildActionLabel = (actor, action, target) =>
    [actor?.name, action?.name, target?.name].filter(Boolean).join(' → ')

  const enqueueAction = (actor, action, target = null) => {
    if (!actor || !action) return
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actor_player_id: actor.id,
      actor_name: actor.name,
      action_type_id: action.id,
      action_name: action.name,
      target_player_id: target?.id ?? null,
      target_name: target?.name ?? null,
      label: buildActionLabel(actor, action, target),
    }
    setPendingQueue((prev) => [...prev, item])
    resetSelection()
    setError('')
  }

  const handleSelectAction = (action) => {
    setSelectedAction(action)
    if (needsTarget(action)) {
      setStep(STEPS.TARGET)
    } else {
      enqueueAction(selectedActor, action)
    }
  }

  const handleSelectTarget = (player) => {
    if (player.id === selectedActor?.id) return
    enqueueAction(selectedActor, selectedAction, player)
  }

  const handleRemoveQueueItem = (id) => {
    setPendingQueue((prev) => prev.filter((x) => x.id !== id))
  }

  const handleClearQueue = () => {
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

  const groupedActions = useMemo(() => {
    const groups = { finish: [], chat: [], penalty: [] }
    for (const a of actionTypes) {
      if (a.category === 'finish') groups.finish.push(a)
      else if (a.category === 'chat' && CHAT_CODES.has(a.code)) groups.chat.push(a)
      else if (a.category === 'penalty') groups.penalty.push(a)
    }
    return groups
  }, [actionTypes])

  const stepLabel = swapStep
    ? swapStep === 'exit'
      ? 'Chọn người rút khỏi bàn'
      : `Chọn người vào thay ${swapExit?.name}`
    : {
        [STEPS.ACTOR]: '1. Chọn người chơi',
        [STEPS.ACTION]: '2. Chọn hành động',
        [STEPS.TARGET]: '3. Chọn người bị chặt',
      }[step]

  const panelTabClass = (tab) => (mobileTab === tab ? 'mobile-panel-active' : '')
  const stepIndex = [STEPS.ACTOR, STEPS.ACTION, STEPS.TARGET].indexOf(step)

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
            ?
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
                disabled={loading}
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
          <h2>Người chơi</h2>
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
              + Thêm
            </button>
          </form>

          {!gameId && ongoingSessions.length > 0 && (
            <div className="ongoing-sessions">
              <h3 className="sub-panel-title">Phiên đang dở</h3>
              <p className="hint ongoing-hint">Chọn phiên để tiếp tục chơi</p>
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
                      {s.created_at && (
                        <span className="ongoing-session-date">{formatDate(s.created_at)}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-delete ongoing-session-delete"
                      title="Xóa phiên"
                      aria-label="Xóa phiên"
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

          {!gameId && (
            <p className="hint">Chọn 2–{MAX_TABLE} người ở bàn để bắt đầu</p>
          )}

          {gameId && !swapStep && (
            <button type="button" className="btn btn-outline btn-swap" disabled={loading} onClick={startSwap}>
              Đổi người
            </button>
          )}

          {swapStep && (
            <button type="button" className="btn btn-link btn-swap-cancel" onClick={cancelSwap}>
              Hủy đổi người
            </button>
          )}

          {!gameId && (
            <div className="btn-grid player-picker-scroll" data-tour="player-select">
              {players.map((p) => (
                <div key={p.id} className={`player-check ${selectedForTable.includes(p.id) ? 'checked' : ''}`}>
                  <label className="player-check-label">
                    <input
                      type="checkbox"
                      checked={selectedForTable.includes(p.id)}
                      onChange={() => toggleTablePlayer(p.id)}
                      disabled={loading}
                    />
                    <span>{p.name}</span>
                  </label>
                  <button
                    type="button"
                    className="btn-delete"
                    title="Xóa người chơi"
                    disabled={loading}
                    onClick={() => handleDeletePlayer(p)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
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

          {gameId && !swapStep && (
            <>
              <p className="section-label">Đang ở bàn</p>
              <div className="btn-grid" data-tour="table-players">
                {tablePlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={[
                      'btn',
                      'btn-player',
                      selectedActor?.id === p.id && step !== STEPS.ACTOR ? 'selected' : '',
                      step === STEPS.ACTOR ? 'active-step' : '',
                      step === STEPS.TARGET && selectedActor?.id !== p.id ? 'active-step' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (step === STEPS.ACTOR) handleSelectActor(p)
                      else if (step === STEPS.TARGET) handleSelectTarget(p)
                    }}
                    disabled={
                      loading ||
                      (step !== STEPS.ACTOR && step !== STEPS.TARGET) ||
                      (step === STEPS.TARGET && p.id === selectedActor?.id)
                    }
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {poolPlayers.length > 0 && (
                <>
                  <p className="section-label muted">Ngoài bàn (đóng băng / chờ vào)</p>
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
          )}

          {players.length === 0 && <p className="hint">Chưa có người chơi</p>}
        </section>

        <section className={`panel panel-center ${panelTabClass(MOBILE_TABS.ACTIONS)}`}>
          {gameId && !swapStep && (
            <div className="queue-bar">
              <div className="queue-bar-inner">
                <div className="queue-header">
                  <span className="queue-label">Danh sách chờ ({pendingQueue.length})</span>
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-queue-sm"
                      disabled={loading || pendingQueue.length === 0}
                      onClick={handleClearQueue}
                    >
                      Xóa hết
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-queue-run"
                      data-tour="queue-execute"
                      disabled={loading || pendingQueue.length === 0}
                      onClick={handleExecuteQueue}
                    >
                      {loading ? 'Đang thực hiện...' : `Hoàn thành (${pendingQueue.length})`}
                    </button>
                  </div>
                </div>
                {pendingQueue.length === 0 ? (
                  <p className="queue-empty">Chưa có hành động — chọn người chơi và hành động để thêm tự động</p>
                ) : (
                  <ul className="queue-list">
                    {pendingQueue.map((item, i) => (
                      <li key={item.id} className="queue-item">
                        <span className="queue-index">{i + 1}.</span>
                        <span className="queue-text">{item.label}</span>
                        <button
                          type="button"
                          className="btn-delete queue-delete"
                          title="Xóa"
                          disabled={loading}
                          onClick={() => handleRemoveQueueItem(item.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="step-bar">
            <div className="step-bar-main">
              {gameId && !swapStep && (
                <div className="step-progress" aria-hidden="true">
                  {[STEPS.ACTOR, STEPS.ACTION, STEPS.TARGET].map((s, i) => (
                    <span
                      key={s}
                      className={[
                        'step-dot',
                        step === s ? 'active' : '',
                        stepIndex > i ? 'done' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    />
                  ))}
                </div>
              )}
              <span className="step-label">{stepLabel}</span>
            </div>
            {!swapStep && step !== STEPS.ACTOR && (
              <button
                type="button"
                className="btn-delete step-cancel"
                title="Hủy chọn"
                aria-label="Hủy chọn"
                onClick={resetSelection}
              >
                ×
              </button>
            )}
          </div>

          {!gameId && (
            <div className="welcome-card">
              <div className="welcome-card-icon" aria-hidden="true">
                <span>♠</span>
                <span>♥</span>
                <span>♦</span>
                <span>♣</span>
              </div>
              <h3>Sẵn sàng chơi</h3>
              <p>Thêm người chơi bên trái, chọn 2–{MAX_TABLE} người ở bàn rồi bấm <strong>Bắt đầu phiên</strong>.</p>
            </div>
          )}

          {!swapStep && step === STEPS.ACTION && (
            <div data-tour="action-panel">
              <ActionGroup title="Về bài" actions={groupedActions.finish} onSelect={handleSelectAction} />
              <ActionGroup title="Chặt" actions={groupedActions.chat} onSelect={handleSelectAction} />
              <ActionGroup title="Phạt" actions={groupedActions.penalty} onSelect={handleSelectAction} />
            </div>
          )}

          {!swapStep && (step === STEPS.ACTOR || step === STEPS.TARGET) && (
            <p className="hint center-hint">
              {step === STEPS.ACTOR
                ? 'Chọn người đang ở bàn (tab Người chơi)'
                : 'Chọn người bị chặt — sẽ tự thêm vào danh sách chờ'}
            </p>
          )}

          {swapStep && (
            <p className="hint center-hint">
              {swapStep === 'exit'
                ? 'Chọn người rút khỏi bàn — điểm sẽ tạm đóng băng'
                : 'Chọn người vào bàn — bắt đầu tính điểm từ đây'}
            </p>
          )}
        </section>

        <section className={`panel panel-right ${panelTabClass(MOBILE_TABS.SCORES)}`}>
          <h2>Kết quả ván {sessionId ? roundNumber : ''}</h2>
          {cumulativeScores.length > 0 && (
            <>
              <h3 className="sub-panel-title">Tổng điểm phiên</h3>
              <CumulativeTable scores={cumulativeScores} />
            </>
          )}
          {!scores && (
            <p className="hint">
              {pendingQueue.length > 0
                ? 'Bấm Hoàn thành để tính điểm'
                : 'Điểm sẽ hiển thị sau khi hoàn thành danh sách hành động'}
            </p>
          )}
          {scores && (
            <>
              <ScoreTable scores={scores.scores} />
              <MatchupTable matchups={matchups} />
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
                <details className="history-accordion history-stats-accordion">
                  <summary className="history-accordion-summary">
                    <span>Thống kê đối đầu (tất cả)</span>
                    <span className="history-badge">{historyData.aggregate_matchups.length} cặp</span>
                  </summary>
                  <div className="history-accordion-body history-scroll">
                    <p className="hint history-stats-hint">Ai ăn ai bao nhiêu điểm qua các ván đã kết thúc</p>
                    <MatchupTable matchups={historyData.aggregate_matchups} compact />
                  </div>
                </details>
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

      {selectedHistorySession && (
        <HistorySessionDetailModal
          session={selectedHistorySession}
          onClose={() => setSelectedHistorySession(null)}
        />
      )}

      <TourGuide
        open={tourOpen}
        step={tourIndex}
        steps={tourSteps}
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

function HistorySessionDetailModal({ session, onClose }) {
  const playerNames = session.rounds[0]?.players?.map((p) => p.player_name).join(' · ') || ''
  const title = session.isStandalone
    ? session.title
    : `Phiên #${session.session_id}`

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
          {session.cumulative_scores?.length > 0 && (
            <div className="history-cumulative">
              <p className="history-subtitle">Tổng điểm phiên</p>
              <CumulativeTable scores={session.cumulative_scores} />
            </div>
          )}
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
      {game.matchups?.length > 0 && <MatchupTable matchups={game.matchups} compact />}
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

function MatchupTable({ matchups, compact }) {
  if (!matchups?.length) return null
  return (
    <div className={`matchup-block ${compact ? 'compact' : ''}`}>
      <h3>Đối đầu</h3>
      <ul className="matchup-list">
        {matchups.map((m, i) => (
          <li key={i}>
            <span className="matchup-winner">{m.winner_name}</span>
            <span className="matchup-vs">thắng</span>
            <span className="matchup-loser">{m.loser_name}</span>
            <span className="matchup-pts pos">+{m.points}</span>
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

function ActionGroup({ title, actions, onSelect }) {
  if (!actions.length) return null
  const finishHint = {
    VE_NHAT: '+10 từ bét',
    VE_NHI: '+5 từ ba',
    VE_BA: '-5 cho nhì',
    VE_BON: '-10 cho nhất',
  }
  return (
    <div className="action-group">
      <h3>{title}</h3>
      <div className="btn-grid">
        {actions.map((a) => (
          <button key={a.id} type="button" className="btn btn-action" onClick={() => onSelect(a)}>
            {a.name}
            <small>{finishHint[a.code] || (a.base_points > 0 ? `+${a.base_points}` : a.base_points)}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

export default App
