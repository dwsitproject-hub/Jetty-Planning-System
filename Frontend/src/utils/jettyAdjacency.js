/**
 * Multi-jetty berthing: adjacency helpers built on top of the already-loaded `jetties` list
 * (from `fetchJetties()`, which includes `adjacentJettyIds` — explicit pairs configured in
 * Master – Jetty). No extra API calls needed.
 */
import { jettyShortName } from './jettyAdvice'

export { jettyShortName }

/** The jetty object (from `jetties`) whose id matches `jettyId`, or null. */
export function findJettyById(jetties, jettyId) {
  if (!Array.isArray(jetties) || jettyId == null) return null
  return jetties.find((j) => String(j.id) === String(jettyId)) ?? null
}

/**
 * Short berth ids (e.g. ["2A", "3A"]) explicitly configured as adjacent to `jettyId`,
 * resolved from `jetty.adjacentJettyIds` (numeric jetties.id values).
 */
export function getAdjacentBerthIds(jetties, jettyId) {
  const jetty = findJettyById(jetties, jettyId)
  const ids = Array.isArray(jetty?.adjacentJettyIds) ? jetty.adjacentJettyIds : []
  return ids
    .map((id) => findJettyById(jetties, id))
    .filter(Boolean)
    .map((j) => jettyShortName(j.name))
    .filter(Boolean)
}

/** Display names (short ids) for a list of numeric jetty ids, e.g. for Master – Jetty table/hints. */
export function jettyNamesForIds(jetties, ids) {
  if (!Array.isArray(ids) || !ids.length) return []
  return ids
    .map((id) => findJettyById(jetties, id))
    .filter(Boolean)
    .map((j) => jettyShortName(j.name))
    .filter(Boolean)
}

/**
 * Multi-jetty berthing: groups `berthIds` into ordered "chains" — jetties explicitly configured
 * as adjacent (Master – Jetty) end up in the same chain, in walk order (endpoint-first, so a
 * simple line A-B-C comes out as [A, B, C] not reshuffled); everything else becomes its own
 * length-1 chain. Chains are sorted by the lowest original index among their members, so jetties
 * with no adjacency configured keep their original relative position — only adjacency-linked
 * groups get pulled together. This is the shared basis for both jetty-level ordering
 * (`orderBerthIdsByAdjacency`) and lane-interleaved row building (`buildAdjacencyAwareRowDefs`).
 */
export function getAdjacencyChains(berthIds, jetties) {
  const ids = Array.isArray(berthIds) ? berthIds.filter(Boolean) : []
  if (!ids.length) return []
  if (ids.length < 2 || !Array.isArray(jetties) || !jetties.length) return ids.map((id) => [id])

  const indexOf = new Map(ids.map((id, i) => [id, i]))
  const byShortId = new Map()
  for (const j of jetties) {
    const shortId = jettyShortName(j?.name)
    if (shortId && indexOf.has(shortId) && !byShortId.has(shortId)) byShortId.set(shortId, j)
  }

  // Adjacency edges, restricted to ids actually present in this row list.
  const neighbors = new Map(ids.map((id) => [id, []]))
  for (const id of ids) {
    const jetty = byShortId.get(id)
    if (!jetty) continue
    for (const adjId of getAdjacentBerthIds(jetties, jetty.id)) {
      if (adjId !== id && indexOf.has(adjId)) neighbors.get(id).push(adjId)
    }
  }

  const visited = new Set()
  const chains = []
  for (const id of ids) {
    if (visited.has(id)) continue
    // Collect the full group of ids reachable from `id` via adjacency edges.
    const group = new Set([id])
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()
      for (const n of neighbors.get(cur) || []) {
        if (!group.has(n)) {
          group.add(n)
          stack.push(n)
        }
      }
    }
    for (const m of group) visited.add(m)

    if (group.size === 1) {
      chains.push({ anchor: indexOf.get(id), ids: [id] })
      continue
    }

    // Walk the group into one contiguous chain, starting from an endpoint (at most one
    // neighbour within the group) so a simple line (A-B-C) comes out in order, not reshuffled.
    const groupIds = [...group]
    const degree = (m) => (neighbors.get(m) || []).filter((n) => group.has(n)).length
    const startId = groupIds.find((m) => degree(m) <= 1) ?? groupIds[0]
    const chain = []
    const seen = new Set()
    let cur = startId
    let prev = null
    while (cur != null && !seen.has(cur)) {
      chain.push(cur)
      seen.add(cur)
      const next = (neighbors.get(cur) || []).find((n) => group.has(n) && n !== prev && !seen.has(n))
      prev = cur
      cur = next
    }
    // Branching groups: append anything the straight-line walk missed, in original order.
    for (const m of groupIds) if (!seen.has(m)) chain.push(m)

    chains.push({ anchor: Math.min(...chain.map((m) => indexOf.get(m))), ids: chain })
  }

  chains.sort((a, b) => a.anchor - b.anchor)
  return chains.map((c) => c.ids)
}

/**
 * Multi-jetty berthing: reorder `berthIds` (Gantt row order) so jetties explicitly configured
 * as adjacent (Master – Jetty) sit next to each other — needed so a spanning vessel's bar can
 * visually stretch across contiguous rows. Jetties with no adjacency configured keep their
 * original relative position; only adjacency-linked groups are pulled together, inserted at
 * the position of their first (lowest-index) member.
 */
export function orderBerthIdsByAdjacency(berthIds, jetties) {
  return getAdjacencyChains(berthIds, jetties).flat()
}

/**
 * Multi-jetty berthing: Gantt row list (one row per jetty lane), with adjacency-linked jetties'
 * lanes INTERLEAVED rather than grouped per jetty — e.g. `2B-01, 3B-01, 2B-02, 3B-02` instead of
 * `2B-01, 2B-02, 3B-01, 3B-02`. This guarantees a spanning vessel's primary lane row and its
 * additional jetty's matching lane row are always physically adjacent, so the Gantt's spanning
 * overlay never has to cross another (possibly unrelated, occupied) lane row to connect them.
 * Jetties with no configured adjacency (chain length 1) keep today's behaviour: their own lanes
 * `0..cap-1` in order, un-interleaved.
 */
export function buildAdjacencyAwareRowDefs(berthIds, berthsState, jetties) {
  const chains = getAdjacencyChains(berthIds, jetties)
  const berths = Array.isArray(berthsState) ? berthsState : []
  const byId = new Map(berths.map((b) => [b.id, b]))
  const capOf = (jettyId) => {
    const raw = byId.get(jettyId)?.capacity
    const cap = raw != null ? Number(raw) : 1
    return Number.isFinite(cap) && cap >= 1 ? cap : 1
  }
  const rowFor = (jettyId, lane, cap) => ({
    jettyId,
    laneIndex: lane,
    rowKey: `${jettyId}__${lane}`,
    label: `${jettyId}-${String(lane + 1).padStart(2, '0')}`,
    capacity: cap,
  })

  const out = []
  for (const chain of chains) {
    if (chain.length <= 1) {
      const jettyId = chain[0]
      const cap = capOf(jettyId)
      for (let lane = 0; lane < cap; lane += 1) out.push(rowFor(jettyId, lane, cap))
      continue
    }
    const caps = chain.map(capOf)
    const maxCap = Math.max(...caps)
    for (let lane = 0; lane < maxCap; lane += 1) {
      chain.forEach((jettyId, i) => {
        if (lane < caps[i]) out.push(rowFor(jettyId, lane, caps[i]))
      })
    }
  }
  return out
}
