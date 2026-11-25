/**
 * Management Dashboard By Vessel: roll the By Voyage rows up to one row per Master Vessel.
 * Durations are means over the vessel's calls; rates are weighted (total MT ÷ total hours).
 * Calls not linked to a Master Vessel group by name and are flagged `linked: false`.
 */
import { mean } from './managementDashboardFlow.js'
import { voyageMovedQtyLines } from './managementDashboardProduct.js'

export function vesselGroupKey(row) {
  if (row?.masterVesselId != null && row.masterVesselId !== '') return `mv:${row.masterVesselId}`
  const name = String(row?.vessel ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  return `name:${name || '—'}`
}

const positive = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const ms = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** One entry per call (same TB): ops on one call share its timings and cargo window. */
function callsOf(rows) {
  const calls = new Map()
  for (const r of rows) {
    const k = r.tb ?? `op:${r.id}`
    const c = calls.get(k)
    if (!c) {
      calls.set(k, {
        first: r,
        moved: positive(r.voyageMovedQty) ?? 0,
        logged: positive(r.voyageLoggedHours),
        active: positive(r.voyageActiveHours),
      })
      continue
    }
    c.moved += positive(r.voyageMovedQty) ?? 0
    c.logged = Math.max(c.logged ?? 0, positive(r.voyageLoggedHours) ?? 0) || null
    c.active = Math.max(c.active ?? 0, positive(r.voyageActiveHours) ?? 0) || null
  }
  return [...calls.values()]
}

function weightedRate(calls, hoursKey) {
  let moved = 0
  let hours = 0
  for (const c of calls) {
    if (!(c.moved > 0) || !(c[hoursKey] > 0)) continue
    moved += c.moved
    hours += c[hoursKey]
  }
  return hours > 0 ? moved / hours : null
}

function movedLinesOf(rows) {
  const byLabel = new Map()
  for (const r of rows) {
    for (const l of voyageMovedQtyLines(r)) {
      const prev = byLabel.get(l.label)
      const qty = l.qty == null ? prev?.qty ?? null : (prev?.qty ?? 0) + l.qty
      byLabel.set(l.label, { label: l.label, qty })
    }
  }
  return [...byLabel.values()]
}

function vesselRow(key, voyages) {
  const sorted = [...voyages].sort((a, b) => (ms(b.tb) ?? 0) - (ms(a.tb) ?? 0))
  const calls = callsOf(sorted)
  const movedLines = movedLinesOf(sorted)
  const movedNums = movedLines.map((l) => l.qty).filter((q) => q != null)
  const castOffs = sorted.map((r) => r.castOff).filter(ms).sort((a, b) => ms(b) - ms(a))
  const linked = key.startsWith('mv:')
  return {
    id: key,
    key,
    linked,
    vessel: (linked && sorted.find((r) => r.masterVesselName)?.masterVesselName) || sorted[0]?.vessel || '—',
    voyages: sorted,
    callCount: calls.length,
    loadCalls: calls.filter((c) => c.first.purpose === 'Loading').length,
    unloadCalls: calls.filter((c) => c.first.purpose !== 'Loading').length,
    jetties: [...new Set(sorted.map((r) => r.jetty).filter(Boolean))],
    movedLines,
    movedTotal: movedNums.length ? movedNums.reduce((s, n) => s + n, 0) : null,
    wait: mean(calls.map((c) => c.first.wait)),
    pre: mean(calls.map((c) => c.first.pre)),
    rate: weightedRate(calls, 'logged'),
    activeRate: weightedRate(calls, 'active'),
    cargoDoneToSailH: mean(calls.map((c) => c.first.cargoDoneToSailH)),
    lastCastOff: castOffs[0] ?? null,
    alongside: sorted.find((r) => !r.sailedInPeriod) ?? null,
  }
}

/**
 * @param {object[]} rows By Voyage rows (one per operation), loading and unloading together
 * @returns {object[]} one row per vessel, most moved MT first
 */
export function groupVoyagesByVessel(rows) {
  const groups = new Map()
  for (const r of rows || []) {
    const k = vesselGroupKey(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return [...groups.entries()]
    .map(([key, voyages]) => vesselRow(key, voyages))
    .sort((a, b) => (b.movedTotal ?? -1) - (a.movedTotal ?? -1))
}
