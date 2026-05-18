import {
  MAX_SI_BREAKDOWN_SHORT_CHARS,
  MAX_SI_BL_INDICATED_CHARS,
  MAX_SI_BL_SPLIT_CHARS,
  MAX_SI_BILL_OF_LADING_CLAUSE_CHARS,
  MAX_SI_CONSIGNEE_CHARS,
  MAX_SI_DESTINATION_CHARS,
  MAX_SI_NOTE_CHARS,
  MAX_SI_NOTIFY_PARTY_CHARS,
  MAX_SI_REFERENCE_CHARS,
  MAX_SI_VESSEL_NAME_CHARS,
  MAX_SI_VOYAGE_CHARS,
} from '../constants/inputLimits'
import { emptyBreakdownRow } from './siPlanLinkedDraft'

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isEmpty(v) {
  return v == null || String(v).trim() === ''
}

function clip(s, max) {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return max ? t.slice(0, max) : t
}

/**
 * @param {string} label
 * @param {Array<{ id: number|string, name?: string }>} list
 * @returns {{ id: string, confidence: number, extractedLabel: string }}
 */
export function bestLookupMatch(label, list) {
  const extractedLabel = String(label || '').trim()
  if (!extractedLabel || !Array.isArray(list)) {
    return { id: '', confidence: 0, extractedLabel }
  }
  const n = norm(extractedLabel)
  if (n.length < 2) return { id: '', confidence: 0, extractedLabel }

  let best = ''
  let bestScore = 0
  for (const item of list) {
    const raw = item?.name
    if (!raw) continue
    const nm = norm(raw)
    if (!nm) continue
    if (nm === n) return { id: String(item.id), confidence: 1, extractedLabel }
    if (n.length >= 3 && nm.includes(n)) {
      const score = n.length / nm.length
      if (score > bestScore) {
        bestScore = score
        best = String(item.id)
      }
    } else if (nm.length >= 4 && n.includes(nm)) {
      const score = nm.length / n.length
      if (score > bestScore) {
        bestScore = score
        best = String(item.id)
      }
    }
  }
  return { id: best, confidence: bestScore, extractedLabel }
}

/** @deprecated use bestLookupMatch */
export function bestLookupIdByName(label, list) {
  return bestLookupMatch(label, list).id
}

function valuesConflict(current, proposed) {
  if (isEmpty(proposed)) return false
  if (isEmpty(current)) return false
  return norm(current) !== norm(proposed)
}

function pushTextConflict(conflicts, key, label, scope, current, proposed, max) {
  const p = clip(proposed, max)
  if (!p) return
  if (isEmpty(current)) return
  if (!valuesConflict(current, p)) return
  conflicts.push({
    key,
    label,
    scope,
    current: String(current),
    proposed: p,
    kind: 'text',
  })
}

function pushDropdownConflict(conflicts, warnings, key, label, scope, currentId, extractedLabel, list) {
  if (!extractedLabel?.trim()) return
  const match = bestLookupMatch(extractedLabel, list)
  if (match.id) {
    if (!isEmpty(currentId) && String(currentId) !== match.id) {
      const curName = list.find((x) => String(x.id) === String(currentId))?.name || currentId
      conflicts.push({
        key,
        label,
        scope,
        current: curName,
        proposed: match.extractedLabel,
        proposedValue: match.id,
        kind: 'dropdown',
      })
    }
    return match.id
  }
  if (extractedLabel.trim()) {
    warnings.push({ key, label, extractedLabel: extractedLabel.trim(), scope })
  }
  return ''
}

/**
 * @typedef {{ key: string, label: string, scope: 'si'|'plan', current: string, proposed: string, proposedValue?: string, kind: 'text'|'dropdown' }} ExtractConflict
 */

/**
 * @param {object} form SI draft form
 * @param {object} fields API extract fields
 * @param {object} lookups
 * @param {{ planForm?: { vesselName?: string, voyageNo?: string, agentId?: string, eta?: string } }} [options]
 */
export function proposeSiExtractMerge(form, fields, lookups, options = {}) {
  const conflicts = /** @type {ExtractConflict[]} */ ([])
  const warnings = /** @type {Array<{ key: string, label: string, extractedLabel: string, scope: string }>} */ ([])
  const fills = /** @type {Record<string, unknown>} */ ({})
  const planFills = /** @type {Record<string, unknown>} */ ({})
  const plan = options.planForm || {}

  if (!fields || !lookups) {
    return { fills, planFills, conflicts, warnings, extractWarnings: {} }
  }

  const setFill = (key, value) => {
    if (value != null && String(value).trim() !== '') fills[key] = value
  }

  if (fields.referenceNumber?.trim()) {
    const p = clip(fields.referenceNumber, MAX_SI_REFERENCE_CHARS)
    if (isEmpty(form.referenceNumber)) setFill('referenceNumber', p)
    else pushTextConflict(conflicts, 'si.referenceNumber', 'Shipping Instructions No.', 'si', form.referenceNumber, p, MAX_SI_REFERENCE_CHARS)
  }

  if (fields.documentDate?.trim()) {
    const p = fields.documentDate
    if (isEmpty(form.documentDate)) setFill('documentDate', p)
    else pushTextConflict(conflicts, 'si.documentDate', 'Document date', 'si', form.documentDate, p, null)
  }

  const shipMatch = fields.shipper
    ? pushDropdownConflict(
        conflicts,
        warnings,
        'si.shipperId',
        'Shipper',
        'si',
        form.shipperId,
        fields.shipper,
        lookups.shippers || []
      )
    : ''
  if (shipMatch && isEmpty(form.shipperId)) setFill('shipperId', shipMatch)

  const lpMatch = fields.loadingPort
    ? pushDropdownConflict(
        conflicts,
        warnings,
        'si.loadingPortId',
        'Loading port',
        'si',
        form.loadingPortId,
        fields.loadingPort,
        lookups.loadingPorts || []
      )
    : ''
  if (lpMatch && isEmpty(form.loadingPortId)) setFill('loadingPortId', lpMatch)

  const svMatch = fields.surveyor
    ? pushDropdownConflict(
        conflicts,
        warnings,
        'si.surveyorId',
        'Surveyor',
        'si',
        form.surveyorId,
        fields.surveyor,
        lookups.surveyors || []
      )
    : ''
  if (svMatch && isEmpty(form.surveyorId)) setFill('surveyorId', svMatch)

  const textSiFields = [
    ['destinationText', 'Destination', fields.destinationText, MAX_SI_DESTINATION_CHARS],
    ['freightTerms', 'Freight terms', fields.freightTerms, null],
    ['consigneeText', 'Consignee', fields.consigneeText, MAX_SI_CONSIGNEE_CHARS],
    ['notifyPartyText', 'Notify party', fields.notifyPartyText, MAX_SI_NOTIFY_PARTY_CHARS],
    ['blSplitText', 'B/L split', fields.blSplitText, MAX_SI_BL_SPLIT_CHARS],
    ['billOfLadingClause', 'Bill of lading clause', fields.billOfLadingClause, MAX_SI_BILL_OF_LADING_CLAUSE_CHARS],
    ['blIndicated', 'BL indicated', fields.blIndicated, MAX_SI_BL_INDICATED_CHARS],
    ['note', 'Note', fields.note, MAX_SI_NOTE_CHARS],
  ]
  for (const [key, label, raw, max] of textSiFields) {
    const p = max ? clip(raw, max) : String(raw || '').trim()
    if (!p) continue
    if (isEmpty(form[key])) setFill(key, p)
    else pushTextConflict(conflicts, `si.${key}`, label, 'si', form[key], p, max)
  }

  // Plan-level fields: fill only when empty; never conflict or overwrite once set (e.g. after SI 1).
  if (fields.vesselName?.trim() && isEmpty(plan.vesselName)) {
    planFills.vesselName = clip(fields.vesselName, MAX_SI_VESSEL_NAME_CHARS)
  }

  if (fields.voyageNo?.trim() && isEmpty(plan.voyageNo)) {
    planFills.voyageNo = clip(fields.voyageNo, MAX_SI_VOYAGE_CHARS)
  }

  if (fields.agent?.trim() && isEmpty(plan.agentId)) {
    const agentMatch = pushDropdownConflict(
      conflicts,
      warnings,
      'plan.agentId',
      'Agent',
      'plan',
      plan.agentId,
      fields.agent,
      lookups.agents || []
    )
    if (agentMatch) planFills.agentId = agentMatch
  }

  if (fields.etaHint?.trim() && isEmpty(plan.eta)) {
    const etaStr = String(fields.etaHint)
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(etaStr) ? etaStr : null
    planFills.eta = ymd ? `${ymd}T12:00` : etaStr
  }

  const rows = Array.isArray(fields.breakdown) ? fields.breakdown : []
  if (rows.length > 0) {
    const cur = form.breakdown || []
    const rowUnused = (row) =>
      !String(row?.contractNo || '').trim() &&
      !String(row?.poNo || '').trim() &&
      !String(row?.qty || '').trim()
    const replaceBreakdown = cur.length >= 1 && cur.every(rowUnused)

    const buildRow = (r) => {
      const base = emptyBreakdownRow(lookups)
      let commodityId = base.commodityId
      if (r.commodityHint) {
        const cm = bestLookupMatch(r.commodityHint, lookups.commodities || [])
        if (cm.id) commodityId = cm.id
        else if (r.commodityHint.trim()) {
          warnings.push({
            key: 'si.breakdown.commodity',
            label: 'Commodity',
            extractedLabel: r.commodityHint.trim(),
            scope: 'si',
          })
        }
      }
      let metricId = base.metricId
      if (r.metricCode) {
        let code = String(r.metricCode).toUpperCase()
        if (code === 'TON' || code === 'TNE') code = 'MT'
        const m = (lookups.metrics || []).find((x) => String(x.code).toUpperCase() === code)
        if (m) metricId = String(m.id)
      }
      return {
        ...base,
        commodityId,
        metricId,
        qty: r.qty != null && r.qty !== '' ? String(r.qty) : '',
        contractNo: clip(r.contractNo, MAX_SI_BREAKDOWN_SHORT_CHARS),
        poNo: clip(r.poNo, MAX_SI_BREAKDOWN_SHORT_CHARS),
        soNo: clip(r.soNo, MAX_SI_BREAKDOWN_SHORT_CHARS),
        remarks: clip(r.remarks, MAX_SI_BREAKDOWN_SHORT_CHARS),
      }
    }

    const newRows = rows.map(buildRow)
    if (replaceBreakdown) fills.breakdown = newRows
    else if (newRows.length) fills.breakdownAppend = newRows
  }

  const extractWarnings = {}
  for (const w of warnings) {
    extractWarnings[w.key] = w.extractedLabel
  }

  return { fills, planFills, conflicts, warnings, extractWarnings }
}

/**
 * @param {object} form
 * @param {{ fills: object, planFills?: object, conflicts: ExtractConflict[], overwriteKeys?: string[] }} proposal
 */
export function applySiExtractMerge(form, proposal) {
  const overwrite = new Set(proposal.overwriteKeys || [])
  const next = { ...form, extractWarnings: { ...(form.extractWarnings || {}) } }

  const allow = (key) => {
    const c = proposal.conflicts.find((x) => x.key === key)
    if (!c) return true
    return overwrite.has(key)
  }

  for (const [k, v] of Object.entries(proposal.fills || {})) {
    if (k === 'breakdown' && allow('si.breakdown')) {
      next.breakdown = v
      continue
    }
    if (k === 'breakdownAppend' && allow('si.breakdown')) {
      next.breakdown = [...(form.breakdown || []), ...v]
      continue
    }
    const conflictKey = `si.${k}`
    if (allow(conflictKey) || !proposal.conflicts.some((c) => c.key === conflictKey)) {
      if (v != null) next[k] = v
    }
  }

  for (const c of proposal.conflicts) {
    if (!overwrite.has(c.key)) continue
    if (c.scope !== 'si') continue
    if (c.kind === 'dropdown' && c.proposedValue != null) {
      const field = c.key.replace(/^si\./, '')
      next[field] = String(c.proposedValue)
    } else if (c.kind === 'text') {
      const field = c.key.replace(/^si\./, '')
      next[field] = c.proposed
    }
  }

  if (proposal.extractWarnings) {
    next.extractWarnings = { ...next.extractWarnings, ...proposal.extractWarnings }
  }

  return next
}

/** @returns {{ nextForm: object, nextPlan: object|null }} */
export function applySiExtractMergeWithPlan(form, proposal, planForm) {
  const nextForm = applySiExtractMerge(form, proposal)
  const nextPlan = planForm ? { ...planForm } : null
  if (!nextPlan) return { nextForm, nextPlan: null }

  const overwrite = new Set(proposal.overwriteKeys || [])
  for (const c of proposal.conflicts) {
    if (!overwrite.has(c.key) || c.scope !== 'plan') continue
    if (c.key === 'plan.vesselName') nextPlan.vesselName = c.proposed
    if (c.key === 'plan.voyageNo') nextPlan.voyageNo = c.proposed
    if (c.key === 'plan.agentId' && c.proposedValue) nextPlan.agentId = String(c.proposedValue)
    if (c.key === 'plan.eta') nextPlan.eta = c.proposed
  }

  for (const [k, v] of Object.entries(proposal.planFills || {})) {
    const ck =
      k === 'vesselName'
        ? 'plan.vesselName'
        : k === 'voyageNo'
          ? 'plan.voyageNo'
          : k === 'agentId'
            ? 'plan.agentId'
            : k === 'eta'
              ? 'plan.eta'
              : `plan.${k}`
    if (!proposal.conflicts.some((c) => c.key === ck) || overwrite.has(ck)) {
      nextPlan[k] = v
    }
  }

  return { nextForm, nextPlan }
}

/** Conflicts that require user resolution on the active SI draft (excludes plan scope). */
export function getSiScopedConflicts(conflicts) {
  return (conflicts || []).filter((c) => c.scope === 'si')
}

/** Legacy helper: fill empty fields only (no conflicts). */
export function mergeSiExtractIntoForm(form, fields, lookups) {
  const proposal = proposeSiExtractMerge(form, fields, lookups)
  return applySiExtractMerge(form, { ...proposal, conflicts: [], overwriteKeys: [] })
}

/** @typedef {'success'|'sparse'|'warning'} SiExtractReportStatus */

/** Spec fields checked for "not detected in document" reporting. */
const EXTRACT_FIELD_SPECS = [
  { key: 'referenceNumber', label: 'Shipping Instructions No.' },
  { key: 'documentDate', label: 'Document date' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'loadingPort', label: 'Loading port' },
  { key: 'surveyor', label: 'Surveyor' },
  { key: 'destinationText', label: 'Destination' },
  { key: 'freightTerms', label: 'Freight terms' },
  { key: 'vesselName', label: 'Vessel name' },
  { key: 'etaHint', label: 'ETA' },
  { key: 'voyageNo', label: 'Voyage no.' },
  { key: 'agent', label: 'Agent' },
  { key: 'consigneeText', label: 'Consignee' },
  { key: 'notifyPartyText', label: 'Notify party' },
  { key: 'blSplitText', label: 'B/L split' },
  { key: 'billOfLadingClause', label: 'Bill of lading clause' },
  { key: 'blIndicated', label: 'BL indicated' },
  { key: 'note', label: 'Note' },
]

const SI_FILL_LABELS = {
  referenceNumber: 'Shipping Instructions No.',
  documentDate: 'Document date',
  shipperId: 'Shipper',
  loadingPortId: 'Loading port',
  surveyorId: 'Surveyor',
  destinationText: 'Destination',
  freightTerms: 'Freight terms',
  consigneeText: 'Consignee',
  notifyPartyText: 'Notify party',
  blSplitText: 'B/L split',
  billOfLadingClause: 'Bill of lading clause',
  blIndicated: 'BL indicated',
  note: 'Note',
}

const PLAN_FILL_LABELS = {
  vesselName: 'Vessel name',
  voyageNo: 'Voyage no.',
  agentId: 'Agent',
  eta: 'ETA',
}

function lookupDisplayName(id, list) {
  if (id == null || id === '') return ''
  const item = (list || []).find((x) => String(x.id) === String(id))
  return item?.name || item?.label || String(id)
}

function fieldHasSignal(fields, specKey) {
  if (!fields || typeof fields !== 'object') return false
  const v = fields[specKey]
  if (v != null && String(v).trim()) return true
  if (specKey !== 'breakdown') return false
  const rows = Array.isArray(fields.breakdown) ? fields.breakdown : []
  return rows.some(
    (r) =>
      r &&
      [r.contractNo, r.poNo, r.soNo, r.qty, r.commodityHint, r.metricCode, r.remarks].some(
        (x) => x != null && String(x).trim()
      )
  )
}

function formatSiFillValue(key, value, lookups) {
  if (key === 'shipperId') return lookupDisplayName(value, lookups?.shippers)
  if (key === 'loadingPortId') return lookupDisplayName(value, lookups?.loadingPorts)
  if (key === 'surveyorId') return lookupDisplayName(value, lookups?.surveyors)
  if (key === 'breakdown' || key === 'breakdownAppend') {
    const rows = Array.isArray(value) ? value : []
    if (!rows.length) return ''
    return rows
      .map((r, i) => {
        const parts = []
        const comm = lookupDisplayName(r.commodityId, lookups?.commodities)
        if (comm) parts.push(comm)
        if (r.qty) parts.push(String(r.qty))
        const metric = (lookups?.metrics || []).find((m) => String(m.id) === String(r.metricId))
        if (metric?.code) parts.push(metric.code)
        return parts.length ? `Row ${i + 1}: ${parts.join(', ')}` : `Row ${i + 1}`
      })
      .join('; ')
  }
  return String(value ?? '').trim()
}

function conflictAllowed(conflicts, key, overwriteKeys) {
  const overwrite = new Set(overwriteKeys || [])
  const c = conflicts.find((x) => x.key === key)
  if (!c) return true
  return overwrite.has(key)
}

/**
 * Build a UI report after OCR merge proposal.
 * @param {{
 *   proposal: { fills?: object, planFills?: object, conflicts?: ExtractConflict[], warnings?: Array },
 *   fields: object,
 *   fileName?: string,
 *   lookups?: object,
 *   overwriteKeys?: string[],
 * }} opts
 */
export function buildSiExtractReport({ proposal, fields, fileName = '', lookups = null, overwriteKeys = [] }) {
  const conflicts = proposal?.conflicts || []
  const warnings = (proposal?.warnings || []).map((w) => ({
    key: w.key,
    label: w.label,
    extractedLabel: w.extractedLabel,
    scope: w.scope || 'si',
  }))
  const applied = /** @type {Array<{ key: string, label: string, scope: string, value: string }>} */ ([])

  for (const [k, v] of Object.entries(proposal?.fills || {})) {
    const conflictKey =
      k === 'breakdown' || k === 'breakdownAppend' ? 'si.breakdown' : `si.${k}`
    if (!conflictAllowed(conflicts, conflictKey, overwriteKeys)) continue
    const label = SI_FILL_LABELS[k] || k
    const value = formatSiFillValue(k, v, lookups)
    if (value) applied.push({ key: conflictKey, label, scope: 'si', value })
  }

  for (const [k, v] of Object.entries(proposal?.planFills || {})) {
    const conflictKey =
      k === 'vesselName'
        ? 'plan.vesselName'
        : k === 'voyageNo'
          ? 'plan.voyageNo'
          : k === 'agentId'
            ? 'plan.agentId'
            : k === 'eta'
              ? 'plan.eta'
              : `plan.${k}`
    if (!conflictAllowed(conflicts, conflictKey, overwriteKeys)) continue
    const label = PLAN_FILL_LABELS[k] || k
    let value = String(v ?? '').trim()
    if (k === 'agentId') value = lookupDisplayName(v, lookups?.agents)
    applied.push({ key: conflictKey, label, scope: 'plan', value })
  }

  const overwrite = new Set(overwriteKeys || [])
  for (const c of conflicts) {
    if (!overwrite.has(c.key)) continue
    applied.push({
      key: c.key,
      label: c.label,
      scope: c.scope,
      value: c.kind === 'dropdown' && c.proposedValue != null
        ? c.proposed
        : String(c.proposed ?? ''),
    })
  }

  const notDetected = []
  for (const spec of EXTRACT_FIELD_SPECS) {
    if (!fieldHasSignal(fields, spec.key)) notDetected.push({ key: spec.key, label: spec.label })
  }
  const rows = Array.isArray(fields?.breakdown) ? fields.breakdown : []
  const breakdownSignal = rows.some(
    (r) =>
      r &&
      [r.contractNo, r.poNo, r.soNo, r.qty, r.commodityHint, r.metricCode].some(
        (x) => x != null && String(x).trim()
      )
  )
  if (!breakdownSignal) {
    notDetected.push({ key: 'breakdown', label: 'Commodity / QTY / breakdown' })
  }

  const detectedCount = countSiExtractSignals(fields)
  const siConflicts = getSiScopedConflicts(conflicts)
  const pendingConflicts = siConflicts
    .filter((c) => !overwrite.has(c.key))
    .map((c) => ({
      key: c.key,
      label: c.label,
      current: c.current,
      proposed: c.proposed,
    }))

  let status = /** @type {SiExtractReportStatus} */ ('success')
  if (detectedCount === 0) status = 'sparse'
  else if (warnings.length > 0 || pendingConflicts.length > 0) status = 'warning'

  return {
    status,
    fileName: fileName || '',
    at: new Date().toISOString(),
    detectedCount,
    applied,
    unmatchedDropdowns: warnings,
    notDetected,
    pendingConflicts,
  }
}

export function countSiExtractSignals(fields) {
  if (!fields || typeof fields !== 'object') return 0
  let n = 0
  const scalarKeys = [
    'referenceNumber',
    'documentDate',
    'shipper',
    'loadingPort',
    'surveyor',
    'destinationText',
    'freightTerms',
    'voyageNo',
    'vesselName',
    'agent',
    'etaHint',
    'consigneeText',
    'notifyPartyText',
    'blSplitText',
    'billOfLadingClause',
    'blIndicated',
    'note',
  ]
  for (const k of scalarKeys) {
    const v = fields[k]
    if (v != null && String(v).trim()) n += 1
  }
  const rows = Array.isArray(fields.breakdown) ? fields.breakdown : []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    if (
      [r.contractNo, r.poNo, r.soNo, r.qty, r.commodityHint, r.metricCode, r.remarks].some(
        (x) => x != null && String(x).trim()
      )
    )
      n += 1
  }
  return n
}
