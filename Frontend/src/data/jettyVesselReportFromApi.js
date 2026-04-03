/**
 * Jetty – Vessel report: detail rows, utilization summary, grouped-by-jetty from live APIs.
 */

export function jettyShortName(name) {
  if (!name) return ''
  return String(name).replace(/^Jetty\s+/i, '').trim()
}

function startOfDayMs(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDayMs(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(23, 59, 59, 999)
  return d.getTime()
}

function isInDateRange(dateStr, startDate, endDate) {
  if (!dateStr || !startDate || !endDate) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  const start = startOfDayMs(startDate)
  const end = endOfDayMs(endDate)
  return t >= start && t <= end
}

function parseMs(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

function intervalsOverlap(a0, a1, b0, b1) {
  return a0 <= b1 && b0 <= a1
}

/** Map jetty display string (short name from allocation) to j.id */
export function resolveJettyIdFromDisplay(jettyDisplay, jetties) {
  if (!jettyDisplay || !Array.isArray(jetties)) return null
  const want = String(jettyDisplay).trim().toLowerCase()
  if (!want) return null
  for (const j of jetties) {
    const short = jettyShortName(j.name).toLowerCase()
    const full = String(j.name).toLowerCase()
    if (short === want || full === want) return Number(j.id)
  }
  return null
}

function summarizeQuantityFromSiBreakdown(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return '—'
  return breakdown
    .map((l) => {
      const q = l.qty != null ? Number(l.qty) : null
      const unit = l.metricLabel || l.metricCode || ''
      if (q == null || Number.isNaN(q)) return unit || '—'
      return unit ? `${q} ${unit}` : String(q)
    })
    .join('; ')
}

/**
 * Whether a detail row overlaps the report window (point timestamps or berth interval).
 */
export function detailRowOverlapsRange(row, startDate, endDate) {
  if (!startDate || !endDate) return true
  const rs = startOfDayMs(startDate)
  const re = endOfDayMs(endDate)
  if (rs == null || re == null) return true

  const pointDates = [row.eta, row.arrivalDateTime, row.etb, row.berthedDateTime, row.sailedOffDateTime]
  if (pointDates.some((d) => isInDateRange(d, startDate, endDate))) return true

  const alongside = parseMs(row.berthedDateTime)
  if (alongside == null) return pointDates.some(Boolean)

  const sailed = parseMs(row.sailedOffDateTime)
  const endBerth = sailed != null ? sailed : re
  return intervalsOverlap(alongside, endBerth, rs, re)
}

function clippedBerthHours(row, rangeStartMs, rangeEndMs) {
  const alongside = parseMs(row.berthedDateTime)
  if (alongside == null) return 0
  const sailed = parseMs(row.sailedOffDateTime)
  const endBerth = sailed != null ? sailed : rangeEndMs
  const a = Math.max(alongside, rangeStartMs)
  const b = Math.min(endBerth, rangeEndMs)
  if (b <= a) return 0
  return (b - a) / 3600000
}

export function buildDetailRowFromOperation(op, si, overviewRow) {
  const eta = op.eta ?? overviewRow?.etaDateTime ?? null
  const arrivalDateTime = op.ta ?? overviewRow?.taDateTime ?? null
  const etb = op.etb ?? overviewRow?.etbDateTime ?? overviewRow?.plannedEtbDateTime ?? null
  const berthedDateTime = op.tbAt ?? op.dockingStartTime ?? overviewRow?.tbDateTime ?? null
  const sailedOffDateTime = op.sailedAt ?? op.castOffAt ?? overviewRow?.castOffDateTime ?? null

  const commodity = op.commodity || si?.commodity || '—'
  const quantity = summarizeQuantityFromSiBreakdown(si?.breakdown)
  const loadPort = si?.loadingPortName || '—'
  const dischPort = si?.destinationText || '—'
  const shipper = si?.shipperName || overviewRow?.shipper || '—'
  const consignee = si?.consigneeText || '—'
  const surveyor = si?.surveyorName || overviewRow?.surveyor || '—'
  const agent = si?.agentName || overviewRow?.agent || '—'

  return {
    rowId: `op-${op.id}`,
    jettyId: op.jettyId != null ? Number(op.jettyId) : null,
    jetty: op.jettyName || overviewRow?.jetty || '—',
    purpose: op.purpose || '—',
    shippingInstruction: op.referenceNumber || (op.shippingInstructionId ? `SI-${op.shippingInstructionId}` : '—'),
    vessel: op.vesselName || '—',
    eta,
    arrivalDateTime,
    etb,
    berthedDateTime,
    sailedOffDateTime,
    commodity,
    quantity: quantity || '—',
    stowage: '—',
    loadPort,
    dischPort,
    shipper,
    consignee,
    surveyor,
    agent,
  }
}

export function buildDetailRowFromQueueRow(q, jetties) {
  const jettyId = q.jetty ? resolveJettyIdFromDisplay(q.jetty, jetties) : null
  const jObj =
    jettyId != null && Array.isArray(jetties) ? jetties.find((j) => Number(j.id) === jettyId) : null
  const jettyLabel = jObj?.name || q.jetty || '—'
  return {
    rowId: `si-${q.shippingInstructionId ?? q.id}`,
    jettyId,
    jetty: jettyLabel,
    purpose: q.purpose || '—',
    shippingInstruction: q.shippingInstruction || '—',
    vessel: q.vesselName || '—',
    eta: q.etaDateTime || null,
    arrivalDateTime: q.taDateTime || null,
    etb: q.etbDateTime || null,
    berthedDateTime: q.tbDateTime || null,
    sailedOffDateTime: q.castOffDateTime || null,
    commodity: q.commodity || '—',
    quantity: '—',
    stowage: '—',
    loadPort: '—',
    dischPort: '—',
    shipper: q.shipper || '—',
    consignee: '—',
    surveyor: q.surveyor || '—',
    agent: q.agent || '—',
  }
}

/**
 * @param {Array} detailRows - from buildDetailRow*
 * @param {Array} jetties - master jetties for port (for utilization denominator)
 * @param {string} startDate
 * @param {string} endDate
 * @param {Set<string>|null} selectedJettyIdStr - optional filter set of String(jettyId)
 */
export function computeJettyUtilizationSummary(detailRows, jetties, startDate, endDate, selectedJettyIdStr) {
  const rs = startOfDayMs(startDate)
  const re = endOfDayMs(endDate)
  const hoursInWindow = rs != null && re != null ? Math.max(0, (re - rs) / 3600000) : 0

  const scopedJetties = (Array.isArray(jetties) ? jetties : []).filter((j) => {
    if (!selectedJettyIdStr || selectedJettyIdStr.size === 0) return true
    return selectedJettyIdStr.has(String(j.id))
  })

  const byJettyId = new Map()
  for (const j of scopedJetties) {
    const cap = j?.capacity != null ? Number(j.capacity) : 1
    byJettyId.set(String(j.id), {
      jettyId: j.id,
      jettyName: j.name,
      capacity: Number.isFinite(cap) && cap >= 1 ? cap : 1,
      calls: 0,
      berthHours: 0,
    })
  }

  for (const row of detailRows) {
    let jid = row.jettyId != null ? String(row.jettyId) : null
    if (!jid && row.jetty && jetties) {
      const resolved = resolveJettyIdFromDisplay(row.jetty, jetties)
      if (resolved != null) jid = String(resolved)
    }
    if (!jid || !byJettyId.has(jid)) continue
    const rec = byJettyId.get(jid)
    rec.calls += 1
    if (rs != null && re != null) {
      rec.berthHours += clippedBerthHours(row, rs, re)
    }
  }

  const list = Array.from(byJettyId.values()).map((r) => {
    const denom = hoursInWindow > 0 ? hoursInWindow * (Number(r.capacity) || 1) : 0
    const utilizationPct =
      denom > 0 ? Math.min(100, Math.round((r.berthHours / denom) * 1000) / 10) : 0
    return {
      ...r,
      berthHoursRounded: Math.round(r.berthHours * 10) / 10,
      utilizationPct,
      hoursInWindow: Math.round(hoursInWindow * 10) / 10,
    }
  })

  list.sort((a, b) => String(a.jettyName).localeCompare(String(b.jettyName)))
  return { byJetty: list, hoursInWindow: Math.round(hoursInWindow * 10) / 10 }
}

/** @returns {Array<[string, Array]>} sorted jetty label then rows (sorted by berthed / ETA) */
export function groupDetailRowsByJetty(rows) {
  const m = new Map()
  for (const r of rows) {
    const key = r.jetty || '—'
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(r)
  }
  const sortRows = (a, b) => {
    const ta = parseMs(a.berthedDateTime) ?? parseMs(a.eta) ?? 0
    const tb = parseMs(b.berthedDateTime) ?? parseMs(b.eta) ?? 0
    return ta - tb
  }
  for (const list of m.values()) {
    list.sort(sortRows)
  }
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
}
