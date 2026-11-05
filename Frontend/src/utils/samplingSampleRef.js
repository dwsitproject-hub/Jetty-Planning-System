import { resolvePurposeLabel } from './resolvePurposeLabel.js'

export function sampleRefKindFromPurpose(purpose, loadDischarge) {
  return resolvePurposeLabel(purpose, loadDischarge) === 'Loading' ? 'tank' : 'palka'
}

export function tankCodeOf(tanks, tankId) {
  const hit = (tanks || []).find((t) => String(t.id) === String(tankId))
  return hit?.code ? String(hit.code).trim() : ''
}

export function matchTankId(record, tanks) {
  if (record?.tankId != null && String(record.tankId).trim() !== '') return String(record.tankId)
  const code = String(record?.noPalka || '').trim().toLowerCase()
  if (!code) return ''
  const hit = (tanks || []).find((t) => String(t.code || '').trim().toLowerCase() === code)
  return hit ? String(hit.id) : ''
}

export function tankOptions(tanks, { tankId, noPalka } = {}) {
  const options = (tanks || []).map((t) => ({
    value: String(t.id),
    label: t.name ? `${t.code} — ${t.name}` : String(t.code || t.id),
    keywords: `${t.code || ''} ${t.name || ''} ${t.productName || ''}`,
  }))
  if (tankId && !options.some((o) => o.value === String(tankId))) {
    options.unshift({ value: String(tankId), label: noPalka || String(tankId) })
  }
  return options
}
