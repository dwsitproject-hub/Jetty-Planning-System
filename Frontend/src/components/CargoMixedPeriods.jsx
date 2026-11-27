import { useTranslation } from 'react-i18next'
import { PALKA_MAX, cleanPalka, emptyPeriod, validatePeriods } from '../utils/kurasPeriods.js'

/**
 * Palka rows of a Mixed (Normal & Kuras) entry: another palka is cleaned while pumping goes on.
 * Palka is a short text (3 characters), From / Until are datetime-local values in the port time zone.
 * Errors show under the field they belong to; the parent blocks the save while any is left.
 */
export default function CargoMixedPeriods({ idPrefix, draft, disabled, onChange, formatEntryTime }) {
  const { t } = useTranslation('pages')
  const rows = Array.isArray(draft?.kurasPeriods) ? draft.kurasPeriods : []
  const entryStart = draft?.start || ''
  const entryEnd = draft?.end || ''
  const entryQty = Number(draft?.qty) > 0 ? Number(draft.qty) : Number(draft?.manualQty) > 0 ? Number(draft.manualQty) : null
  const errors = validatePeriods(rows, { entryStart, entryEnd, entryQty })

  const setRows = (next) => onChange({ kurasPeriods: next })
  const patch = (key, p) => setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const remove = (key) => setRows(rows.filter((r) => r.key !== key))
  const add = () => setRows([...rows, emptyPeriod(entryStart)])
  // "required" errors wait for the save; wrong values show as soon as they are typed
  const REQUIRED = ['kurasErrPalka', 'kurasErrFromRequired']
  const shown = (i, field) => (errors[i][field] && !REQUIRED.includes(errors[i][field]) ? errors[i][field] : null)
  const err = (i, field, extra) => (shown(i, field) ? <p className="cargo-mixed__err" role="alert">{t(shown(i, field), extra)}</p> : null)
  const at = (v) => (formatEntryTime ? formatEntryTime(v) : v)

  return (
    <div className="cargo-mixed">
      {rows.map((r, i) => (
        <div key={r.key} className="cargo-mixed__row">
          <div className="cargo-mixed__grid">
            <div>
              <label className="cargo-mixed__lbl" htmlFor={`${idPrefix}-palka-${i}`}>{t('kurasPalka')}</label>
              <input
                id={`${idPrefix}-palka-${i}`}
                className={`modal__input${shown(i, 'palka') ? ' is-invalid' : ''}`}
                value={r.palka}
                maxLength={PALKA_MAX}
                disabled={disabled}
                autoComplete="off"
                onChange={(e) => patch(r.key, { palka: cleanPalka(e.target.value) })}
              />
              {err(i, 'palka')}
            </div>
            <div>
              <label className="cargo-mixed__lbl" htmlFor={`${idPrefix}-from-${i}`}>{t('kurasFrom')}</label>
              <input
                id={`${idPrefix}-from-${i}`}
                type="datetime-local"
                className={`modal__input${shown(i, 'from') ? ' is-invalid' : ''}`}
                value={r.from}
                min={entryStart || undefined}
                max={entryEnd || undefined}
                disabled={disabled}
                onChange={(e) => patch(r.key, { from: e.target.value })}
              />
              {err(i, 'from', { time: at(entryStart) })}
            </div>
            <div>
              <label className="cargo-mixed__lbl" htmlFor={`${idPrefix}-until-${i}`}>{t('kurasUntil')}</label>
              <input
                id={`${idPrefix}-until-${i}`}
                type="datetime-local"
                className={`modal__input${shown(i, 'until') ? ' is-invalid' : ''}`}
                value={r.until}
                min={r.from || entryStart || undefined}
                max={entryEnd || undefined}
                disabled={disabled}
                onChange={(e) => patch(r.key, { until: e.target.value })}
              />
              {err(i, 'until', { time: at(entryEnd) })}
            </div>
          </div>
          <div className="cargo-mixed__actions">
            {r.showQty ? (
              <div className="cargo-mixed__qty">
                <label className="cargo-mixed__lbl" htmlFor={`${idPrefix}-qty-${i}`}>{t('kurasQtyLabel')}</label>
                <input
                  id={`${idPrefix}-qty-${i}`}
                  className={`modal__input${shown(i, 'qty') ? ' is-invalid' : ''}`}
                  inputMode="decimal"
                  value={r.qty}
                  disabled={disabled}
                  onChange={(e) => patch(r.key, { qty: e.target.value })}
                />
                <p className="cargo-movement-type__reason">{t('kurasQtyHint')}</p>
                {err(i, 'qty')}
              </div>
            ) : (
              <button type="button" className="cargo-mixed__link" disabled={disabled} onClick={() => patch(r.key, { showQty: true })}>
                {t('kurasAddQty')}
              </button>
            )}
            {rows.length > 1 ? (
              <button type="button" className="cargo-mixed__link cargo-mixed__link--danger" disabled={disabled} onClick={() => remove(r.key)}>
                {t('kurasRemovePalka')}
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <button type="button" className="cargo-mixed__link" disabled={disabled} onClick={add}>
        {t('kurasAnotherPalka')}
      </button>
    </div>
  )
}
