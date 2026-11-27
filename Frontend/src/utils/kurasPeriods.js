/**
 * Mixed (Normal & Kuras) entries: the palka periods of one cargo entry in the form.
 * A period = palka (up to 3 characters), from, until (empty = still going), optional quantity
 * cleaned. Dates are datetime-local values in the port time zone, so they compare as text.
 */

let seq = 0
const newKey = () => `kp-${Date.now()}-${seq++}`

export const PALKA_MAX = 3

export function emptyPeriod(from = '') {
  return { key: newKey(), palka: '', from, until: '', qty: '', showQty: false }
}

/** Form rows from the saved periods of a line. */
export function kurasPeriodsDraftFromLine(line, toLocal) {
  const list = Array.isArray(line?.kurasPeriods) ? line.kurasPeriods : []
  return {
    kurasPeriods: list.map((p) => ({
      key: newKey(),
      palka: String(p.palka || ''),
      from: p.startAt ? toLocal(p.startAt) : '',
      until: p.endAt ? toLocal(p.endAt) : '',
      qty: p.qty != null ? String(p.qty) : '',
      showQty: p.qty != null,
    })),
  }
}

/** Palka text as typed: letters and digits only, upper case, 3 characters at most. */
export function cleanPalka(raw) {
  return String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, PALKA_MAX)
}

/**
 * Check every row. Returns one error object per row ({} = fine); error values are i18n keys.
 * @param {Array} rows form rows
 * @param {{ entryStart: string, entryEnd: string }} entry datetime-local values ('' = none)
 * @param {number|null} entryQty quantity of the entry when known
 */
export function validatePeriods(rows, { entryStart, entryEnd, entryQty = null }) {
  const errors = rows.map((r) => {
    const e = {}
    if (!r.palka) e.palka = 'kurasErrPalka'
    if (!r.from) e.from = 'kurasErrFromRequired'
    else if (entryStart && r.from < entryStart) e.from = 'kurasErrFromBefore'
    else if (entryEnd && r.from >= entryEnd) e.from = 'kurasErrFromAfterEnd'
    if (r.until) {
      if (r.from && r.until <= r.from) e.until = 'kurasErrUntilAfterFrom'
      else if (entryEnd && r.until > entryEnd) e.until = 'kurasErrUntilBeyond'
    }
    if (r.qty !== '' && r.qty != null) {
      const q = Number(r.qty)
      if (!Number.isFinite(q) || q <= 0) e.qty = 'kurasErrQty'
      else if (entryQty != null && Number.isFinite(Number(entryQty)) && q > Number(entryQty)) e.qty = 'kurasErrQtyMax'
    }
    return e
  })
  rows.forEach((r, i) => {
    if (errors[i].from || errors[i].until || !r.palka || !r.from) return
    const end = r.until || '9999-12-31T23:59'
    rows.forEach((o, j) => {
      if (j <= i || o.palka !== r.palka || !o.from) return
      const oEnd = o.until || '9999-12-31T23:59'
      if (o.from < end && r.from < oEnd) errors[j].palka = errors[j].palka || 'kurasErrOverlap'
    })
  })
  return errors
}

export const hasPeriodErrors = (errors) => errors.some((e) => Object.keys(e).length > 0)

/** Payload rows for cargoLoadLines[].kurasPeriods. */
export function kurasPeriodsPayload(rows, toApi) {
  return rows.map((r) => ({
    palka: r.palka,
    from: toApi(r.from),
    until: r.until ? toApi(r.until) : null,
    qty: r.qty !== '' && r.qty != null ? Number(r.qty) : null,
  }))
}
