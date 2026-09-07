import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMasterTanks } from '../api/masterTanks'
import {
  addTankToSoundingSession,
  cancelSoundingSession,
  confirmSoundingManualReading,
  createSoundingSession,
  fetchSoundingSession,
  lockSoundingReading,
  skipAtgSoundingTank,
  unlockSoundingTank,
} from '../api/soundingSessions'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import InteractiveTooltip from './InteractiveTooltip'
import '../styles/sounding-capture.css'

function formatMetric(n, digits = 3) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function toLocalDatetimeInputValue(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function mergeTankReadings(existing, incoming) {
  const byId = new Map((Array.isArray(existing) ? existing : []).map((r) => [Number(r.tankId), r]))
  for (const row of incoming) {
    if (row) byId.set(Number(row.tankId), row)
  }
  return [...byId.values()]
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
  if (!tank?.isComplete || !tank.manualCaptured) return null
  const manual = tank.manualCaptured
  const atg = tank.atgCaptured
  const atgSkipped = Boolean(tank.atgSkipped)
  const timestamps = [tank.soundedAt, manual?.capturedAt, atg?.lockedAt].filter(Boolean)
  const lockedAt =
    timestamps.length > 0
      ? new Date(Math.max(...timestamps.map((ts) => new Date(ts).getTime()))).toISOString()
      : null

  if (atgSkipped || !atg) {
    return {
      tankId: Number(tank.tankId),
      tankCode: tank.tankCode,
      captureMode: 'manual',
      soundedAt: tank.soundedAt,
      atgSkipped: true,
      manual: { ...manual },
      lockedAt,
      atgSourceBaseUrl: tank.sourceBaseUrl,
      sessionId,
    }
  }

  return {
    tankId: Number(tank.tankId),
    tankCode: tank.tankCode,
    captureMode: 'dual',
    soundedAt: tank.soundedAt,
    atgSkipped: false,
    atg: { ...atg },
    manual: { ...manual },
    lockedAt,
    atgSourceBaseUrl: tank.sourceBaseUrl,
    sessionId,
  }
}

function atgSourceLabel(row, t) {
  if (row.captureMode === 'manual' || row.atgSkipped) return t('sounding.atgSourceSkipped')
  if (row.atg?.source === 'sample') return t('sounding.atgSourceSample')
  return t('sounding.atgSourceLive')
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
  onSkipAtg,
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
  const atgSkipped = Boolean(tank.atgSkipped)
  const isHistorical = tank.captureMode === 'historical'
  const isLiveAtg = !atgCaptured && !atgSkipped && !isHistorical && tank.state !== 'error'
  const atgHeading = isHistorical
    ? t('sounding.atgHistorical')
    : atgCaptured?.source === 'sample'
      ? t('sounding.atgSample')
      : t('sounding.atgLive')

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
  const canEnterManual = Boolean(atgCaptured || atgSkipped)

  const historicalReasonKey =
    tank.historicalLookup?.reason === 'outside_tolerance'
      ? 'sounding.historicalOutsideTolerance'
      : 'sounding.historicalNoSample'

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
        {(atgCaptured || manualCaptured || atgSkipped) && !isComplete ? (
          <button
            type="button"
            className="btn btn--small btn--secondary"
            disabled={busy}
            onClick={() => onUnlock(tank.tankId)}
          >
            {t('sounding.resound')}
          </button>
        ) : null}
      </div>

      {tank.soundedAt ? (
        <div className="sounding-tank-card__sounded-at">
          {t('sounding.soundingTime')}: {formatDateTimeDisplay(tank.soundedAt)}
          {isHistorical ? (
            <span className="sounding-tank-card__mode-pill">{t('sounding.modeHistorical')}</span>
          ) : (
            <span className="sounding-tank-card__mode-pill sounding-tank-card__mode-pill--live">
              {t('sounding.modeLive')}
            </span>
          )}
        </div>
      ) : null}

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
            <div className="sounding-tank-card__compare-heading">{atgHeading}</div>
            {atgSkipped ? (
              <span className="sounding-status-badge sounding-status-badge--manual">
                {t('sounding.statusAtgSkipped')}
              </span>
            ) : atgCaptured ? (
              <span className="sounding-status-badge sounding-status-badge--locked">
                {t('sounding.statusCaptured')}
              </span>
            ) : (
              <span className={`sounding-status-badge ${badgeClass(tank.state)}`}>
                {badgeLabel(tank.state, t)}
              </span>
            )}
          </div>

          {atgSkipped ? (
            <p className="sounding-tank-card__compare-hint">{t('sounding.atgSkippedHint')}</p>
          ) : atgCaptured ? (
            <CapturedValues side={atgCaptured} siMetric={siMetric} t={t} />
          ) : isHistorical && tank.historicalLookup && !tank.historicalLookup.found ? (
            <div className="sounding-tank-card__historical-miss" role="status">
              <p>{t(historicalReasonKey)}</p>
              <p className="sounding-tank-card__compare-hint">{t('sounding.historicalSkipHint')}</p>
            </div>
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
                ) : isHistorical ? (
                  t('sounding.historicalLookupHint')
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

          {!atgCaptured && !atgSkipped ? (
            <div className="sounding-tank-card__compare-footer sounding-tank-card__compare-footer--dual">
              {!isHistorical ? (
                <button
                  type="button"
                  className="btn btn--small sounding-btn--accept-atg"
                  disabled={busy || !tank.canCaptureAtg}
                  aria-label={t('sounding.lockAria', { tank: tank.tankCode })}
                  onClick={() => onLock(tank.tankId)}
                >
                  {t('sounding.captureAtg')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--small btn--secondary"
                disabled={busy || !tank.canSkipAtg}
                onClick={() => onSkipAtg(tank.tankId)}
              >
                {t('sounding.skipAtg')}
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
              <p className="sounding-tank-card__compare-hint">
                {canEnterManual
                  ? t('sounding.manualEntryHint')
                  : t('sounding.manualEntryBlockedHint')}
              </p>
              <div className="sounding-tank-card__manual-form">
                {siMetric === 'KL' ? (
                  <div className="sounding-tank-card__manual-field">
                    <label className="sounding-tank-card__manual-label">{t('sounding.volumeKl')}</label>
                    <input
                      type="number"
                      step="any"
                      className="sounding-tank-card__manual-input"
                      value={manualVolume}
                      disabled={!canEnterManual || busy}
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
                      disabled={!canEnterManual || busy}
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
                    disabled={!canEnterManual || busy}
                    onChange={(e) => setManualTemp(e.target.value)}
                  />
                </div>
              </div>
              <div className="sounding-tank-card__compare-footer">
                <button
                  type="button"
                  className="btn btn--small btn--secondary sounding-btn--accept-manual"
                  disabled={busy || !manualReady || !canEnterManual}
                  onClick={handleConfirmManual}
                >
                  {t('sounding.captureManual')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!isComplete && (atgCaptured || atgSkipped) && !manualCaptured ? (
        <p className="sounding-tank-card__pending-hint">{t('sounding.captureManualHint')}</p>
      ) : null}
      {!isComplete && !atgCaptured && !atgSkipped && !manualCaptured ? (
        <p className="sounding-tank-card__pending-hint">{t('sounding.captureAtgOrSkipHint')}</p>
      ) : null}
    </div>
  )
}

function SoundingReadingsTable({ tankReadings, siMetric, t, onResound, readOnly }) {
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
            <th>{t('sounding.soundingTime')}</th>
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
              </>
            )}
            <th>{t('sounding.tableAtgSource')}</th>
            <th>{t('sounding.lockedAt')}</th>
            {!readOnly && onResound ? <th>{t('sounding.tableActions')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {tankReadings.map((row) => (
            <tr key={String(row.tankId)}>
              <td>{row.tankCode || row.tankId}</td>
              <td>{row.soundedAt ? formatDateTimeDisplay(row.soundedAt) : '—'}</td>
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
                    {formatMetric(primaryFromSide(row.manual, siMetric) ?? (siMetric === 'KL' ? row.volumeKl : row.massMt))}
                  </td>
                  <td className="sounding-cell--numeric">
                    {row.manual?.temperatureC != null
                      ? `${formatMetric(row.manual.temperatureC, 1)} °C`
                      : row.temperatureC != null
                        ? `${formatMetric(row.temperatureC, 1)} °C`
                        : '—'}
                  </td>
                </>
              )}
              <td>{atgSourceLabel(row, t)}</td>
              <td>{row.lockedAt ? formatDateTimeDisplay(row.lockedAt) : '—'}</td>
              {!readOnly && onResound ? (
                <td>
                  <button
                    type="button"
                    className="btn btn--small btn--secondary"
                    onClick={() => onResound(row.tankId)}
                  >
                    {t('sounding.resound')}
                  </button>
                </td>
              ) : null}
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
  const [selectedTankId, setSelectedTankId] = useState('')
  const [soundedAtLocal, setSoundedAtLocal] = useState(() => toLocalDatetimeInputValue())
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
  }, [portId])

  const completedTankIds = useMemo(
    () => new Set((tankReadings || []).map((r) => Number(r.tankId))),
    [tankReadings]
  )

  const inSessionTankIds = useMemo(
    () => new Set((session?.tanks || []).map((tk) => Number(tk.tankId))),
    [session?.tanks]
  )

  const availableTankOptions = useMemo(
    () =>
      atgTanks
        .filter((tk) => !completedTankIds.has(Number(tk.id)) && !inSessionTankIds.has(Number(tk.id)))
        .map((tk) => ({
          value: String(tk.id),
          label: tk.name ? `${tk.code} — ${tk.name}` : String(tk.code || tk.id),
        })),
    [atgTanks, completedTankIds, inSessionTankIds]
  )

  const mergeCompletedFromSession = useCallback(
    (sess, currentReadings) => {
      if (!sess || !onTankReadingsChange) return
      const fromSession = (sess.tanks || [])
        .map((tk) => sessionTankToReading(tk, sess.sessionId))
        .filter(Boolean)
      if (fromSession.length) {
        onTankReadingsChange(mergeTankReadings(currentReadings, fromSession))
      }
    },
    [onTankReadingsChange]
  )

  const mergeCompletedFromTankDto = useCallback(
    (tankDto, sid, currentReadings) => {
      if (!tankDto?.isComplete || !onTankReadingsChange) return
      const row = sessionTankToReading(tankDto, sid)
      if (row) onTankReadingsChange(mergeTankReadings(currentReadings, [row]))
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
          mergeCompletedFromSession(data, tankReadings)
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
  }, [sessionId, readOnly, mergeCompletedFromSession, tankReadings])

  useEffect(
    () => () => {
      if (sessionId) {
        cancelSoundingSession(sessionId).catch(() => {})
      }
    },
    [sessionId]
  )

  const applyActionResult = (data, currentReadings) => {
    if (data?.session) setSession(data.session)
    if (data?.tank) mergeCompletedFromTankDto(data.tank, sessionId, currentReadings)
  }

  const handleBeginCapture = async () => {
    if (!operationId || !selectedTankId) return
    const soundedAt = new Date(soundedAtLocal).toISOString()
    if (Number.isNaN(new Date(soundedAtLocal).getTime())) {
      setError(t('sounding.invalidSoundingTime'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      if (sessionId && session?.active) {
        const data = await addTankToSoundingSession(sessionId, {
          tankId: Number(selectedTankId),
          soundedAt,
        })
        applyActionResult(data, tankReadings)
      } else {
        const data = await createSoundingSession(operationId, {
          tankIds: [Number(selectedTankId)],
          siMetric: metric,
          soundedAt,
        })
        setSessionId(data.sessionId)
        setSession(data)
      }
      setSelectedTankId('')
      setSoundedAtLocal(toLocalDatetimeInputValue())
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
    mergeCompletedFromSession(data, tankReadings)
    return data
  }

  const handleLock = async (tankId) => {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const data = await lockSoundingReading(sessionId, tankId)
      applyActionResult(data, tankReadings)
      if (!data?.session) await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.lockFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleSkipAtg = async (tankId) => {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const data = await skipAtgSoundingTank(sessionId, Number(tankId))
      applyActionResult(data, tankReadings)
      if (!data?.session) await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.skipAtgFailed'))
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
      const data = await confirmSoundingManualReading(sessionId, {
        tankId,
        massMt: form.massMt,
        volumeKl: form.volumeKl,
        temperatureC: form.temperatureC,
      })
      applyActionResult(data, tankReadings)
      if (!data?.session) await refreshSession()
    } catch (e) {
      setError(e?.message || t('sounding.manualFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleResoundCompleted = (tankId) => {
    if (!onTankReadingsChange) return
    onTankReadingsChange(
      (tankReadings || []).filter((r) => Number(r.tankId) !== Number(tankId))
    )
  }

  const displayTanks = session?.tanks || []
  const hasInProgress = displayTanks.length > 0

  if (readOnly) {
    return (
      <section className="sounding-capture-panel" aria-label={t('sounding.panelTitle')}>
        <SoundingPanelHeader t={t} />
        <SoundingReadingsTable tankReadings={tankReadings} siMetric={metric} t={t} readOnly />
      </section>
    )
  }

  return (
    <section className="sounding-capture-panel" aria-label={t('sounding.panelTitle')}>
      <SoundingPanelHeader t={t} />

      {error ? <div className="sounding-capture-panel__banner" role="alert">{error}</div> : null}

      {Array.isArray(tankReadings) && tankReadings.length > 0 ? (
        <div className="sounding-capture-panel__completed">
          <h5 className="sounding-capture-panel__section-title">{t('sounding.completedTanks')}</h5>
          <SoundingReadingsTable
            tankReadings={tankReadings}
            siMetric={metric}
            t={t}
            onResound={handleResoundCompleted}
          />
        </div>
      ) : null}

      {hasInProgress ? (
        <>
          <div className="sounding-capture-panel__session-bar">
            <div className="sounding-capture-panel__session-meta">
              <span className="sounding-capture-panel__session-pill sounding-capture-panel__session-pill--live">
                {t('sounding.sessionActive', {
                  seconds: Math.round((session?.pollIntervalMs || 2000) / 1000),
                })}
              </span>
              <span className="sounding-capture-panel__session-pill">
                {t('sounding.progress', {
                  locked: completedTankIds.size,
                  total: completedTankIds.size + displayTanks.length,
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
              onSkipAtg={handleSkipAtg}
              onUnlock={handleUnlock}
              onConfirmManual={handleConfirmManual}
            />
          ))}
        </>
      ) : null}

      {availableTankOptions.length > 0 || loadingTanks ? (
        <div className="sounding-capture-panel__composer">
          <h5 className="sounding-capture-panel__section-title">{t('sounding.addTank')}</h5>
          <div className="sounding-capture-panel__composer-grid">
            <div className="berthing-modal__field">
              <label className="berthing-modal__label" htmlFor="sounding-add-tank">
                {t('sounding.selectTank')}
              </label>
              {loadingTanks ? (
                <p className="sounding-capture-panel__hint">{t('sounding.loadingTanks')}</p>
              ) : (
                <select
                  id="sounding-add-tank"
                  className="sounding-capture-panel__select"
                  value={selectedTankId}
                  onChange={(e) => setSelectedTankId(e.target.value)}
                >
                  <option value="">{t('sounding.tankPlaceholder')}</option>
                  {availableTankOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label" htmlFor="sounding-time">
                {t('sounding.soundingTime')}
                <InteractiveTooltip
                  items={[{ primary: t('sounding.soundingTimeTooltip') }]}
                  maxWidth={300}
                  placement="right"
                >
                  <span
                    className="form-label-with-info__icon sounding-capture-panel__info-icon"
                    aria-label={t('sounding.soundingTimeTooltip')}
                    tabIndex={0}
                    role="img"
                  >
                    ⓘ
                  </span>
                </InteractiveTooltip>
              </label>
              <input
                id="sounding-time"
                type="datetime-local"
                className="sounding-capture-panel__datetime"
                value={soundedAtLocal}
                onChange={(e) => setSoundedAtLocal(e.target.value)}
              />
            </div>
          </div>
          <p className="sounding-capture-panel__hint">{t('sounding.addTankHint')}</p>
          <div className="sounding-capture-panel__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={busy || !selectedTankId || !operationId}
              onClick={handleBeginCapture}
            >
              {t('sounding.beginCapture')}
            </button>
          </div>
        </div>
      ) : !loadingTanks && atgTanks.length === 0 ? (
        <p className="sounding-capture-panel__empty">{t('sounding.noAtgTanks')}</p>
      ) : !loadingTanks && completedTankIds.size >= atgTanks.length ? (
        <p className="sounding-capture-panel__hint">{t('sounding.allTanksComplete')}</p>
      ) : null}
    </section>
  )
}
