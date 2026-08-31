import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DropdownMultiSelect from './DropdownMultiSelect'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import {
  createCargoManualCheckpoint,
  deleteCargoManualCheckpoint,
  fetchCargoManualCheckpoints,
} from '../api/operations'
import { formatTankStatusList, partitionDraftTanks } from '../utils/cargoSessionHelpers'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

function formatQty(n, metricLabel) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const unit = metricLabel ? ` ${metricLabel.split(' · ')[0]}` : ''
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })}${unit}`
}

function formatTimeLocal(localStr) {
  if (!localStr) return '—'
  const [, time] = String(localStr).split('T')
  return time ? time.slice(0, 5) : localStr
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

export default function CargoOpsSessionPanel({
  phase,
  purpose,
  operationId = null,
  openLoadLineId = null,
  scheduleTimezone = 'Asia/Jakarta',
  sessionTankIds,
  onSessionTankIdsChange,
  openLine,
  openLineKey,
  atgRef,
  hourlyProgress = null,
  tankMetaById,
  masterTankOptions,
  metricLabel,
  lastClosedLine,
  closedSegmentCount,
  balanceRemaining,
  busy,
  onStartTransfer,
  onCompleteTransfer,
  onStartNextSegment,
  onAdjustTimestamps,
  onUpdateOpenLine,
  onUpdateOpenSegmentTanks,
}) {
  const { t } = useTranslation('pages')

  const hourlyBuckets = useMemo(
    () => (Array.isArray(hourlyProgress?.hourlyBuckets) ? hourlyProgress.hourlyBuckets : []),
    [hourlyProgress]
  )

  const currentHourBucket = hourlyBuckets.length ? hourlyBuckets[hourlyBuckets.length - 1] : null

  const tankStatus = useMemo(
    () => formatTankStatusList(sessionTankIds, tankMetaById, masterTankOptions),
    [sessionTankIds, tankMetaById, masterTankOptions]
  )

  const openTanks = useMemo(() => {
    if (!openLine) return []
    return formatTankStatusList(openLine.tankIds, tankMetaById, masterTankOptions)
  }, [openLine, tankMetaById, masterTankOptions])

  const { atgTankIds, manualTankIds } = useMemo(() => {
    const ids = openLine?.tankIds || sessionTankIds || []
    return partitionDraftTanks(ids, tankMetaById)
  }, [openLine, sessionTankIds, tankMetaById])

  const atgOk =
    atgRef?.status === 'ok' &&
    !atgRef.incomplete &&
    atgRef.sumDeltaMass != null &&
    Number.isFinite(Number(atgRef.sumDeltaMass))

  const atgQtyMode = openLine?.atgQtyMode === 'manual' ? 'manual' : 'auto'
  const isMixed = atgTankIds.length > 0 && manualTankIds.length > 0
  const isAllAtg = atgTankIds.length > 0 && manualTankIds.length === 0
  const hasAtgTanks = atgTankIds.length > 0
  const manualToggleLocked = atgOk && !openLine?.loadedManual
  const liveMoved =
    hourlyProgress?.movedQty != null && Number.isFinite(Number(hourlyProgress.movedQty))
      ? Number(hourlyProgress.movedQty)
      : atgOk
        ? Number(atgRef.sumDeltaMass)
        : null
  const manualQtyVal = openLine?.manualQty || ''
  const totalMoved =
    liveMoved != null && isMixed
      ? liveMoved + (Number(manualQtyVal) > 0 ? Number(manualQtyVal) : 0)
      : liveMoved

  const showManualCheckpoints =
    atgQtyMode === 'manual' || (!hasAtgTanks && manualTankIds.length > 0) || (isAllAtg && !atgOk && atgQtyMode === 'manual')

  if (phase === 'setup') {
    const allAtg = tankStatus.length > 0 && tankStatus.every((tk) => tk.hasAtg)
    const anyManual = tankStatus.some((tk) => !tk.hasAtg)
    return (
      <div className="cargo-ops-section cargo-ops-session">
        <p className="cargo-ops-section__label">
          {purpose === 'Unloading' ? t('cargoOpsSourceTanks') : t('cargoOpsDestinationTanks')}{' '}
          <span className="required-star">*</span>
        </p>
        <DropdownMultiSelect
          id="op-cargo-session-tanks"
          options={masterTankOptions}
          selectedValues={sessionTankIds}
          onChange={onSessionTankIdsChange}
          placeholder={t('cargoOpsTanksPlaceholder')}
          emptyText={t('cargoOpsTanksEmpty')}
          searchable
          searchPlaceholder="Search..."
          className="cargo-ops-tanks-dropdown"
        />
        {tankStatus.length > 0 ? (
          <div className="cargo-ops-session__tank-status">
            <p className="cargo-ops-session__tank-status-title">{t('cargoOpsSessionTankStatus')}</p>
            <ul className="cargo-ops-session__tank-list">
              {tankStatus.map((tk) => (
                <li key={tk.id} className={tk.hasAtg ? 'cargo-ops-session__tank--atg' : ''}>
                  {tk.hasAtg ? '✓' : '○'} {tk.label}
                  {tk.hasAtg ? ` · ${t('cargoOpsSessionAtgConnected')}` : ` · ${t('cargoOpsSessionManualExpected')}`}
                </li>
              ))}
            </ul>
            {allAtg ? (
              <p className="text-steel cargo-ops-session__hint">{t('cargoOpsSessionAllAtgHint')}</p>
            ) : anyManual ? (
              <p className="text-steel cargo-ops-session__hint">{t('cargoOpsSessionMixedHint')}</p>
            ) : null}
          </div>
        ) : null}
        <div className="cargo-ops-session__actions">
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={busy || sessionTankIds.length === 0}
            onClick={onStartTransfer}
          >
            {closedSegmentCount > 0 ? t('cargoOpsSessionStartNextSegment') : t('cargoOpsSessionStartTransfer')}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'in_progress' && openLine) {
    const tankLabels = openTanks.map((tk) => tk.label.split(' · ')[0]).join(', ')
    const segmentStartLabel = openLine.start ? formatDateTimeDisplay(openLine.start) : '—'
    const editTankIds = (openLine.tankIds || sessionTankIds || []).map(String)
    return (
      <div className="cargo-ops-section cargo-ops-session cargo-ops-session--active">
        <div className="cargo-ops-session__head">
          <span className="cargo-ops-session__badge">{t('cargoOpsSessionInProgress')}</span>
          <span className="text-steel">
            {t('cargoOpsSessionStartedAtFull', { time: segmentStartLabel })}
            {tankLabels ? ` · ${tankLabels}` : ''}
          </span>
          {hasAtgTanks && atgQtyMode === 'auto' ? (
            <span className="cargo-ops-session__live-dot" title={t('cargoOpsSessionLiveAtg')}>
              ● {t('cargoOpsSessionLiveAtg')}
            </span>
          ) : null}
        </div>

        {onUpdateOpenSegmentTanks ? (
          <div className="cargo-ops-session__tank-edit">
            <p className="cargo-ops-section__label">
              {purpose === 'Unloading' ? t('cargoOpsSourceTanks') : t('cargoOpsDestinationTanks')}
            </p>
            <DropdownMultiSelect
              id="op-cargo-session-tanks-in-progress"
              options={masterTankOptions}
              selectedValues={editTankIds}
              onChange={(ids) => onUpdateOpenSegmentTanks(ids)}
              placeholder={t('cargoOpsTanksPlaceholder')}
              emptyText={t('cargoOpsTanksEmpty')}
              searchable
              searchPlaceholder="Search..."
              className="cargo-ops-tanks-dropdown"
              disabled={busy}
            />
          </div>
        ) : null}

        {hasAtgTanks && atgQtyMode === 'auto' ? (
          <div className="cargo-ops-session__live-panel">
            <p className="cargo-ops-session__live-title">{t('cargoOpsSessionLiveMovement')}</p>
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
                  .filter((tk) => tk.deltaMass != null)
                  .map(
                    (tk) =>
                      `${tk.code || tk.tankId} ${Number(tk.deltaMass) >= 0 ? '+' : ''}${Number(tk.deltaMass).toLocaleString(undefined, { maximumFractionDigits: 3 })}`
                  )
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

        {(isMixed || (manualTankIds.length > 0 && !hasAtgTanks)) && onUpdateOpenLine ? (
          <div className="cargo-ops-session__manual-panel">
            <p className="cargo-ops-session__live-title">{t('cargoOpsSessionManualTanks')}</p>
            {manualTankIds.map((id) => {
              const tk = tankMetaById?.get(String(id))
              const label = tk ? (tk.name ? `${tk.code} — ${tk.name}` : tk.code) : id
              return (
                <div key={id} className="berthing-modal__field">
                  <label className="berthing-modal__label" htmlFor={`op-session-manual-${id}`}>
                    {label} — {t('cargoOpsManualQty')} <span className="required-star">*</span>
                  </label>
                  <input
                    id={`op-session-manual-${id}`}
                    type="text"
                    inputMode="decimal"
                    className="berthing-modal__input"
                    value={manualQtyVal}
                    onChange={(e) =>
                      onUpdateOpenLine(openLineKey, { manualQty: e.target.value, qtyTouched: false })
                    }
                    placeholder={t('cargoOpsQtyPlaceholder')}
                    autoComplete="off"
                  />
                </div>
              )
            })}
            {hasAtgTanks ? (
              <label className="cargo-line-card__atg-mode" htmlFor={`op-session-atg-manual-${openLineKey}`}>
                <input
                  id={`op-session-atg-manual-${openLineKey}`}
                  type="checkbox"
                  checked={atgQtyMode === 'manual'}
                  disabled={manualToggleLocked}
                  onChange={(e) =>
                    onUpdateOpenLine(openLineKey, {
                      atgQtyMode: e.target.checked ? 'manual' : 'auto',
                      qtyTouched: e.target.checked,
                    })
                  }
                />
                <span className="text-steel">{t('cargoOpsAtgNotAvailable')}</span>
              </label>
            ) : null}
            {totalMoved != null && isMixed ? (
              <p className="text-steel">{t('cargoOpsSessionTotalMoved', { total: formatQty(totalMoved, metricLabel) })}</p>
            ) : null}
          </div>
        ) : null}

        {isAllAtg && atgQtyMode === 'auto' && !atgOk && atgRef?.status !== 'loading' ? (
          <div className="cargo-ops-session__manual-panel">
            <p className="operational-form-warning">{t('cargoOpsAtgUnavailableHint')}</p>
            {onUpdateOpenLine ? (
              <>
                <label className="cargo-line-card__atg-mode" htmlFor={`op-session-atg-manual-all-${openLineKey}`}>
                  <input
                    id={`op-session-atg-manual-all-${openLineKey}`}
                    type="checkbox"
                    checked={atgQtyMode === 'manual'}
                    disabled={manualToggleLocked}
                    onChange={(e) =>
                      onUpdateOpenLine(openLineKey, {
                        atgQtyMode: e.target.checked ? 'manual' : 'auto',
                        qtyTouched: e.target.checked,
                      })
                    }
                  />
                  <span className="text-steel">{t('cargoOpsAtgNotAvailable')}</span>
                </label>
                {atgQtyMode === 'manual' ? (
                  <div className="berthing-modal__field">
                    <label className="berthing-modal__label" htmlFor={`op-session-qty-${openLineKey}`}>
                      {purpose === 'Unloading' ? t('cargoOpsQtyUnload') : t('cargoOpsQtyLoad')}{' '}
                      <span className="required-star">*</span>
                    </label>
                    <input
                      id={`op-session-qty-${openLineKey}`}
                      type="text"
                      inputMode="decimal"
                      className="berthing-modal__input"
                      value={openLine.qty || ''}
                      onChange={(e) => onUpdateOpenLine(openLineKey, { qty: e.target.value, qtyTouched: true })}
                      placeholder={t('cargoOpsQtyPlaceholder')}
                      autoComplete="off"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {showManualCheckpoints ? (
          <ManualCheckpointPanel
            operationId={operationId}
            openLoadLineId={openLoadLineId}
            scheduleTimezone={scheduleTimezone}
            metricLabel={metricLabel}
            disabled={busy}
          />
        ) : null}

        <div className="cargo-ops-session__actions cargo-ops-session__actions--split">
          <button type="button" className="btn btn--small btn--soft" disabled={busy} onClick={onAdjustTimestamps}>
            {t('cargoOpsSessionAdjustTimestamps')}
          </button>
          <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={onCompleteTransfer}>
            {t('cargoOpsSessionCompleteTransfer')}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'segment_done' && lastClosedLine) {
    return (
      <div className="cargo-ops-section cargo-ops-session cargo-ops-session--done">
        <p className="cargo-ops-session__done-summary">
          {t('cargoOpsSessionSegmentDone', {
            n: closedSegmentCount,
            start: formatTimeLocal(lastClosedLine.start),
            end: formatTimeLocal(lastClosedLine.end),
            qty: formatQty(parseFloat(String(lastClosedLine.qty).replace(',', '.')), metricLabel),
          })}
        </p>
        {balanceRemaining != null && Number.isFinite(balanceRemaining) ? (
          <p className="text-steel">
            {balanceRemaining > 1e-6
              ? t('cargoOpsSessionBalanceRemaining', {
                  qty: formatQty(balanceRemaining, metricLabel),
                })
              : t('cargoOpsSessionBalanceComplete')}
          </p>
        ) : null}
        <div className="cargo-ops-session__actions cargo-ops-session__actions--split">
          <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={onStartNextSegment}>
            {t('cargoOpsSessionStartNextSegment')}
          </button>
        </div>
      </div>
    )
  }

  return null
}
