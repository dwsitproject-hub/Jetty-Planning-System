import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyFormHint, useStickyFormDismiss } from '../StickyFormOverlay.jsx'
import { reasonName } from '../../utils/noFlowDisplay.js'

const QUICK_PICKS = 6

/**
 * Reason picker for live stops. mode: cargo_stop (Stop cargo), flow_pause (Flow stopped),
 * nudge (ATG shows no flow) or change (open stop). cargo_stop also offers
 * "End of cargo" and "Skip for now", which stop cargo without logging a stop.
 */
export default function OperatorStopReasonSheet({ sheet, reasons, initialReasonId, busy, onCancel, onConfirm, onStopOnly }) {
  const { t, i18n } = useTranslation('operator')
  const { overlayRef, onBackdropClick, showHint, nudgeClassName } = useStickyFormDismiss()
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sheet) return
    setReasonId(initialReasonId || '')
    setNote('')
    setError('')
  }, [sheet, initialReasonId])

  if (!sheet) return null
  const mode = sheet.mode
  const selected = reasons.find((r) => r.id === reasonId)

  const submit = () => {
    if (!reasonId) return setError(t('noFlow.reasonRequired'))
    if (selected?.requiresNote && note.trim().length < 3) return setError(t('noFlow.noteRequired'))
    return onConfirm({ reasonId, note: note.trim() })
  }

  return (
    <div
      ref={overlayRef}
      className={`operator-modal-backdrop sticky-form-overlay ${nudgeClassName}`.trim()}
      role="presentation"
      onClick={onBackdropClick}
    >
      <StickyFormHint show={showHint} />
      <div className="operator-modal" role="dialog" aria-modal="true" aria-label={t(`noFlow.sheetTitle_${mode}`)} onClick={(e) => e.stopPropagation()}>
        <div className="operator-modal__title-row">
          <h2>{t(`noFlow.sheetTitle_${mode}`)}</h2>
          <button type="button" className="modal__close" onClick={onCancel} aria-label={t('close', { ns: 'common' })} disabled={busy}>
            ×
          </button>
        </div>
        <div className="operator-stop-sheet__chips">
          {reasons.slice(0, QUICK_PICKS).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`operator-stop-chip${r.id === reasonId ? ' is-active' : ''}`}
              onClick={() => setReasonId(r.id)}
            >
              {reasonName(r, i18n.language)}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="operator-stop-reason">{t('noFlow.allReasons')}</label>
          <select id="operator-stop-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">{t('noFlow.selectReason')}</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>{reasonName(r, i18n.language)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="operator-stop-note">{selected?.requiresNote ? t('noFlow.noteRequiredLabel') : t('noFlow.noteLabel')}</label>
          <input id="operator-stop-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <p className="operator-error-banner" role="alert">{error}</p> : null}
        <div className="operator-modal__actions operator-stop-sheet__actions">
          <button type="button" className="op-btn op-btn--primary" disabled={busy} onClick={submit}>
            {t(`noFlow.confirm_${mode}`)}
          </button>
          {mode === 'cargo_stop' ? (
            <>
              <button type="button" className="op-btn" disabled={busy} onClick={onStopOnly}>
                {t('noFlow.endOfCargo')}
              </button>
              <button type="button" className="op-btn op-btn--soft" disabled={busy} onClick={onStopOnly}>
                {t('noFlow.skip')}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
