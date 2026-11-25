/**
 * Management Dashboard By Vessel: roll the By Voyage rows up to one row per Master Vessel.
 * Durations are means over the vessel's calls; rates are simple averages of the voyage rows' rates.
 * Calls not linked to a Master Vessel group by the name typed on the plan.
 */
import { mean, voyageDisplayActiveRate, voyageFlowRate } from './managementDashboardFlow.js'
import { voyageMovedQtyLines } from './managementDashboardProduct.js'

export function vesselGroupKey(row) {
  if (row?.masterVesselId != null && row.masterVesselId !== '') return `mv:${row.masterVesselId}`
  const name = String(row?.vessel ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  return `name:${name || '—'}`
}

const ms = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** Downtime hours on one op, or null when the API sent no breakdown (net-rate switch off). */
const downtimeOf = (r) => {
  const h = Number(r.rateBreakdown?.downtime?.hours)
  return Number.isFinite(h) && h >= 0 ? h : null
}

const maxOrNull = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b))

/** One entry per call (same TB): ops on one call share its timings and stops. */
function callsOf(rows) {
  const calls = new Map()
  for (const r of rows) {
    const k = r.tb ?? `op:${r.id}`
    const c = calls.get(k)
    if (!c) {
      calls.set(k, { first: r, downtime: downtimeOf(r) })
      continue
    }
    c.downtime = maxOrNull(c.downtime, downtimeOf(r))
  }
  return [...calls.values()]
}

function totalDowntime(calls) {
  const hours = calls.map((c) => c.downtime).filter((h) => h != null)
  return hours.length ? hours.reduce((s, h) => s + h, 0) : null
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

/** Slowest, fastest and count of the voyage rates behind an average; null when there are none. */
function rangeOf(values) {
  const v = values.filter((x) => x != null)
  return v.length ? { min: Math.min(...v), max: Math.max(...v), n: v.length } : null
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
    rate: mean(sorted.map(voyageFlowRate)),
    activeRate: mean(sorted.map(voyageDisplayActiveRate)),
    rateRange: rangeOf(sorted.map(voyageFlowRate)),
    activeRateRange: rangeOf(sorted.map(voyageDisplayActiveRate)),
    downtimeH: totalDowntime(calls),
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

/**
 * Fleet figures for the strip above the table, over the same vessels the table lists.
 * Rates are the simple average of every voyage's rate, like the vessel rows.
 * `rateScaleMax` is the largest voyage rate, so every range line shares one scale.
 * @param {object[]} vessels output of groupVoyagesByVessel
 */
export function summarizeVessels(vessels) {
  const voyages = vessels.flatMap((v) => v.voyages)
  const movedNums = vessels.map((v) => v.movedTotal).filter((q) => q != null)
  const maxOf = (nums) => (nums.length ? Math.max(...nums) : 0)
  return {
    vessels: vessels.length,
    voyages: vessels.reduce((s, v) => s + v.callCount, 0),
    moved: movedNums.length ? movedNums.reduce((s, n) => s + n, 0) : null,
    rate: mean(voyages.map(voyageFlowRate)),
    activeRate: mean(voyages.map(voyageDisplayActiveRate)),
    movedScaleMax: maxOf(movedNums),
    rateScaleMax: maxOf([...vessels.map((v) => v.rateRange?.max), ...vessels.map((v) => v.activeRateRange?.max)].filter((x) => x != null)),
  }
}
