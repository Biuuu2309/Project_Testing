const BASE = import.meta.env.VITE_API_URL || '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      BASE.startsWith('http')
        ? 'Phản hồi không hợp lệ từ server'
        : 'Chưa cấu hình VITE_API_URL trên Vercel — API trả về HTML thay vì JSON',
    )
  }
  const data = await res.json().catch(() => {
    throw new Error('Không đọc được dữ liệu JSON từ server')
  })
  if (!res.ok) throw new Error(data.error || 'Lỗi kết nối server')
  return data
}

export const api = {
  getPlayers: () => request('/players'),
  createPlayer: (name) => request('/players', { method: 'POST', body: JSON.stringify({ name }) }),
  deletePlayer: (id) => request(`/players/${id}`, { method: 'DELETE' }),
  createSession: (playerIds) =>
    request('/sessions', { method: 'POST', body: JSON.stringify({ player_ids: playerIds }) }),
  getOngoingSessions: () => request('/sessions/ongoing'),
  getSession: (sessionId) => request(`/sessions/${sessionId}`),
  deleteOngoingSession: (sessionId) =>
    request(`/sessions/${sessionId}`, { method: 'DELETE' }),
  completeRound: (sessionId, gameId) =>
    request(`/sessions/${sessionId}/complete-round`, {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId }),
    }),
  endSession: (sessionId) => request(`/sessions/${sessionId}/end`, { method: 'POST' }),
  getActionTypes: () => request('/action-types'),
  createGame: (playerIds) =>
    request('/games', { method: 'POST', body: JSON.stringify({ player_ids: playerIds }) }),
  getGame: (id) => request(`/games/${id}`),
  addAction: (gameId, payload) =>
    request(`/games/${gameId}/actions`, { method: 'POST', body: JSON.stringify(payload) }),
  addActionsBatch: (gameId, actions) =>
    request(`/games/${gameId}/actions/batch`, {
      method: 'POST',
      body: JSON.stringify({ actions }),
    }),
  getScores: (gameId) => request(`/games/${gameId}/scores`),
  getHistory: () => request('/games/history'),
  finalizeGame: (gameId) => request(`/games/${gameId}/calculate`, { method: 'POST' }),
  swapRoster: (gameId, exitPlayerId, enterPlayerId) =>
    request(`/games/${gameId}/roster/swap`, {
      method: 'POST',
      body: JSON.stringify({ exit_player_id: exitPlayerId, enter_player_id: enterPlayerId }),
    }),
  newGame: (playerIds) =>
    request('/games', { method: 'POST', body: JSON.stringify({ player_ids: playerIds, title: 'Ván mới' }) }),
}
