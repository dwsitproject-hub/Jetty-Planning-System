import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import {
  createCargoManualCheckpoint,
  deleteCargoManualCheckpoint,
  fetchCargoManualCheckpoints,
} from '../api/operations'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

function formatQty(n, metricLabel) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const unit = metricLabel ? ` ${metricLabel.split(' · ')[0]}` : ''
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })}${unit}`
}

export function ManualCheckpointPanel({
  operationId,
  openLoadLineId,
  scheduleTimezone,
  metricLabel,
  disabled,
}) {
  const { t } = useTranslation('pages')
  const [checkpoints, setCheckpoints] = useState([])
  const [recordedAt, setRecordedAt] = useState('')
  const [cumulativeQty, setCumulativeQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadCheckpoints = useCallback(() => {
    if (!operationId || !openLoadLineId) {
      setCheckpoints([])
      return
    }
    fetchCargoManualCheckpoints(operationId, openLoadLineId)
      .then((res) => setCheckpoints(Array.isArray(res?.checkpoints) ? res.checkpoints : []))
      .catch(() => setCheckpoints([]))
  }, [operationId, openLoadLineId])

  useEffect(() => {
    loadCheckpoints()
  }, [loadCheckpoints])

  const handleAdd = async () => {
    if (!operationId || !openLoadLineId) return
    const qty = Number(cumulativeQty)
    if (!Number.isFinite(qty) || qty < 0) {
      setError(t('cargoManualCheckpointQtyRequired'))
      return
    }
    if (!recordedAt) {
      setError(t('cargoManualCheckpointTimeRequired'))
      return
    }
    setError('')
    setBusy(true)
    try {
      await createCargoManualCheckpoint(operationId, {
        loadLineId: openLoadLineId,
        recordedAt,
        cumulativeQty: qty,
      })
      setCumulativeQty('')
      loadCheckpoints()
    } catch (e) {
      setError(e?.message || t('cargoManualCheckpointSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (checkpointId) => {
    if (!operationId || !checkpointId) return
    setBusy(true)
    try {
      await deleteCargoManualCheckpoint(operationId, checkpointId)
      loadCheckpoints()
    } catch {
      setError(t('cargoManualCheckpointSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!openLoadLineId) return null

  return (
    <div className="cargo-ops-session__checkpoint-panel cargo-entry-hourly__manual">
      <p className="cargo-ops-session__live-title">{t('cargoManualCheckpointTitle')}</p>
      <div className="cargo-ops-session__checkpoint-form">
        <div className="berthing-modal__field">
          <label className="berthing-modal__label" htmlFor="cargo-manual-cp-time">
            {t('cargoManualCheckpointTime')}
          </label>
          <input
            id="cargo-manual-cp-time"
            type="datetime-local"
            className="berthing-modal__input"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            disabled={disabled || busy}
          />
        </div>
        <div className="berthing-modal__field">
          <label className="berthing-modal__label" htmlFor="cargo-manual-cp-qty">
            {t('cargoManualCheckpointCumulativeQty')}
          </label>
          <input
            id="cargo-manual-cp-qty"
            type="text"
            inputMode="decimal"
            className="berthing-modal__input"
            value={cumulativeQty}
            onChange={(e) => setCumulativeQty(e.target.value)}
            placeholder={t('cargoOpsQtyPlaceholder')}
            disabled={disabled || busy}
          />
        </div>
        <button
          type="button"
          className="btn btn--small btn--primary"
          disabled={disabled || busy}
          onClick={handleAdd}
        >
          {t('cargoManualCheckpointAdd')}
        </button>
      </div>
      {error ? <p className="operational-form-warning">{error}</p> : null}
      {checkpoints.length > 0 ? (
        <ul className="cargo-ops-session__checkpoint-list">
          {checkpoints.map((cp) => (
            <li key={cp.id}>
              <span>
                {new Date(cp.recordedAt).toLocaleString(undefined, {
                  timeZone: scheduleTimezone || undefined,
                })}{' '}
                · {formatQty(cp.cumulativeQty, metricLabel)}
              </span>
              <button
                type="button"
                className="btn btn--small btn--soft"
                disabled={disabled || busy}
                onClick={() => handleDelete(cp.id)}
              >
                {t('cargoManualCheckpointDelete')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-steel">{t('cargoManualCheckpointEmpty')}</p>
      )}
    </div>
  )
}

/**
 * Per-entry hourly transfer rates (scoped to segment start/end + tanks).
 */
export default function CargoEntryHourlyPanel({
  segmentStart,
  segmentEnd,
  hourlyData = null,
  hourlyLoading = false,
  purpose,
  metricLabel,
  showAtgHourly = true,
  showManualCheckpoints = false,
  operationId = null,
  openLoadLineId = null,
  scheduleTimezone = 'Asia/Jakarta',
}) {
  const { t } = useTranslation('pages')

  const unit = metricLabel?.split(' · ')[0] || 'MT'
  const hourlyBuckets = hourlyData?.hourlyBuckets || []
  const rateSummary = hourlyData?.rateSummary || {}
  const movedQty = hourlyData?.movedQty
  const segmentStartLabel = segmentStart ? formatDateTimeDisplay(segmentStart) : '—'
  const segmentEndLabel = segmentEnd ? formatDateTimeDisplay(segmentEnd) : null
  const windowLabel = segmentEndLabel
    ? t('cargoEntryHourlyWindowClosed', { start: segmentStartLabel, end: segmentEndLabel })
    : t('cargoEntryHourlyWindowOpen', { start: segmentStartLabel })

  if (showManualCheckpoints) {
    return (
      <ManualCheckpointPanel
        operationId={operationId}
        openLoadLineId={openLoadLineId}
        scheduleTimezone={scheduleTimezone}
        metricLabel={metricLabel}
        disabled={false}
      />
    )
  }

  if (!showAtgHourly) return null

  return (
    <div className="cargo-entry-hourly">
      <p className="cargo-entry-hourly__title">{t('cargoHourlyTableTitle')}</p>
      <p className="text-steel cargo-entry-hourly__scope">{windowLabel}</p>
      {hourlyLoading && hourlyBuckets.length === 0 ? (
        <p className="text-steel cargo-entry-hourly__hint">{t('cargoEntryHourlyLoading')}</p>
      ) : null}
      {hourlyData?.error ? (
        <p className="operational-form-warning">{hourlyData.error}</p>
      ) : null}
      {!hourlyLoading && hourlyBuckets.length === 0 && !hourlyData?.error ? (
        <p className="text-steel cargo-entry-hourly__hint">{t('cargoEntryHourlyEmpty')}</p>
      ) : null}
      {movedQty != null && Number.isFinite(Number(movedQty)) ? (
        <p className="text-steel cargo-entry-hourly__summary">
          {t('cargoOpsSessionMovedSoFar')}: <strong>{formatQty(movedQty, metricLabel)}</strong>
        </p>
      ) : null}
      {rateSummary.currentHourLine ? (
        <p className="text-steel cargo-ops-session__hourly-line">{rateSummary.currentHourLine}</p>
      ) : null}
      {hourlyBuckets.length > 0 ? (
        <HourlyCargoProgressTable
          hourlyBuckets={hourlyBuckets}
          unit={unit}
          purpose={purpose}
          compact
          collapsible
          collapsedRowLimit={6}
          segmentStartLabel={segmentStartLabel}
          currentHourLine={rateSummary.currentHourLine ?? null}
        />
      ) : null}
    </div>
  )
}
