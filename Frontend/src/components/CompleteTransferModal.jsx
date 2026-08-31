import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchTankGaugingMassDelta } from '../api/tankGauging'
import { ensureApiEndAfterStart, normalizeForApi } from '../utils/scheduleDateTime'

function formatQty(n, unit = 'MT') {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`
}

/**
 * Confirm segment end time and preview directional moved qty before closing a transfer leg.
 */
export default function CompleteTransferModal({
  open,
  onCancel,
  onConfirm,
  segmentStartLocal,
  defaultEndLocal,
  purpose = 'Loading',
  portId,
  atgTankIds = [],
  commodityType = 'Liquid',
  metricLabel = 'MT',
  scheduleTimezone,
  busy = false,
}) {
  const { t } = useTranslation('pages')
  const unit = metricLabel?.split(' · ')[0] || 'MT'
  const [endLocal, setEndLocal] = useState(defaultEndLocal || '')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!open) return
    setEndLocal(defaultEndLocal || '')
    setPreview(null)
    setPreviewError('')
  }, [open, defaultEndLocal])

  const showAtgPreview =
    commodityType === 'Liquid' && portId != null && portId !== '' && atgTankIds.length > 0

  const endValidationError = useMemo(() => {
    if (!open || !endLocal || !segmentStartLocal) return ''
    try {
      const startIso = normalizeForApi(segmentStartLocal, scheduleTimezone)
      const endIso = normalizeForApi(endLocal, scheduleTimezone)
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        return t('cargoCompleteTransferEndAfterStart')
      }
    } catch {
      return t('cargoCompleteTransferEndInvalid')
    }
    return ''
  }, [open, endLocal, segmentStartLocal, scheduleTimezone, t])

  useEffect(() => {
    if (!open || !showAtgPreview || endValidationError || !endLocal) {
      setPreview(null)
      setPreviewError('')
      return undefined
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError('')
      try {
        const startIso = normalizeForApi(segmentStartLocal, scheduleTimezone)
        const endIso = ensureApiEndAfterStart(
          startIso,
          normalizeForApi(endLocal, scheduleTimezone),
          scheduleTimezone
        )
        const data = await fetchTankGaugingMassDelta({
          portId,
          tankIds: atgTankIds,
          startAt: startIso,
          endAt: endIso,
          purpose,
        })
        if (cancelled) return
        setPreview(data)
        if (data?.incomplete) {
          setPreviewError(t('cargoCompleteTransferPreviewIncomplete'))
        }
      } catch (e) {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(e?.message || t('cargoCompleteTransferPreviewFailed'))
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    open,
    showAtgPreview,
    endValidationError,
    endLocal,
    segmentStartLocal,
    scheduleTimezone,
    portId,
    atgTankIds,
    purpose,
    t,
  ])

  if (!open) return null

  const tankLines =
    Array.isArray(preview?.tanks) && preview.tanks.length
      ? preview.tanks
          .filter((tk) => tk.qtyMoved != null && Number.isFinite(Number(tk.qtyMoved)))
          .map(
            (tk) =>
              `${tk.code || tk.tankId} +${Number(tk.qtyMoved).toLocaleString(undefined, { maximumFractionDigits: 3 })}`
          )
          .join(' · ')
      : ''

  const confirmDisabled = busy || !endLocal || Boolean(endValidationError)

  return (
    <div className="modal-overlay" onClick={onCancel} aria-hidden="true">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-transfer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="complete-transfer-title" className="modal__title">
          {t('cargoCompleteTransferTitle')}
        </h2>
        <p className="text-steel cargo-complete-transfer__hint">{t('cargoCompleteTransferHint')}</p>

        <div className="berthing-modal__field">
          <label className="berthing-modal__label" htmlFor="complete-transfer-end">
            {t('cargoCompleteTransferEndLabel')} <span className="required-star">*</span>
          </label>
          <input
            id="complete-transfer-end"
            type="datetime-local"
            className="berthing-modal__input"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            disabled={busy}
          />
          {endValidationError ? (
            <p className="berthing-modal__error">{endValidationError}</p>
          ) : null}
        </div>

        {showAtgPreview ? (
          <div className="cargo-complete-transfer__preview">
            <span className="cargo-complete-transfer__preview-label">
              {t('cargoCompleteTransferMovedPreview')}
            </span>
            {previewLoading ? (
              <p className="text-steel">{t('cargoCompleteTransferPreviewLoading')}</p>
            ) : (
              <strong>{formatQty(preview?.sumDeltaMass, unit)}</strong>
            )}
            {tankLines ? <p className="text-steel cargo-complete-transfer__tanks">{tankLines}</p> : null}
            {previewError ? <p className="berthing-modal__error">{previewError}</p> : null}
          </div>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="btn btn--soft" onClick={onCancel} disabled={busy}>
            {t('cargoCompleteTransferCancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={confirmDisabled}
            onClick={() => onConfirm(endLocal)}
          >
            {t('cargoCompleteTransferConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
