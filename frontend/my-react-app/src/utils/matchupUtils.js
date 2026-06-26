/**
 * Gộp đối đầu có hướng thành kết quả ròng từng cặp (bết lưỡi).
 * net(A,B) = điểm A thắng B − điểm B thắng A
 */
export function consolidateMatchups(directed) {
  if (!Array.isArray(directed) || directed.length === 0) return []

  const alreadyNet = directed.every(
    (m) =>
      m.player_a_id != null &&
      m.player_b_id != null &&
      (m.gross_a_beats_b != null || m.gross_b_beats_a != null),
  )
  if (alreadyNet) {
    return [...directed].sort((x, y) => {
      if (x.is_tie !== y.is_tie) return x.is_tie ? 1 : -1
      return (y.points || 0) - (x.points || 0)
    })
  }

  const edges = new Map()
  const names = new Map()

  for (const m of directed) {
    const pts = Number(m.points) || 0
    if (pts <= 0) continue
    const w = m.winner_id
    const l = m.loser_id
    if (w == null || l == null || w === l) continue

    const key = `${w}-${l}`
    edges.set(key, (edges.get(key) || 0) + pts)
    if (m.winner_name) names.set(w, m.winner_name)
    if (m.loser_name) names.set(l, m.loser_name)
  }

  const pairKeys = new Set()
  for (const key of edges.keys()) {
    const [w, l] = key.split('-').map(Number)
    const a = Math.min(w, l)
    const b = Math.max(w, l)
    pairKeys.add(`${a}-${b}`)
  }

  const results = []
  for (const pairKey of pairKeys) {
    const [a, b] = pairKey.split('-').map(Number)
    const grossAb = edges.get(`${a}-${b}`) || 0
    const grossBa = edges.get(`${b}-${a}`) || 0
    const net = grossAb - grossBa
    const nameA = names.get(a) || `#${a}`
    const nameB = names.get(b) || `#${b}`

    const item = {
      player_a_id: a,
      player_b_id: b,
      player_a_name: nameA,
      player_b_name: nameB,
      gross_a_beats_b: grossAb,
      gross_b_beats_a: grossBa,
      points: Math.abs(net),
      is_tie: net === 0,
    }

    if (net > 0) {
      item.winner_id = a
      item.loser_id = b
      item.winner_name = nameA
      item.loser_name = nameB
    } else if (net < 0) {
      item.winner_id = b
      item.loser_id = a
      item.winner_name = nameB
      item.loser_name = nameA
    } else {
      item.winner_id = null
      item.loser_id = null
      item.winner_name = nameA
      item.loser_name = nameB
    }

    if (item.is_tie) {
      item.label = `${nameA} – ${nameB}: hòa (mỗi chiều +${grossAb})`
    } else {
      item.label = `${item.loser_name} thua ròng ${item.winner_name} −${item.points}`
    }

    results.push(item)
  }

  results.sort((x, y) => {
    if (x.is_tie !== y.is_tie) return x.is_tie ? 1 : -1
    return y.points - x.points
  })
  return results
}

export function formatMatchupBreakdown(m) {
  const parts = []
  if (m.gross_a_beats_b > 0) {
    parts.push(`${m.player_a_name} ăn ${m.player_b_name} +${m.gross_a_beats_b}`)
  }
  if (m.gross_b_beats_a > 0) {
    parts.push(`${m.player_b_name} ăn ${m.player_a_name} +${m.gross_b_beats_a}`)
  }
  if (!parts.length) return ''
  if (m.is_tie) return `Chi tiết: ${parts.join(' · ')} → hòa`
  return `Chi tiết: ${parts.join(' · ')} → ròng ${m.winner_name} +${m.points}`
}
