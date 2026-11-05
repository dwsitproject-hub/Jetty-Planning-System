/** Client-side helpers for commodity QC templates. */

export const FALLBACK_SPEC = {
  templateId: null,
  name: null,
  parameters: [
    { code: 'ffa', labelEn: 'FFA', labelId: 'FFA', unit: '%', kind: 'number', maxValue: 100, scope: 'both' },
    { code: 'moisture', labelEn: 'Moisture', labelId: 'Moisture', unit: '%', kind: 'number', maxValue: 100, scope: 'both' },
    { code: 'dobi', labelEn: 'DOBI', labelId: 'DOBI', unit: null, kind: 'number', maxValue: 100, scope: 'report' },
    { code: 'iodine', labelEn: 'IV', labelId: 'IV', unit: 'gI2/100g', kind: 'number', maxValue: 200, scope: 'report' },
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

/** Patch one metric and keep the four legacy aliases in sync. */
export function patchCardMetric(card, code, value) {
  const metrics = { ...(card.metrics || {}), [code]: value }
  const next = { ...card, metrics }
  const alias = ALIAS_BY_CODE[code]
  if (alias) next[alias] = value
  return next
}

export function paramLabel(param, language) {
  if (!param) return ''
  const label = language === 'id' ? param.labelId || param.labelEn : param.labelEn || param.labelId
  return param.unit ? `${label} (${param.unit})` : label
}

/** Queue line extras when FFA / moisture are absent: first two filled report metrics. */
export function queuePreviewMetrics(sampling) {
  if (sampling?.avgFfa || sampling?.avgMoisture) return []
  return (sampling?.previewMetrics || []).filter((m) => m?.value).slice(0, 2)
}
