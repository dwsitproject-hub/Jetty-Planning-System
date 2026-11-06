import { useState } from 'react'
import { acknowledgeAtgCargoGaps } from '../../api/adminOps'
import '../../styles/modal.css'

const MIN_REASON_LENGTH = 5
const QUICK_REASON_KEYS = ['atgGapAckReasonArchiveEmpty', 'atgGapAckReasonManualQty', 'atgGapAckReasonNoCargo']

/** Accept gaps as unrecoverable with a mandatory reason; they stop driving the health status. */
export default function AtgGapAckDialog({ operation, gapKeys, onClose, t }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valid = reason.trim().length >= MIN_REASON_LENGTH

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await acknowledgeAtgCargoGaps(operation.operationId, gapKeys, reason.trim())
      onClose(true)
    } catch (e) {
      setError(e?.message === 'gaps_changed' ? t('atgGapAckChanged') : e?.message || t('atgGapAckFailed'))
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !busy && onClose(false)}>
      <div
        className="modal atg-gap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atg-ack-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="atg-ack-title" className="modal__title">
          {t('atgGapAckTitle', { count: gapKeys.length })}
        </h2>
        <p className="text-steel atg-gap-dialog__op">{operation.operationLabel || operation.vesselName}</p>
        <p className="text-steel">{t('atgGapAckBody')}</p>
        <div className="atg-gap-ack__chips">
          {QUICK_REASON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`atg-gap-chip${reason === t(key) ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => setReason(t(key))}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <label className="modal__label" htmlFor="atg-ack-reason">
          {t('atgGapAckReasonLabel')}
        </label>
        <textarea
          id="atg-ack-reason"
          className="modal__textarea"
          rows={3}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? <p className="admin-ops-error">{error}</p> : null}
        <div className="modal__footer atg-gap-dialog__footer">
          <button type="button" className="btn btn--ghost" onClick={() => onClose(false)} disabled={busy}>
            {t('atgGapCancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!valid || busy}>
            {t('atgGapAckSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}
