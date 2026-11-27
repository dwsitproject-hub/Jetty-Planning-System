/**
 * Cargo entry movement type (Normal / Kuras): draft state from a saved line, and the
 * localized "why" sentence built from the reason the API stores ({ code, remainingPct, ... }).
 */

/** Draft fields for the entry form: select value plus what is stored on the server. */
export function movementDraftFromLine(line) {
  const source = line?.movementTypeSource === 'manual' ? 'manual' : 'auto'
  const type = ['kuras', 'normal', 'mixed'].includes(line?.movementType) ? line.movementType : null
  return {
    movementType: source === 'manual' && type ? type : 'auto',
    persistedMovement: {
      type,
      source,
      reason: line?.movementTypeReason ?? null,
      setAt: line?.movementTypeSetAt ?? null,
      setByName: line?.movementTypeSetByName ?? null,
    },
  }
}

export function movementTypeLabel(t, type) {
  if (type === 'mixed') return t('cargoOpsMovementMixedShort')
  return type === 'kuras' ? 'Kuras' : t('cargoOpsMovementNormal')
}

function num(value, locale) {
  return Number(value).toLocaleString(locale, { maximumFractionDigits: 1 })
}

/** Sentence for an auto decision; null when there is no stored reason. */
export function formatKurasReason(t, reason, locale) {
  if (!reason?.code) return null
  switch (reason.code) {
    case 'open':
      return t('kurasReasonOpen')
    case 'noRule':
      return t('kurasReasonNoRule')
    case 'noPlan':
      return t('kurasReasonNoPlan')
    case 'noMtRate':
      return t('kurasReasonNoMtRate')
    case 'kuras':
    case 'normal':
      return t('kurasReasonDecided', {
        type: movementTypeLabel(t, reason.code),
        remaining: num(reason.remainingPct, locale),
        remainingCmp: t(reason.remainingHit ? 'kurasReasonBelow' : 'kurasReasonNotBelow'),
        remainingLimit: num(reason.remainingLimit, locale),
        rate: num(reason.rateMtPerHour, locale),
        rateCmp: t(reason.rateHit ? 'kurasReasonBelow' : 'kurasReasonNotBelow'),
        rateLimit: num(reason.rateLimit, locale),
        match: t(reason.match === 'or' ? 'kurasReasonMatchOr' : 'kurasReasonMatchAnd'),
        rule: reason.ruleLabel || t('kurasReasonRuleDefault'),
      })
    default:
      return null
  }
}

/**
 * Badge + explanation for one draft entry.
 * @returns {{ badge: { type: string, source: 'auto'|'manual' }|null, text: string }}
 */
export function describeEntryMovement(t, draft, { locale, formatAt } = {}) {
  const persisted = draft?.persistedMovement
  const chosen = draft?.movementType || 'auto'
  if (chosen !== 'auto') {
    const saved = persisted?.source === 'manual' && persisted.type === chosen
    const typeLabel = movementTypeLabel(t, chosen)
    const text =
      saved && persisted.setByName
        ? t('kurasReasonManual', { type: typeLabel, name: persisted.setByName, at: formatAt ? formatAt(persisted.setAt) : persisted.setAt })
        : t('kurasReasonManualNoName', { type: typeLabel })
    return { badge: { type: chosen, source: 'manual' }, text }
  }
  if (persisted?.source === 'auto' && persisted.reason) {
    const text = formatKurasReason(t, persisted.reason, locale) || t('cargoOpsMovementPending')
    return { badge: persisted.type ? { type: persisted.type, source: 'auto' } : null, text }
  }
  return { badge: null, text: t('cargoOpsMovementPending') }
}

/**
 * One-line movement label of a saved cargo entry for lists and tables.
 * @returns {{ type: 'normal'|'kuras'|'mixed', text: string }|null} null when the entry was not classified yet
 */
export function entryMovementLabel(t, line) {
  const type = line?.movementType
  if (type === 'kuras') return { type: 'kuras', text: movementTypeLabel(t, 'kuras') }
  if (type === 'mixed') {
    const palkas = [...new Set((line.kurasPeriods || []).map((p) => p.palka).filter(Boolean))]
    const base = movementTypeLabel(t, 'mixed')
    return { type: 'mixed', text: palkas.length ? `${base} (${palkas.join(', ')})` : base }
  }
  if (line?.kurasStartedAt) return { type: 'kuras', text: t('cargoOpsMovementNormalThenKuras') }
  if (type === 'normal') return { type: 'normal', text: movementTypeLabel(t, 'normal') }
  return null
}
