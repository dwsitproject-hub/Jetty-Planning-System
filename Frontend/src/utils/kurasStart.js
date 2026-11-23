/**
 * Kuras start point inside one cargo entry: form draft from a saved line, the payload value
 * the API expects, and the explanation shown under the field.
 * Modes: 'auto' (found from hourly ATG), 'manual' (operator time), 'none' (operator: no kuras).
 */

/**
 * @param {object} line saved cargo line ({ kurasStartedAt, kurasStartSource, kurasStartReason })
 * @param {(iso: string) => string} toLocal UTC ISO → datetime-local value in the port time zone
 */
export function kurasStartDraftFromLine(line, toLocal) {
  const startedAt = line?.kurasStartedAt ?? null
  const source = line?.kurasStartSource === 'manual' ? 'manual' : 'auto'
  const mode = source === 'manual' ? (startedAt ? 'manual' : 'none') : 'auto'
  return {
    kurasStartMode: mode,
    kurasStartInput: mode === 'manual' && startedAt ? toLocal(startedAt) : '',
    kurasStartTouched: false,
    persistedKurasStart: { startedAt, source, reason: line?.kurasStartReason ?? null },
  }
}

/**
 * Value for cargoLoadLines[].kurasStart. Untouched → undefined (server keeps what it has).
 * @param {(local: string) => string} toApi datetime-local → API instant
 * @returns {{ value?: string, error?: string }}
 */
export function kurasStartPayload(draft, toApi) {
  if (!draft?.kurasStartTouched) return {}
  if (draft.kurasStartMode === 'none') return { value: 'none' }
  if (draft.kurasStartMode !== 'manual') return { value: 'auto' }
  if (!draft.kurasStartInput) return { error: 'kurasStartTimeRequired' }
  return { value: toApi(draft.kurasStartInput) }
}

function num(value, locale) {
  return Number(value).toLocaleString(locale, { maximumFractionDigits: 1 })
}

/** Sentence under the field for what is stored now. */
export function describeKurasStart(t, draft, { formatAt, locale } = {}) {
  const p = draft?.persistedKurasStart
  if (!p) return t('kurasStartPending')
  if (p.source === 'manual') {
    return p.startedAt ? t('kurasStartManual', { at: formatAt(p.startedAt) }) : t('kurasStartManualNone')
  }
  const r = p.reason
  if (p.startedAt && r?.code === 'kurasStart') {
    return t('kurasStartAuto', {
      at: formatAt(p.startedAt),
      remaining: num(r.remainingPct, locale),
      rate: num(r.rateMtPerHour, locale),
    })
  }
  if (r?.code === 'noKuras') return t('kurasStartAutoNone')
  if (r?.code === 'noHourly') return t('kurasStartNoHourly')
  if (r?.code === 'noRule') return t('kurasStartNoRule')
  return t('kurasStartPending')
}
