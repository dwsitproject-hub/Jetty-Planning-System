/** @param {{ vesselName?: string | null, hubCode?: string | null }} v */
export function formatMasterVesselLabel(v) {
  if (!v) return ''
  const name = v.vesselName != null ? String(v.vesselName).trim() : ''
  const hub = v.hubCode != null ? String(v.hubCode).trim() : ''
  if (!name) return hub || ''
  return hub ? `${name} (${hub})` : name
}

export function isPositiveVesselNumber(raw) {
  const n = Number(raw)
  return raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n > 0
}

/** Copy master vessel fields onto a plan form. */
export function fieldsFromMasterVessel(v) {
  return {
    masterVesselId: v?.id != null ? String(v.id) : '',
    vesselName: v?.vesselName != null ? String(v.vesselName).trim() : '',
    vesselLoaM:
      v?.vesselLengthOverall != null && String(v.vesselLengthOverall).trim() !== ''
        ? String(v.vesselLengthOverall).trim()
        : '',
    vesselGrossTonnage:
      v?.vesselGrossTonnage != null && String(v.vesselGrossTonnage).trim() !== ''
        ? String(v.vesselGrossTonnage)
        : '',
    vesselDraft:
      v?.vesselDraft != null && String(v.vesselDraft).trim() !== '' ? String(v.vesselDraft) : '',
    vesselType: v?.vesselType != null ? String(v.vesselType).trim() : '',
    vesselHullType: v?.typeLambung != null ? String(v.typeLambung).trim() : '',
  }
}

const VESSEL_TYPE_LABELS = {
  barge: 'Barge',
  tanker: 'Tanker',
  SPOB: 'SPOB',
  tugboat: 'Tugboat',
  'wooden boat': 'Wooden boat',
}

export function vesselTypeLabel(value) {
  if (value == null || String(value).trim() === '') return ''
  const key = String(value).trim()
  return VESSEL_TYPE_LABELS[key] || key
}

export function masterVesselDimensionsComplete(fields) {
  return Boolean(fields?.vesselName)
    && isPositiveVesselNumber(fields.vesselLoaM)
    && isPositiveVesselNumber(fields.vesselGrossTonnage)
    && isPositiveVesselNumber(fields.vesselDraft)
}

/** @param {Record<string, unknown>} v */
export function masterVesselToSelectOption(v) {
  const id = v?.id
  return {
    value: id != null ? String(id) : '',
    label: formatMasterVesselLabel(v),
    vessel: v,
  }
}
