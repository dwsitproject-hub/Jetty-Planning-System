/**
 * Decide what an extracted sampling quality report would change in the SAMPLING form,
 * and apply only what the operator confirms.
 *
 * `proposeSamplingExtractMerge` never mutates anything — it classifies each extracted row
 * against the current records so the review modal can show New / Conflict / Unchanged.
 * `applySamplingExtractMerge` then writes just the selected rows and options.
 */
import { MAX_SAMPLING_METRIC_CHARS, MAX_SAMPLING_PALKA_FIELD_CHARS } from '../constants/inputLimits.js'

/** Averages agreeing to within this much are treated as consistent. */
const AVERAGE_TOLERANCE = 0.05

/** Vessel prefixes that vary between documents and should not drive a mismatch warning. */
const VESSEL_PREFIX_RE = /^(MT|MV|KM|TB|BG|SPOB|LCT|AHT|TK)\s*/

export function samplingPalkaKey(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

function toNum(raw) {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function sameMetric(a, b) {
  const na = toNum(a)
  const nb = toNum(b)
  if (na == null || nb == null) return String(a ?? '').trim() === String(b ?? '').trim()
  return Math.abs(na - nb) < 1e-9
}

function normalizeVessel(raw) {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
  return s.replace(VESSEL_PREFIX_RE, '').trim()
}

/** Different spellings are common ("MT Victoria II" vs "VICTORIA-II"); only warn when clearly unrelated. */
function vesselNamesLookDifferent(documentVessel, operationVessel) {
  const a = normalizeVessel(documentVessel).replace(/\s/g, '')
  const b = normalizeVessel(operationVessel).replace(/\s/g, '')
  if (!a || !b) return false
  return !(a.includes(b) || b.includes(a))
}

function averageOf(rows, key) {
  const nums = rows.map((r) => toNum(r[key])).filter((n) => n != null)
  if (!nums.length) return null
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

/** datetime-local inputs expect YYYY-MM-DDTHH:mm. */
function ymdToDateTimeLocal(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd ?? '')) ? `${ymd}T00:00` : null
}

/**
 * The report's own summary box, paired with the form field each value fills.
 * `source` is the extraction key, which does not match the form key.
 */
const QUALITY_FIELDS = [
  { key: 'ffaAverage', label: '(%), FFA Average', source: 'statedAvgFfa' },
  { key: 'moistureAverage', label: '(%), Moisture Average', source: 'statedAvgMoisture' },
  { key: 'dobi', label: 'DOBI', source: 'dobi' },
  { key: 'iodineValue', label: '(gI2/100g), Iodine Value', source: 'iodineValue' },
]

/** Extraction hands back the averages as numbers and DOBI/IV as strings; the form holds strings. */
function metricToText(raw) {
  return raw == null ? '' : String(raw).trim()
}

/**
 * Classify each summary-box value against what the form already holds.
 *
 * Values are only proposed, never silently applied, because a conflict here usually means
 * the wrong report was uploaded rather than a correction.
 */
function buildQualityProposals(sampling, fields) {
  const out = []
  for (const field of QUALITY_FIELDS) {
    const extracted = metricToText(fields?.[field.source])
    if (!extracted || extracted.length > MAX_SAMPLING_METRIC_CHARS) continue
    const current = metricToText(sampling?.[field.key])
    out.push({
      key: field.key,
      label: field.label,
      extracted,
      current,
      status: !current ? 'new' : sameMetric(current, extracted) ? 'unchanged' : 'conflict',
    })
  }
  return out
}

/**
 * Classify extracted rows against the current sampling records.
 *
 * @param {{ startTime?: string, remark?: string, ffaAverage?: string, moistureAverage?: string,
 *           dobi?: string, iodineValue?: string,
 *           records?: Array<{id:string,noPalka:string,ffa:string,moisture:string}> }} sampling
 * @param {{ records?: Array<{noPalka:string,ffa:string,moisture:string}>, documentDate?: string|null,
 *           vesselName?: string|null, dobi?: string|null, iodineValue?: string|null,
 *           statedAvgFfa?: number|null, statedAvgMoisture?: number|null }} fields
 * @param {{ vesselName?: string|null, numberOfPalka?: number|string|null,
 *           source?: 'xlsx'|'pdf_text'|'ocr_image' }} [context]
 */
export function proposeSamplingExtractMerge(sampling, fields, context = {}) {
  const current = Array.isArray(sampling?.records) ? sampling.records : []
  const extracted = Array.isArray(fields?.records) ? fields.records : []

  const currentByKey = new Map()
  for (const rec of current) {
    const key = samplingPalkaKey(rec?.noPalka)
    if (key && !currentByKey.has(key)) currentByKey.set(key, rec)
  }

  const newRecords = []
  const conflicts = []
  const unchanged = []
  const seen = new Set()

  for (const row of extracted) {
    const key = samplingPalkaKey(row?.noPalka)
    if (!key || key.length > MAX_SAMPLING_PALKA_FIELD_CHARS || seen.has(key)) continue
    seen.add(key)
    const existing = currentByKey.get(key)
    const candidate = {
      key,
      noPalka: row.noPalka,
      ffa: String(row.ffa ?? ''),
      moisture: String(row.moisture ?? ''),
    }
    if (!existing) {
      newRecords.push(candidate)
    } else if (sameMetric(existing.ffa, candidate.ffa) && sameMetric(existing.moisture, candidate.moisture)) {
      unchanged.push(candidate)
    } else {
      conflicts.push({
        ...candidate,
        current: { ffa: String(existing.ffa ?? ''), moisture: String(existing.moisture ?? '') },
        extracted: { ffa: candidate.ffa, moisture: candidate.moisture },
      })
    }
  }

  const startTimeValue = ymdToDateTimeLocal(fields?.documentDate)
  const currentStartTime = String(sampling?.startTime ?? '').trim()
  const startTimeHint = startTimeValue
    ? { value: startTimeValue, currentValue: currentStartTime, defaultOn: !currentStartTime }
    : null

  const qualityProposals = buildQualityProposals(sampling, fields)

  const warnings = []
  // Reading an image cell by cell is accurate on the values but does drop whole rows when
  // a palka label will not read, so the count is the thing to check, not the digits.
  if (context?.source === 'ocr_image') {
    warnings.push({
      code: 'ocr_quality',
      message:
        'These values were read from an image. Rows the reader could not identify are left out rather than guessed, so check that every palka in the document is listed below before you apply.',
    })
  }
  if (vesselNamesLookDifferent(fields?.vesselName, context?.vesselName)) {
    warnings.push({
      code: 'vessel_mismatch',
      message: `Document is for "${String(fields.vesselName).trim()}" but this operation is "${String(context.vesselName).trim()}". Check you uploaded the right report.`,
      params: {
        documentVessel: String(fields.vesselName).trim(),
        operationVessel: String(context.vesselName).trim(),
      },
    })
  }

  const expectedPalka = toNum(context?.numberOfPalka)
  const applicable = newRecords.length + conflicts.length + unchanged.length
  if (expectedPalka != null && expectedPalka > 0 && applicable > 0 && applicable !== expectedPalka) {
    warnings.push({
      code: 'palka_count',
      message: `Found ${applicable} palka rows but this vessel is recorded as having ${expectedPalka}.`,
      params: { found: applicable, expected: expectedPalka },
    })
  }

  const allExtracted = [...newRecords, ...unchanged, ...conflicts.map((c) => ({ ...c.extracted }))]
  const avgFfa = averageOf(allExtracted, 'ffa')
  const avgMoisture = averageOf(allExtracted, 'moisture')
  const statedFfa = toNum(fields?.statedAvgFfa)
  const statedMoisture = toNum(fields?.statedAvgMoisture)
  if (statedFfa != null && avgFfa != null && Math.abs(statedFfa - avgFfa) > AVERAGE_TOLERANCE) {
    warnings.push({
      code: 'avg_ffa_mismatch',
      message: `Report states an FFA average of ${statedFfa} but the rows read average ${avgFfa.toFixed(2)}. Some rows may be missing or misread.`,
      params: { stated: statedFfa, computed: avgFfa.toFixed(2) },
    })
  }
  if (statedMoisture != null && avgMoisture != null && Math.abs(statedMoisture - avgMoisture) > AVERAGE_TOLERANCE) {
    warnings.push({
      code: 'avg_moisture_mismatch',
      message: `Report states a Moisture average of ${statedMoisture} but the rows read average ${avgMoisture.toFixed(2)}. Some rows may be missing or misread.`,
      params: { stated: statedMoisture, computed: avgMoisture.toFixed(2) },
    })
  }

  return {
    newRecords,
    conflicts,
    unchanged,
    startTimeHint,
    qualityProposals,
    warnings,
    totalExtracted: extracted.length,
    applicableCount: newRecords.length + conflicts.length,
    statedAvgFfa: statedFfa,
    statedAvgMoisture: statedMoisture,
  }
}

/** Initial modal selections: take every new row and empty quality field, keep existing values on conflicts. */
export function defaultSamplingExtractChoices(proposal) {
  const includeNew = {}
  for (const row of proposal?.newRecords || []) includeNew[row.key] = true
  const conflictMode = {}
  for (const row of proposal?.conflicts || []) conflictMode[row.key] = 'keep'
  const quality = {}
  for (const item of proposal?.qualityProposals || []) {
    quality[item.key] = item.status === 'new' ? 'extracted' : 'keep'
  }
  return {
    includeNew,
    conflictMode,
    quality,
    applyStartTime: Boolean(proposal?.startTimeHint?.defaultOn),
  }
}

/** True when Apply would change nothing, so the modal can disable the button. */
export function samplingExtractChoicesAreEmpty(proposal, choices) {
  if (!proposal || !choices) return true
  const anyNew = (proposal.newRecords || []).some((r) => choices.includeNew?.[r.key])
  const anyConflict = (proposal.conflicts || []).some((r) => choices.conflictMode?.[r.key] === 'extracted')
  const anyQuality = (proposal.qualityProposals || []).some(
    (p) => p.status !== 'unchanged' && choices.quality?.[p.key] === 'extracted'
  )
  return !anyNew && !anyConflict && !anyQuality && !choices.applyStartTime
}

function nextSamplingRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Apply the confirmed selections and return the next sampling draft plus a summary.
 *
 * @param {object} sampling current sampling draft
 * @param {object} proposal from proposeSamplingExtractMerge
 * @param {object} choices from the review modal
 * @param {{ makeId?: () => string }} [opts] injectable id factory for tests
 */
export function applySamplingExtractMerge(sampling, proposal, choices, opts = {}) {
  const makeId = opts.makeId || nextSamplingRecordId
  const base = sampling || {}
  const summary = { added: 0, updated: 0, startTimeSet: false, qualityFilled: 0 }

  const overwrite = new Map()
  for (const row of proposal?.conflicts || []) {
    if (choices?.conflictMode?.[row.key] === 'extracted') overwrite.set(row.key, row.extracted)
  }

  // Duplicate palka rows are possible in existing data; update every matching row.
  const records = (Array.isArray(base.records) ? base.records : []).map((rec) => {
    const hit = overwrite.get(samplingPalkaKey(rec?.noPalka))
    if (!hit) return rec
    summary.updated += 1
    return { ...rec, ffa: hit.ffa, moisture: hit.moisture }
  })

  for (const row of proposal?.newRecords || []) {
    if (!choices?.includeNew?.[row.key]) continue
    records.push({
      id: makeId(),
      noPalka: String(row.noPalka).trim().slice(0, MAX_SAMPLING_PALKA_FIELD_CHARS),
      ffa: row.ffa,
      moisture: row.moisture,
    })
    summary.added += 1
  }

  const next = { ...base, records }

  if (choices?.applyStartTime && proposal?.startTimeHint?.value) {
    next.startTime = proposal.startTimeHint.value
    summary.startTimeSet = true
  }

  for (const item of proposal?.qualityProposals || []) {
    if (item.status === 'unchanged') continue
    if (choices?.quality?.[item.key] !== 'extracted') continue
    next[item.key] = item.extracted
    summary.qualityFilled += 1
  }

  return { nextSampling: next, summary }
}

/** Short sentence for the post-apply toast. */
export function summarizeSamplingExtractApply(summary, fileName) {
  const bits = []
  if (summary?.added) bits.push(`${summary.added} palka row${summary.added === 1 ? '' : 's'} added`)
  if (summary?.updated) bits.push(`${summary.updated} updated`)
  if (summary?.startTimeSet) bits.push('start time set')
  if (summary?.qualityFilled) {
    bits.push(`${summary.qualityFilled} quality value${summary.qualityFilled === 1 ? '' : 's'} filled`)
  }
  if (!bits.length) return 'No changes applied.'
  const from = fileName ? ` from ${fileName}` : ''
  return `${bits.join(', ')}${from}.`
}
