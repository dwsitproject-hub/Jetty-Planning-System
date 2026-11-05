/** Client-side helpers for commodity QC templates. */

export const FALLBACK_SPEC = {
  templateId: null,
  name: null,
  parameters: [
    { code: 'ffa', labelEn: 'FFA', labelId: 'FFA', unit: '%', method: 'AOCS Ca 5a-40', kind: 'number', maxValue: 100, scope: 'both' },
    { code: 'moisture', labelEn: 'Moisture', labelId: 'Moisture', unit: '%', method: 'AOCS Ca 2c-25', kind: 'number', maxValue: 100, scope: 'both' },
    { code: 'dobi', labelEn: 'DOBI', labelId: 'DOBI', unit: null, method: null, kind: 'number', maxValue: 100, scope: 'report' },
    { code: 'iodine', labelEn: 'IV', labelId: 'IV', unit: 'gI2/100g', method: 'AOCS Cd 1-25', kind: 'number', maxValue: 200, scope: 'report' },
  ],
}

export const ALIAS_BY_CODE = {
  ffa: 'ffaAverage',
  mi: 'moistureAverage',
  moisture: 'moistureAverage',
  dobi: 'dobi',
  iodine: 'iodineValue',
}

export function specOf(card) {
  return card?.spec?.parameters?.length ? card.spec : FALLBACK_SPEC
}

export function valueCodesOf(param) {
  if (param?.kind === 'color_pair') return ['color_red', 'color_yellow']
  return [param.code]
}

export function reportParams(spec) {
  return (spec?.parameters || []).filter((p) => p.scope === 'report' || p.scope === 'both')
}

export function sampleParams(spec) {
  return (spec?.parameters || []).filter((p) => p.scope === 'sample' || p.scope === 'both')
}

export function metricValue(card, code) {
  if (card?.metrics && card.metrics[code] != null && card.metrics[code] !== '') return card.metrics[code]
  if (card?.[code] != null && String(card[code]).trim() !== '') return card[code]
  const alias = ALIAS_BY_CODE[code]
  return alias ? card?.[alias] ?? '' : ''
}

/** Metric-only patch. Omits the rest of the card so a report edit does not look like a sample-list change. */
export function patchCardMetric(card, code, value) {
  const next = { metrics: { ...(card.metrics || {}), [code]: value } }
  const alias = ALIAS_BY_CODE[code]
  if (alias) next[alias] = value
  return next
}

export function paramLabel(param, language) {
  if (!param) return ''
  return language === 'id' ? param.labelId || param.labelEn || '' : param.labelEn || param.labelId || ''
}

export function paramUnit(param) {
  return param?.unit != null && String(param.unit).trim() !== '' ? String(param.unit).trim() : ''
}

export function paramMethod(param) {
  return param?.method != null && String(param.method).trim() !== '' ? String(param.method).trim() : ''
}

export function paramFieldLabel(param, code, language) {
  const name = paramLabel(param, language)
  if (param?.kind === 'color_pair') return `${name} ${code === 'color_red' ? 'R' : 'Y'}`
  return name
}

/** Queue line extras when FFA / moisture are absent: first two filled report metrics. */
export function queuePreviewMetrics(sampling) {
  if (sampling?.avgFfa || sampling?.avgMoisture) return []
  return (sampling?.previewMetrics || []).filter((m) => m?.value).slice(0, 2)
}
