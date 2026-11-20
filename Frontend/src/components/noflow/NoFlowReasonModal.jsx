import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import StickyFormOverlay from '../StickyFormOverlay.jsx'
import { createNoFlowEvent, updateNoFlowEvent } from '../../api/noFlow'
import { normalizeForApi, utcIsoToNaiveLocal } from '../../utils/scheduleDateTime.js'
import { reasonName } from '../../utils/noFlowDisplay.js'

const CATEGORY_ORDER = ['terminal', 'vessel', 'external', 'other']
const QUICK_PICKS = 4

/**
 * Add / edit one stop: prefilled times (from a detected stop or an existing record),
 * quick-pick chips for the first reasons, grouped dropdown for all, note when required.
 */
export default function NoFlowReasonModal({ operationId, stop, reasons, tz, onSaved, onClose }) {
  const { t, i18n } = useTranslation('pages')
  const isEdit = stop?.kind === 'event'
  const [from, setFrom] = useState(stop?.startedAt ? utcIsoToNaiveLocal(stop.startedAt, tz) : '')
  const [to, setTo] = useState(stop?.endedAt ? utcIsoToNaiveLocal(stop.endedAt, tz) : '')
  const [reasonId, setReasonId] = useState(stop?.reasonId ?? '')
  const [note, setNote] = useState(stop?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = reasons.find((r) => r.id === reasonId) || null
  const grouped = useMemo(
    () => CATEGORY_ORDER.map((c) => ({ c, items: reasons.filter((r) => r.category === c) })).filter((g) => g.items.length),
    [reasons]
  )

  const save = async () => {
    if (!from || (!to && !stop?.isOpen)) return setError(t('noFlowTimesRequired'))
    if (!reasonId) return setError(t('noFlowReasonRequired'))
    if (selected?.requiresNote && note.trim().length < 3) return setError(t('noFlowNoteRequired'))
    setSaving(true)
    setError('')
    const body = {
      startedAt: normalizeForApi(from, tz),
      endedAt: to ? normalizeForApi(to, tz) : null,
      reasonId,
      note: note.trim() || null,
      source: stop?.source || 'manual',
    }
    try {
      if (isEdit) await updateNoFlowEvent(operationId, stop.id, body)
      else await createNoFlowEvent(operationId, body)
      onSaved()
    } catch (e) {
      setError(e?.message || t('noFlowSaveFailed'))
      setSaving(false)
    }
  }

  return (
    <StickyFormOverlay onClose={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="no-flow-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="no-flow-modal-title" className="modal__title">{isEdit ? t('noFlowEditTitle') : t('noFlowAddTitle')}</h2>
        {stop?.source ? <p className="text-steel">{t(`noFlowSource_${stop.source}`)}</p> : null}
        <div className="modal__body">
          <div className="no-flow-modal__times">
            <div className="modal__field">
              <label className="modal__label" htmlFor="no-flow-from">{t('noFlowFrom')}</label>
              <input id="no-flow-from" type="datetime-local" className="modal__input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="modal__field">
              <label className="modal__label" htmlFor="no-flow-to">{t('noFlowTo')}</label>
              <input id="no-flow-to" type="datetime-local" className="modal__input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="modal__field">
            <span className="modal__label">{t('noFlowCommonReasons')}</span>
            <div className="no-flow-modal__chips">
              {reasons.slice(0, QUICK_PICKS).map((r) => (
                <button key={r.id} type="button" className={`no-flow-chip${r.id === reasonId ? ' no-flow-chip--on' : ''}`} onClick={() => setReasonId(r.id)}>
                  {reasonName(r, i18n.language)}
                </button>
              ))}
            </div>
          </div>
          <div className="modal__field">
            <label className="modal__label" htmlFor="no-flow-reason">{t('noFlowReason')}</label>
            <select id="no-flow-reason" className="modal__input" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="">{t('noFlowSelectReason')}</option>
              {grouped.map((g) => (
                <optgroup key={g.c} label={t(`noFlowCategory_${g.c}`)}>
                  {g.items.map((r) => (
                    <option key={r.id} value={r.id}>{reasonName(r, i18n.language)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="modal__field">
            <label className="modal__label" htmlFor="no-flow-note">
              {selected?.requiresNote ? t('noFlowNoteRequiredLabel') : t('noFlowNoteLabel')}
            </label>
            <textarea id="no-flow-note" className="modal__input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('noFlowNotePlaceholder')} />
          </div>
          {error ? <p role="alert" style={{ color: 'var(--color-danger, #c00)' }}>{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>{t('noFlowCancel')}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>{saving ? t('noFlowSaving') : t('noFlowSave')}</button>
        </div>
      </div>
    </StickyFormOverlay>
  )
}
