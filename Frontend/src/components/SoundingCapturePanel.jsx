import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMasterTanks } from '../api/masterTanks'
import {
  cancelSoundingSession,
  confirmSoundingManualReading,
  createSoundingSession,
  fetchSoundingSession,
  lockSoundingReading,
  unlockSoundingTank,
} from '../api/soundingSessions'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import DropdownMultiSelect from './DropdownMultiSelect'
import InteractiveTooltip from './InteractiveTooltip'
import '../styles/sounding-capture.css'

function formatMetric(n, digits = 3) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function badgeClass(state) {
  const s = String(state || '').toLowerCase()
  if (s === 'stable') return 'sounding-status-badge--stable'
  if (s === 'fluctuating') return 'sounding-status-badge--fluctuating'
  if (s === 'locked') return 'sounding-status-badge--locked'
  if (s === 'manual') return 'sounding-status-badge--manual'
  if (s === 'error') return 'sounding-status-badge--error'
  return 'sounding-status-badge--calibrating'
}

function badgeLabel(state, t) {
  const s = String(state || '').toLowerCase()
  if (s === 'stable') return t('sounding.statusStable')
  if (s === 'fluctuating') return t('sounding.statusFluctuating')
  if (s === 'locked') return t('sounding.statusLocked')
  if (s === 'manual') return t('sounding.statusManual')
  if (s === 'error') return t('sounding.statusError')
  return t('sounding.statusCalibrating')
}

function primaryFromSide(side, siMetric) {
  if (!side) return null
  return siMetric === 'KL' ? side.volumeKl : side.massMt
}

function sessionTankToReading(tank, sessionId) {
  if (!tank.isComplete || !tank.atgCaptured || !tank.manualCaptured) return null
  const atgLockedAt = tank.atgCaptured.lockedAt
  const manualCapturedAt = tank.manualCaptured.capturedAt
  const lockedAt =
    atgLockedAt && manualCapturedAt
      ? new Date(
          Math.max(new Date(atgLockedAt).getTime(), new Date(manualCapturedAt).getTime())
        ).toISOString()
      : atgLockedAt || manualCapturedAt
  return {
    tankId: Number(tank.tankId),
    tankCode: tank.tankCode,
    captureMode: 'dual',
    measurementBasis: tank.measurementBasis,
    atg: { ...tank.atgCaptured },
    manual: { ...tank.manualCaptured },
    lockedAt,
    atgSourceBaseUrl: tank.sourceBaseUrl,
    sessionId,
  }
}

function CapturedValues({ side, siMetric, t, showTimestamp = true }) {
  const primaryLabel = siMetric === 'KL' ? t('sounding.volumeKl') : t('sounding.massMt')
  const primaryValue = primaryFromSide(side, siMetric)
  const timestamp = side?.lockedAt || side?.capturedAt
  return (
    <>
      <div className="sounding-tank-card__compare-values">
        <div className="sounding-tank-card__compare-value">
          <span className="sounding-tank-card__metric-label">{primaryLabel}</span>
          <span className="sounding-tank-card__metric-value sounding-tank-card__metric-value--captured">
            {formatMetric(primaryValue)}
          </span>
        </div>
        <div className="sounding-tank-card__compare-value">
          <span className="sounding-tank-card__metric-label">{t('sounding.temperature')}</span>
          <span className="sounding-tank-card__metric-value sounding-tank-card__metric-value--captured">
            {side?.temperatureC != null ? `${formatMetric(side.temperatureC, 1)} °C` : '—'}
          </span>
        </div>
      </div>
      {showTimestamp && timestamp ? (
        <div className="sounding-tank-card__details">
          {side?.lockedAt ? t('sounding.lockedAt') : t('sounding.capturedAt')}:{' '}
          {formatDateTimeDisplay(timestamp)}
          {side?.variancePct != null ? (
            <>
              {' · '}
              {t('sounding.variance')}: {side.variancePct}%
            </>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function SoundingPanelHeader({ t }) {
  return (
    <div className="sounding-capture-panel__title-row">
      <h4 className="sounding-capture-panel__title">{t('sounding.panelTitle')}</h4>
      <InteractiveTooltip
        items={[{ primary: t('sounding.panelInfoTooltip') }]}
        maxWidth={320}
        placement="right"
      >
        <span
          className="form-label-with-info__icon sounding-capture-panel__info-icon"
          aria-label={t('sounding.panelInfoTooltip')}
          tabIndex={0}
          role="img"
        >
          ⓘ
        </span>
      </InteractiveTooltip>
    </div>
  )
}

function SoundingTankCard({
  tank,
  siMetric,
  onLock,
  onUnlock,
  onConfirmManual,
  busy,
}) {
  const { t } = useTranslation('loading')
  const primaryLabel = siMetric === 'KL' ? t('sounding.volumeKl') : t('sounding.massMt')
  const primaryValue = siMetric === 'KL' ? tank.volumeKl : tank.massMt
  const isComplete = Boolean(tank.isComplete)
  const atgCaptured = tank.atgCaptured
  const manualCaptured = tank.manualCaptured
  const isLiveAtg = !atgCaptured && tank.state !== 'error'

  const [manualMass, setManualMass] = useState('')
  const [manualVolume, setManualVolume] = useState('')
  const [manualTemp, setManualTemp] = useState('')

  useEffect(() => {
    if (!manualCaptured) return
    if (siMetric === 'KL') {
      setManualVolume(
        manualCaptured.volumeKl != null ? String(manualCaptured.volumeKl) : ''
      )
    } else {
      setManualMass(manualCaptured.massMt != null ? String(manualCaptured.massMt) : '')
    }
    setManualTemp(
      manualCaptured.temperatureC != null ? String(manualCaptured.temperatureC) : ''
    )
  }, [manualCaptured, siMetric])

  const handleConfirmManual = () => {
    const temperatureC = Number(manualTemp)
    if (!Number.isFinite(temperatureC)) return
    if (siMetric === 'KL') {
      const volumeKl = Number(manualVolume)
      if (!Number.isFinite(volumeKl)) return
      onConfirmManual(tank.tankId, { volumeKl, temperatureC })
      return
    }
    const massMt = Number(manualMass)
    if (!Number.isFinite(massMt)) return
    onConfirmManual(tank.tankId, { massMt, temperatureC })
  }

  const manualPrimaryFilled =
    siMetric === 'KL'
      ? manualVolume.trim() !== '' && Number.isFinite(Number(manualVolume))
      : manualMass.trim() !== '' && Number.isFinite(Number(manualMass))
  const manualReady = manualPrimaryFilled && Number.isFinite(Number(manualTemp))

  return (
    <div
      className={`sounding-tank-card${isComplete ? ' sounding-tank-card--locked' : ''}`}
      aria-live="polite"
    >
      <div className="sounding-tank-card__header">
        <div className="sounding-tank-card__title">
          {tank.tankCode}
          {tank.tankName ? ` — ${tank.tankName}` : ''}
        </div>
        {(atgCaptured || manualCaptured) && (
          <button
            type="button"
            className="btn btn--small btn--secondary"
            disabled={busy}
            onClick={() => onUnlock(tank.tankId)}
          >
            {t('sounding.resound')}
          </button>
        )}
      </div>

      {isComplete ? (
        <div className="sounding-tank-card__complete-badge">
          <span className="sounding-status-badge sounding-status-badge--locked">
            {t('sounding.statusComplete')}
          </span>
        </div>
      ) : null}

      <div className="sounding-tank-card__compare">
        <div className="sounding-tank-card__compare-col sounding-tank-card__compare-col--atg">
          <div className="sounding-tank-card__compare-head">
            <div className="sounding-tank-card__compare-heading">{t('sounding.atgLive')}</div>
            {atgCaptured ? (
              <span className="sounding-status-badge sounding-status-badge--locked">
                {t('sounding.statusCaptured')}
              </span>
            ) : (
              <span className={`sounding-status-badge ${badgeClass(tank.state)}`}>
                {badgeLabel(tank.state, t)}
              </span>
            )}
          </div>

          {atgCaptured ? (
            <CapturedValues side={atgCaptured} siMetric={siMetric} t={t} />
          ) : (
            <>
              <div className="sounding-tank-card__compare-values">
                <div className="sounding-tank-card__compare-value">
                  <span className="sounding-tank-card__metric-label">{primaryLabel}</span>
                  <span
                    className={`sounding-tank-card__metric-value${isLiveAtg ? ' sounding-tank-card__metric-value--live' : ''}`}
                  >
                    {formatMetric(primaryValue)}
                  </span>
                </div>
                <div className="sounding-tank-card__compare-value">
                  <span className="sounding-tank-card__metric-label">{t('sounding.temperature')}</span>
                  <span className="sounding-tank-card__metric-value">
                    {tank.temperatureC != null ? `${formatMetric(tank.temperatureC, 1)} °C` : '—'}
                  </span>
                </div>
              </div>
              <div className="sounding-tank-card__details">
                {tank.state === 'error' ? (
                  tank.errorMessage || t('sounding.atgErrorHint')
                ) : (
                  <>
                    <div>
                      {t('sounding.variance')}: {tank.variancePct != null ? `${tank.variancePct}%` : '—'}
                    </div>
                    <div>
                      {t('sounding.stableFor', {
                        current: tank.stableDurationSec ?? 0,
                        required: tank.stableHoldSec ?? 5,
                      })}
                    </div>
                    {tank.lastSampleAt ? (
                      <div>
                        {t('sounding.lastSample')}: {formatDateTimeDisplay(tank.lastSampleAt)}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}

          {!atgCaptured ? (
            <div className="sounding-tank-card__compare-footer">
              <button
                type="button"
                className="btn btn--small sounding-btn--accept-atg"
                disabled={busy || !tank.canCaptureAtg}
                aria-label={t('sounding.lockAria', { tank: tank.tankCode })}
                onClick={() => onLock(tank.tankId)}
              >
                {t('sounding.captureAtg')}
              </button>
            </div>
          ) : null}
        </div>

        <div className="sounding-tank-card__compare-col sounding-tank-card__compare-col--manual">
          <div className="sounding-tank-card__compare-head">
            <div className="sounding-tank-card__compare-heading">{t('sounding.manualEntry')}</div>
            {manualCaptured ? (
              <span className="sounding-status-badge sounding-status-badge--manual">
                {t('sounding.statusCaptured')}
              </span>
            ) : null}
          </div>

          {manualCaptured ? (
            <CapturedValues side={manualCaptured} siMetric={siMetric} t={t} showTimestamp />
          ) : (
            <>
              <p className="sounding-tank-card__compare-hint">{t('sounding.manualEntryHint')}</p>
              <div className="sounding-tank-card__manual-form">
                {siMetric === 'KL' ? (
                  <div className="sounding-tank-card__manual-field">
                    <label className="sounding-tank-card__manual-label">{t('sounding.volumeKl')}</label>
                    <input
                      type="number"
                      step="any"
                      className="sounding-tank-card__manual-input"
                      value={manualVolume}
                      onChange={(e) => setManualVolume(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="sounding-tank-card__manual-field">
                    <label className="sounding-tank-card__manual-label">{t('sounding.massMt')}</label>
                    <input
                      type="number"
                      step="any"
                      className="sounding-tank-card__manual-input"
                      value={manualMass}
                      onChange={(e) => setManualMass(e.target.value)}
                    />
                  </div>
                )}
                <div className="sounding-tank-card__manual-field">
                  <label className="sounding-tank-card__manual-label">{t('sounding.temperature')}</label>
                  <input
                    type="number"
                    step="any"
                    className="sounding-tank-card__manual-input"
                    value={manualTemp}
                    onChange={(e) => setManualTemp(e.target.value)}
                  />
                </div>
              </div>
              <div className="sounding-tank-card__compare-footer">
                <button
                  type="button"
                  className="btn btn--small btn--secondary sounding-btn--accept-manual"
                  disabled={busy || !manualReady}
                  onClick={handleConfirmManual}
                >
                  {t('sounding.captureManual')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!isComplete && (atgCaptured || manualCaptured) ? (
        <p className="sounding-tank-card__pending-hint">
          {t('sounding.captureBothHint')}
        </p>
      ) : null}
    </div>
  )
}

function SoundingReadingsTable({ tankReadings, siMetric, t }) {
  const primaryHeader = siMetric === 'KL' ? t('sounding.volumeKl') : t('sounding.massMt')
  if (!Array.isArray(tankReadings) || tankReadings.length === 0) {
    return <p className="sounding-capture-panel__empty">{t('sounding.noReadings')}</p>
  }
  const hasDual = tankReadings.some((row) => row.captureMode === 'dual')
  return (
    <div className="sounding-capture-panel__table-wrap">
      <table className="sounding-capture-panel__table">
        <thead>
          <tr>
            <th>{t('sounding.tableTank')}</th>
            {hasDual ? (
              <>
                <th>{t('sounding.tableAtg')} {primaryHeader}</th>
                <th>{t('sounding.tableManual')} {primaryHeader}</th>
                <th>{t('sounding.tableAtg')} {t('sounding.temperature')}</th>
                <th>{t('sounding.tableManual')} {t('sounding.temperature')}</th>
              </>
            ) : (
              <>
                <th>{primaryHeader}</th>
                <th>{t('sounding.temperature')}</th>
                <th>{t('sounding.tableMode')}</th>
              </>
            )}
            <th>{t('sounding.lockedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {tankReadings.map((row) => (
            <tr key={String(row.tankId)}>
              <td>{row.tankCode || row.tankId}</td>
              {row.captureMode === 'dual' ? (
                <>
                  <td className="sounding-cell--numeric">
                    {formatMetric(primaryFromSide(row.atg, siMetric))}
                  </td>
                  <td className="sounding-cell--numeric">
                    {formatMetric(primaryFromSide(row.manual, siMetric))}
                  </td>
                  <td className="sounding-cell--numeric">
                    {row.atg?.temperatureC != null
                      ? `${formatMetric(row.atg.temperatureC, 1)} °C`
                      : '—'}
                  </td>
                  <td className="sounding-cell--numeric">
                    {row.manual?.temperatureC != null
                      ? `${formatMetric(row.manual.temperatureC, 1)} °C`
                      : '—'}
                  </td>
                </>
              ) : (
                <>
                  <td className="sounding-cell--numeric">
                    {formatMetric(siMetric === 'KL' ? row.volumeKl : row.massMt)}
                  </td>
                  <td className="sounding-cell--numeric">
                    {row.temperatureC != null ? `${formatMetric(row.temperatureC, 1)} °C` : '—'}
                  </td>
                  <td>
                    {row.captureMode === 'manual' ? t('sounding.modeManual') : t('sounding.modeAtg')}
                  </td>
                </>
              )}
              <td>{row.lockedAt ? formatDateTimeDisplay(row.lockedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SoundingCapturePanel({
  operationId,
  portId,
  siMetric = 'MT',
  readOnly = false,
  tankReadings = [],
  onTankReadingsChange,
  onSessionActiveChange,
}) {
  const { t } = useTranslation('loading')
  const [atgTanks, setAtgTanks] = useState([])
  const [selectedTankIds, setSelectedTankIds] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [session, setSession] = useState(null)
  const [loadingTanks, setLoadingTanks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const metric = String(siMetric || 'MT').toUpperCase()

  useEffect(() => {
    if (!portId) {
      setAtgTanks([])
      return undefined
    }
    let cancelled = false
    setLoadingTanks(true)
    fetchMasterTanks(portId)
      .then((list) => {
        if (cancelled) return
        const rows = (Array.isArray(list) ? list : []).filter((tk) => tk.hasAtg)
        setAtgTanks(rows)
        if (Array.isArray(tankReadings) && tankReadings.length) {
          setSelectedTankIds(tankReadings.map((r) => String(r.tankId)))
        }
      })
      .catch(() => {
        if (!cancelled) setAtgTanks([])
      })
      .finally(() => {
        if (!cancelled) setLoadingTanks(false)
      })
    return () => {
      cancelled = true
    }
  }, [portId, tankReadings])

  const syncReadingsFromSession = useCallback(
    (sess) => {
      if (!sess || !onTankReadingsChange) return
      const readings = (sess.tanks || [])
        .map((tk) => sessionTankToReading(tk, sess.sessionId))
        .filter(Boolean)
      onTankReadingsChange(readings)
    },
    [onTankReadingsChange]
  )

  useEffect(() => {
    onSessionActiveChange?.(Boolean(sessionId && session?.active))
  }, [sessionId, session?.active, onSessionActiveChange])

  useEffect(() => {
    if (!sessionId || readOnly) return undefined
    let cancelled = false
    const poll = () => {
      fetchSoundingSession(sessionId)
        .then((data) => {
          if (cancelled) return
          setSession(data)
          syncReadingsFromSession(data)
        })
        .catch(() => {
          if (!cancelled) setSession(null)
        })
    }
    poll()
    const timer = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, readOnly, syncReadingsFromSession])

  useEffect(
    () => () => {
      if (sessionId) {
        cancelSoundingSession(sessionId).catch(() => {})
      }
    },
    [sessionId]
  )

  const tankOptions = useMemo(
    () =>
      atgTanks.map((tk) => ({
        value: String(tk.id),
        label: tk.name ? `${tk.code} — ${tk.name}` : String(tk.code || tk.id),
      })),
    [atgTanks]
  )

  const handleStartSession = async () => {
    if (!operationId || !selectedTankIds.length) return
    setError(null)
    setBusy(true)
    try {
      const data = await createSoundingSession(operationId, {
        tankIds: selectedTankIds.map(Number),
        siMetric: metric,
      })
      setSessionId(data.sessionId)
      setSession(data)
    } catch (e) {
      setError(e?.message || t('sounding.startFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleCancelSession = async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      await cancelSoundingSession(sessionId)
      setSessionId(null)
      setSession(null)
    } catch (e) {
      setError(e?.message || t('sounding.cancelFailed'))
    } finally {
      setBusy(false)
    }
  }

  const refreshSession = async (id = sessionId) => {
    if (!id) return null
    const data = await fetchSoundingSession(id)
    setSession(data)
    syncReadingsFromSession(data)
    return data
  }

  const handleLock = async (tankId) => {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      await lockSoundingReading(sessionId, tankId)
      await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.lockFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleUnlock = async (tankId) => {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      await unlockSoundingTank(sessionId, tankId)
      await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.unlockFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmManual = async (tankId, form) => {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      await confirmSoundingManualReading(sessionId, {
        tankId,
        massMt: form.massMt,
        volumeKl: form.volumeKl,
        temperatureC: form.temperatureC,
      })
      await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.manualFailed'))
    } finally {
      setBusy(false)
    }
  }

  const sessionActive = Boolean(sessionId && session?.active)
  const displayTanks = session?.tanks || []

  const selectedLabels = useMemo(() => {
    const byId = new Map(atgTanks.map((tk) => [String(tk.id), tk]))
    return selectedTankIds.map((id) => byId.get(String(id))?.code || id).join(', ')
  }, [atgTanks, selectedTankIds])

  if (readOnly) {
    return (
      <section className="sounding-capture-panel" aria-label={t('sounding.panelTitle')}>
        <SoundingPanelHeader t={t} />
        <SoundingReadingsTable tankReadings={tankReadings} siMetric={metric} t={t} />
      </section>
    )
  }

  return (
    <section className="sounding-capture-panel" aria-label={t('sounding.panelTitle')}>
      <SoundingPanelHeader t={t} />

      {error ? <div className="sounding-capture-panel__banner" role="alert">{error}</div> : null}

      {!sessionActive ? (
        <>
          <div className="berthing-modal__field sounding-capture-panel__tanks-field">
            <label className="berthing-modal__label" htmlFor="sounding-tank-select">
              {t('sounding.selectTanks')}
            </label>
            {loadingTanks ? (
              <p className="sounding-capture-panel__hint">{t('sounding.loadingTanks')}</p>
            ) : atgTanks.length === 0 ? (
              <p className="sounding-capture-panel__empty">{t('sounding.noAtgTanks')}</p>
            ) : (
              <DropdownMultiSelect
                id="sounding-tank-select"
                options={tankOptions}
                selectedValues={selectedTankIds}
                onChange={setSelectedTankIds}
                placeholder={t('sounding.tanksPlaceholder')}
                emptyText={t('sounding.noAtgTanks')}
                searchable
                searchPlaceholder={t('sounding.tanksSearchPlaceholder')}
                className="cargo-ops-tanks-dropdown sounding-capture-panel__tanks-dropdown"
              />
            )}
            <p className="sounding-capture-panel__hint">{t('sounding.selectHint')}</p>
          </div>
          {Array.isArray(tankReadings) && tankReadings.length > 0 ? (
            <SoundingReadingsTable tankReadings={tankReadings} siMetric={metric} t={t} />
          ) : null}
          <div className="sounding-capture-panel__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={busy || !selectedTankIds.length || !operationId}
              onClick={handleStartSession}
            >
              {t('sounding.startSession')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sounding-capture-panel__session-bar">
            <div className="sounding-capture-panel__session-meta">
              <span className="sounding-capture-panel__session-pill sounding-capture-panel__session-pill--live">
                {t('sounding.sessionActive', { seconds: Math.round((session?.pollIntervalMs || 2000) / 1000) })}
              </span>
              <span className="sounding-capture-panel__session-pill">
                {t('sounding.sessionTanks', { tanks: selectedLabels })}
              </span>
              <span className="sounding-capture-panel__session-pill">
                {t('sounding.progress', {
                  locked: session?.lockedCount ?? 0,
                  total: session?.totalTanks ?? displayTanks.length,
                })}
              </span>
            </div>
            <button
              type="button"
              className="btn btn--small btn--secondary"
              disabled={busy}
              onClick={handleCancelSession}
            >
              {t('sounding.cancelSession')}
            </button>
          </div>
          {session?.consecutiveErrors >= 3 ? (
            <div className="sounding-capture-panel__banner" role="alert">
              {t('sounding.sessionErrorBanner')}
            </div>
          ) : null}
          {displayTanks.map((tk) => (
            <SoundingTankCard
              key={tk.tankId}
              tank={tk}
              siMetric={metric}
              busy={busy}
              onLock={handleLock}
              onUnlock={handleUnlock}
              onConfirmManual={handleConfirmManual}
            />
          ))}
        </>
      )}
    </section>
  )
}
