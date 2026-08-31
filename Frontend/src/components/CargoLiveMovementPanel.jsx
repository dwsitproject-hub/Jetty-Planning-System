import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import {
  createCargoManualCheckpoint,
  deleteCargoManualCheckpoint,
  fetchCargoManualCheckpoints,
} from '../api/operations'
import { partitionDraftTanks } from '../utils/cargoSessionHelpers'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

function formatQty(n, metricLabel) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const unit = metricLabel ? ` ${metricLabel.split(' · ')[0]}` : ''
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })}${unit}`
}

function ManualCheckpointPanel({
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
    <div className="cargo-ops-session__checkpoint-panel">
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
                {new Date(cp.recordedAt).toLocaleString(undefined, { timeZone: scheduleTimezone || undefined })}{' '}
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
 * Read-only ATG live reference for the open load segment (below segment cards).
 */
export default function CargoLiveMovementPanel({
  openLine,
  atgRef,
  hourlyProgress = null,
  tankMetaById,
  metricLabel,
  purpose,
  scheduleTimezone = 'Asia/Jakarta',
  operationId = null,
  openLoadLineId = null,
}) {
  const { t } = useTranslation('pages')

  const hourlyBuckets = useMemo(
    () => (Array.isArray(hourlyProgress?.hourlyBuckets) ? hourlyProgress.hourlyBuckets : []),
    [hourlyProgress]
  )

  const currentHourBucket = hourlyBuckets.length ? hourlyBuckets[hourlyBuckets.length - 1] : null

  const { atgTankIds, manualTankIds } = useMemo(() => {
    const ids = openLine?.tankIds || []
    return partitionDraftTanks(ids, tankMetaById)
  }, [openLine, tankMetaById])

  const atgOk =
    atgRef?.status === 'ok' &&
    !atgRef.incomplete &&
    atgRef.sumDeltaMass != null &&
    Number.isFinite(Number(atgRef.sumDeltaMass))

  const atgQtyMode = openLine?.atgQtyMode === 'manual' ? 'manual' : 'auto'
  const isAllAtg = atgTankIds.length > 0 && manualTankIds.length === 0
  const hasAtgTanks = atgTankIds.length > 0

  const liveMoved =
    hourlyProgress?.movedQty != null && Number.isFinite(Number(hourlyProgress.movedQty))
      ? Number(hourlyProgress.movedQty)
      : atgOk
        ? Number(atgRef.sumDeltaMass)
        : null

  const showManualCheckpoints =
    openLine &&
    (atgQtyMode === 'manual' ||
      (!hasAtgTanks && manualTankIds.length > 0) ||
      (isAllAtg && !atgOk && atgQtyMode === 'manual'))

  const showLivePanel = openLine && hasAtgTanks && atgQtyMode === 'auto'
  const segmentStartLabel = openLine?.start ? formatDateTimeDisplay(openLine.start) : '—'

  if (!openLine) {
    return (
      <div className="cargo-ops-section cargo-live-movement cargo-live-movement--empty">
        <p className="cargo-ops-section__label">{t('cargoOpsSessionLiveMovement')}</p>
        <p className="text-steel cargo-ops-session__hint">{t('cargoLiveMovementHint')}</p>
      </div>
    )
  }

  if (!showLivePanel && !showManualCheckpoints) {
    return (
      <div className="cargo-ops-section cargo-live-movement cargo-live-movement--empty">
        <p className="cargo-ops-section__label">{t('cargoOpsSessionLiveMovement')}</p>
        <p className="text-steel cargo-ops-session__hint">{t('cargoLiveMovementNoAtgHint')}</p>
      </div>
    )
  }

  return (
    <div className="cargo-ops-section cargo-live-movement">
      {showLivePanel ? (
        <div className="cargo-ops-session__live-panel">
          <p className="cargo-ops-session__live-title">{t('cargoOpsSessionLiveMovement')}</p>
          <p className="text-steel cargo-live-movement__scope">
            {t('cargoLiveMovementScope', { time: segmentStartLabel })}
          </p>
          <div className="cargo-ops-session__live-grid">
            <div>
              <span className="cargo-ops-session__live-label">{t('cargoOpsSessionMovedSoFar')}</span>
              <strong>{formatQty(liveMoved, metricLabel)}</strong>
            </div>
            {currentHourBucket ? (
              <div>
                <span className="cargo-ops-session__live-label">{t('cargoHourlyCurrentHour')}</span>
                <strong>
                  {(Number(currentHourBucket.rateTph) || 0).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{' '}
                  {(metricLabel || 'MT').split(' · ')[0]}/h
                  {currentHourBucket.movementStatus === 'flat_movement' ? (
                    <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--flat cargo-ops-session__flat-badge">
                      {t('cargoHourlyFlatMovement')}
                    </span>
                  ) : null}
                </strong>
              </div>
            ) : null}
            {atgRef?.status === 'loading' ? (
              <p className="text-steel">{t('cargoOpsSessionAtgLoading')}</p>
            ) : null}
          </div>
          {hourlyProgress?.rateSummary?.currentHourLine ? (
            <p className="text-steel cargo-ops-session__hourly-line">
              {hourlyProgress.rateSummary.currentHourLine}
            </p>
          ) : null}
          {Array.isArray(atgRef?.tanks) && atgRef.tanks.length > 0 ? (
            <p className="cargo-ops-session__tank-deltas text-steel">
              {atgRef.tanks
                .map((tk) => {
                  const qty =
                    tk.qtyMoved != null && Number.isFinite(Number(tk.qtyMoved))
                      ? Number(tk.qtyMoved)
                      : tk.deltaMass != null && Number.isFinite(Number(tk.deltaMass))
                        ? Number(tk.deltaMass)
                        : null
                  if (qty == null) return null
                  return `${tk.code || tk.tankId} ${qty >= 0 ? '+' : ''}${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}`
                })
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          {hourlyBuckets.length > 0 ? (
            <HourlyCargoProgressTable
              hourlyBuckets={hourlyBuckets}
              unit={hourlyProgress?.siMetric || metricLabel?.split(' · ')[0] || 'MT'}
              purpose={purpose}
              compact
              collapsible
              collapsedRowLimit={6}
              segmentStartLabel={segmentStartLabel}
            />
          ) : null}
        </div>
      ) : null}

      {showManualCheckpoints ? (
        <ManualCheckpointPanel
          operationId={operationId}
          openLoadLineId={openLoadLineId}
          scheduleTimezone={scheduleTimezone}
          metricLabel={metricLabel}
          disabled={false}
        />
      ) : null}
    </div>
  )
}
