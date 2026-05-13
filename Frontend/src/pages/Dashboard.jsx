import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { dashboardWeather } from '../data/mockData'
import { fetchAtBerth, fetchOperations } from '../api/operations'
import { fetchShippingInstructions } from '../api/shippingInstructions'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchJetties } from '../api/jetties'
import { fetchActivityLogs } from '../api/activityLogs'
import { useTranslation } from 'react-i18next'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import { formatDateTimeDisplay, getAppLocaleTag } from '../utils/formatDateTimeDisplay'
import {
  allocationQueueVesselCallKey,
  isPlannedBerthingQueueRow,
} from '../utils/dashboardQueueClassification'
import { atBerthExecutionOpenPath } from '../utils/atBerthOpenPath'
import DashboardActivityChart from '../components/DashboardActivityChart'
import InteractiveTooltip from '../components/InteractiveTooltip'
import '../styles/dashboard.css'
import '../styles/allocation.css'

/** "At berth now" compact cards — sign-off phases are under Clearance, not here. */
const AT_BERTH_SUMMARY_PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = {
  'Pre-Checking': '📋',
  Operational: '⚙️',
  'Post-Checking': '✅',
}
const ACTIVITY_PAGE_KEYS = ['allocation-plan', 'shipment-plan', 'verification', 'at-berth', 'loading']
const PERF_WINDOW_DEFS = [
  { key: '7d', labelKey: 'perfWindow7d', ms: 7 * 24 * 3600000 },
  { key: '24h', labelKey: 'perfWindow24h', ms: 24 * 3600000 },
]

function phaseForAtBerthSummaryCard(status) {
  const s = String(status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'IN_PROGRESS') return 'Operational'
  if (s === 'POST_OPS') return 'Post-Checking'
  return 'Pre-Checking'
}

function parseIso(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatRelativeTime(iso, t) {
  const d = parseIso(iso)
  if (!d) return '—'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return t('relativeJustNow')
  if (sec < 3600) return t('relativeMinutesAgo', { n: Math.floor(sec / 60) })
  if (sec < 86400) return t('relativeHoursAgo', { n: Math.floor(sec / 3600) })
  return t('relativeDaysAgo', { n: Math.floor(sec / 86400) })
}

function median(values) {
  const arr = Array.isArray(values) ? values.filter((n) => Number.isFinite(n)).slice() : []
  if (arr.length === 0) return null
  arr.sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  if (arr.length % 2 === 1) return arr[mid]
  return (arr[mid - 1] + arr[mid]) / 2
}

function formatDurationHours(hours) {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`
  return `${hours.toFixed(1)}h`
}

export default function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tPages } = useTranslation('pages')
  const pipelineStages = useMemo(
    () => [
      { id: 'si', label: t('pipelineSi'), path: '/shipment-plans', color: 'si' },
      { id: 'planned-berthing', label: t('pipelinePlannedBerthing'), path: '/allocation-plans', color: 'planned-berthing' },
      { id: 'at-berth', label: t('pipelineAtBerth'), path: '/at-berth', color: 'at-berth' },
      { id: 'clearance', label: t('pipelineClearance'), path: '/verification', color: 'clearance' },
    ],
    [t]
  )
  const purposesUi = useMemo(
    () => [
      { key: 'Loading', label: t('purposeLoading') },
      { key: 'Unloading', label: t('purposeUnloading') },
    ],
    [t]
  )
  const phaseShortLabel = useMemo(
    () => ({
      'Pre-Checking': t('phasePre'),
      Operational: t('phaseOps'),
      'Post-Checking': t('phasePost'),
    }),
    [t]
  )
  const { current, forecast } = dashboardWeather
  const { selectedPortId, selectedPort } = usePortScope()
  const { canView } = useRbac()

  const [atBerth, setAtBerth] = useState([])
  const [allOps, setAllOps] = useState([])
  const [sis, setSis] = useState([])
  const [queue, setQueue] = useState([])
  const [berths, setBerths] = useState([])
  const [jetties, setJetties] = useState([])
  const [activityItems, setActivityItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiErr, setApiErr] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [perfWindow, setPerfWindow] = useState('7d')

  const canViewActivityLog = canView('activity-log')

  const refresh = useCallback(async () => {
    if (selectedPortId == null) {
      setLoading(false)
      setAtBerth([])
      setAllOps([])
      setSis([])
      setQueue([])
      setBerths([])
      setJetties([])
      setActivityItems([])
      setApiErr(null)
      return
    }

    setLoading(true)
    setApiErr(null)
    const errs = []

    const run = async (label, fn) => {
      try {
        const v = await fn()
        return { ok: true, v }
      } catch (e) {
        errs.push(`${label}: ${e?.message || 'failed'}`)
        return { ok: false, v: null }
      }
    }

    const [
      rAtBerth,
      rOps,
      rSi,
      rAlloc,
      rJetties,
      ...activityResults
    ] = await Promise.all([
      run('at-berth', fetchAtBerth),
      run('operations', () => fetchOperations()),
      run('shipping instructions', fetchShippingInstructions),
      run('allocation-plan', fetchAllocationOverview),
      run('jetties', () => fetchJetties(selectedPortId)),
      ...(canViewActivityLog
        ? ACTIVITY_PAGE_KEYS.map((pageKey) =>
            run(`activity:${pageKey}`, () => fetchActivityLogs({ pageKey, limit: 8 }))
          )
        : []),
    ])

    setAtBerth(Array.isArray(rAtBerth.v) ? rAtBerth.v : [])
    setAllOps(Array.isArray(rOps.v) ? rOps.v : [])
    setSis(Array.isArray(rSi.v) ? rSi.v : [])
    if (rAlloc.ok && rAlloc.v) {
      setQueue(Array.isArray(rAlloc.v.queue) ? rAlloc.v.queue : [])
      setBerths(Array.isArray(rAlloc.v.berths) ? rAlloc.v.berths : [])
    } else {
      setQueue([])
      setBerths([])
    }
    setJetties(Array.isArray(rJetties.v) ? rJetties.v : [])

    if (canViewActivityLog) {
      const merged = []
      for (const r of activityResults) {
        if (r.ok && r.v?.items) merged.push(...r.v.items)
      }
      merged.sort((a, b) => {
        const ta = parseIso(a.createdAt)?.getTime() ?? 0
        const tb = parseIso(b.createdAt)?.getTime() ?? 0
        return tb - ta
      })
      setActivityItems(merged.slice(0, 8))
    } else {
      setActivityItems([])
    }

    setApiErr(errs.length ? errs.join(' · ') : null)
    setLastUpdated(new Date())
    setLoading(false)
  }, [selectedPortId, canViewActivityLog])

  useEffect(() => {
    refresh()
  }, [refresh])

  const siStats = useMemo(() => {
    const list = Array.isArray(sis) ? sis : []
    const approved = list.filter((s) => s.status === 'Approved').length
    const submitted = list.filter((s) => s.status === 'Submitted').length
    return { total: list.length, approved, submitted }
  }, [sis])

  const opStats = useMemo(() => {
    const list = Array.isArray(allOps) ? allOps : []
    const by = (st) => list.filter((o) => o.status === st).length
    return {
      pending: by('PENDING'),
      allocated: by('ALLOCATED'),
      docked: by('DOCKED'),
      inProgress: by('IN_PROGRESS'),
      postOps: by('POST_OPS'),
      signoffRequested: by('SIGNOFF_REQUESTED'),
      signoffApproved: by('SIGNOFF_APPROVED'),
      sailed: by('SAILED'),
    }
  }, [allOps])

  /** Slot-based: Σ min(occupiedCount, capacity) / Σ capacity excluding Out of Service jetties */
  const slotOccupancy = useMemo(() => {
    const list = Array.isArray(berths) ? berths : []
    let totalSlots = 0
    let usedSlots = 0
    for (const b of list) {
      if ((b?.status || '') === 'Out of Service') continue
      const cap = b?.capacity != null ? Number(b.capacity) : 1
      const capN = Number.isFinite(cap) && cap >= 1 ? cap : 1
      const occ =
        b?.occupiedCount != null && Number.isFinite(Number(b.occupiedCount))
          ? Number(b.occupiedCount)
          : b?.currentVesselId
            ? 1
            : 0
      totalSlots += capN
      usedSlots += Math.min(Math.max(0, occ), capN)
    }
    const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0
    const overCapacity = usedSlots > totalSlots && totalSlots > 0
    return { totalSlots, usedSlots, pct, overCapacity }
  }, [berths])

  const slotOccupancyItems = useMemo(() => {
    const list = Array.isArray(berths) ? berths : []
    const out = []
    for (const b of list) {
      const jettyId = b?.id
      if (!jettyId) continue
      const capRaw = b?.capacity != null ? Number(b.capacity) : 1
      const cap = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : 1
      const occs = Array.isArray(b?.occupants) ? b.occupants : []
      for (let i = 0; i < Math.min(cap, occs.length); i += 1) {
        const occ = occs[i]
        const slotLabel = `${jettyId}-${String(i + 1).padStart(2, '0')}`
        const vesselName = (occ?.vesselName || '').trim() || String(occ?.vesselId || '—')
        out.push({ primary: `${slotLabel} — ${vesselName}` })
      }
      if (occs.length > cap) {
        out.push({ primary: `${jettyId}-${String(cap).padStart(2, '0')} — ${t('slotMore', { n: occs.length - cap })}` })
      }
    }
    return out
  }, [berths, t])

  const jettyStatusLists = useMemo(() => {
    const avail = []
    const oos = []
    for (const j of Array.isArray(jetties) ? jetties : []) {
      const name = (j?.name || '').trim()
      const shortId = name ? name.replace(/^Jetty\s+/i, '').trim() : ''
      const label = shortId || name || '—'
      if ((j?.status || '') === 'Out of Service') oos.push(label)
      else avail.push(label)
    }
    avail.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    oos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return { avail, oos }
  }, [jetties])

  const jettyStatusCounts = useMemo(() => {
    const m = { Available: 0, 'Out of Service': 0 }
    for (const j of jetties) {
      const s = j.status || 'Available'
      if (s === 'Out of Service') m['Out of Service'] += 1
      else m.Available += 1
    }
    return m
  }, [jetties])

  const atBerthCounts = useMemo(() => {
    const empty = () =>
      AT_BERTH_SUMMARY_PHASES.reduce((acc, ph) => {
        acc[ph] = 0
        return acc
      }, {})
    const counts = {
      Loading: empty(),
      Unloading: empty(),
    }
    for (const o of atBerth) {
      const phase = phaseForAtBerthSummaryCard(o.status)
      if (phase && counts[o.purpose]) counts[o.purpose][phase] += 1
    }
    return counts
  }, [atBerth])

  const slaAtRisk = useMemo(() => {
    const now = Date.now()
    const risky = []
    for (const o of allOps) {
      if (['SAILED', 'PENDING', 'ALLOCATED'].includes(o.status)) continue
      const etc = parseIso(o.estimatedCompletionTime)
      if (!etc) continue
      if (etc.getTime() < now) {
        const overH = (now - etc.getTime()) / 3600000
        risky.push({ ...o, overHours: overH })
      }
    }
    risky.sort((a, b) => b.overHours - a.overHours)
    return risky.slice(0, 5)
  }, [allOps])

  const performance = useMemo(() => {
    const win = PERF_WINDOW_DEFS.find((w) => w.key === perfWindow) || PERF_WINDOW_DEFS[0]
    const cutoff = Date.now() - win.ms
    const tolMs = 6 * 3600000
    const queueList = Array.isArray(queue) ? queue : []
    const opsList = Array.isArray(allOps) ? allOps : []

    const waitingHrs = []
    const waitingWorst = []

    const turnaroundHrs = []
    const turnaroundWorst = []

    let onTimeEligible = 0
    let onTimeCount = 0
    const onTimeLateList = []

    const seenWaiting = new Set()
    const seenOnTime = new Set()
    for (const r of queueList) {
      if (r?.shiftingOut) continue
      const callKey = allocationQueueVesselCallKey(r)
      const vesselName = (r?.vesselName || '').trim() || `Op #${r?.operationId ?? r?.id ?? '—'}`
      const jettyName = (r?.jetty || '').trim() || '—'

      const ta = parseIso(r?.taDateTime)
      const tb = parseIso(r?.tbDateTime)
      const planned = parseIso(r?.plannedEtbDateTime)
      const castOff = parseIso(r?.castOffDateTime)
      const actualComp = parseIso(r?.actualCompletionDateTime)

      // Waiting time to berth (TA -> TB), windowed by TB.
      if (ta && tb && tb.getTime() > ta.getTime() && tb.getTime() >= cutoff) {
        if (seenWaiting.has(callKey)) continue
        seenWaiting.add(callKey)
        const h = (tb.getTime() - ta.getTime()) / 3600000
        waitingHrs.push(h)
        waitingWorst.push({ vesselName, jettyName, hours: h })
      }

      // On-time berthing rate: TB <= planned ETB + 6h, windowed by TB.
      if (planned && tb && tb.getTime() >= cutoff) {
        if (seenOnTime.has(callKey)) continue
        seenOnTime.add(callKey)
        onTimeEligible += 1
        const lateMs = tb.getTime() - (planned.getTime() + tolMs)
        if (lateMs <= 0) onTimeCount += 1
        else onTimeLateList.push({ vesselName, jettyName, lateHours: lateMs / 3600000 })
      }
    }

    // Turnaround includes sailed operations too; compute from operations list (TB -> cast-off preferred; else actual completion).
    for (const o of opsList) {
      if (o?.shiftingOut) continue
      const vesselName = (o?.vesselName || '').trim() || `Op #${o?.id ?? '—'}`
      const jettyName = (o?.jettyName || '').trim() || '—'
      const tb = parseIso(o?.tbAt || o?.dockingStartTime)
      const castOff = parseIso(o?.castOffAt)
      const actualComp = parseIso(o?.actualCompletionTime)
      if (!tb) continue
      const end = castOff || actualComp
      if (end && end.getTime() > tb.getTime() && end.getTime() >= cutoff) {
        const h = (end.getTime() - tb.getTime()) / 3600000
        turnaroundHrs.push(h)
        turnaroundWorst.push({ vesselName, jettyName, hours: h })
      }
    }

    waitingWorst.sort((a, b) => b.hours - a.hours)
    turnaroundWorst.sort((a, b) => b.hours - a.hours)
    onTimeLateList.sort((a, b) => b.lateHours - a.lateHours)

    // Show a value as soon as we have at least 1 eligible row; surface sample size in the UI.
    const minSample = 1
    const waitingMedian = waitingHrs.length >= minSample ? median(waitingHrs) : null
    const turnaroundMedian = turnaroundHrs.length >= minSample ? median(turnaroundHrs) : null
    const onTimeRate =
      onTimeEligible >= minSample ? Math.round((onTimeCount / Math.max(1, onTimeEligible)) * 100) : null

    return {
      window: win,
      windowLabel: t(win.labelKey),
      minSample,
      waiting: { medianHours: waitingMedian, sampleSize: waitingHrs.length, worst: waitingWorst.slice(0, 10) },
      turnaround: {
        medianHours: turnaroundMedian,
        sampleSize: turnaroundHrs.length,
        worst: turnaroundWorst.slice(0, 10),
      },
      onTime: { ratePct: onTimeRate, eligible: onTimeEligible, onTime: onTimeCount, late: onTimeLateList.slice(0, 10) },
    }
  }, [queue, allOps, perfWindow, t])

  const plannedBerthingCount = useMemo(() => {
    const seen = new Set()
    let n = 0
    for (const r of queue) {
      if (!isPlannedBerthingQueueRow(r)) continue
      const k = allocationQueueVesselCallKey(r)
      if (seen.has(k)) continue
      seen.add(k)
      n += 1
    }
    return n
  }, [queue])

  const pipelineCounts = {
    si: siStats.total,
    plannedBerthing: plannedBerthingCount,
    atBerth: atBerth.length,
    clearance: opStats.sailed,
  }

  const weatherFooter = (
    <section className="dashboard-weather-footer" aria-label={t('weatherAria')}>
      <div className="weather-card-wrap">
        <div className="card weather-card">
          <h2 className="card__title">{t('weatherTitle')}</h2>
          <p className="dashboard-mock-hint">{t('weatherMockHint')}</p>
          <div className="weather-card__body">
            <div className="weather-card__main">
              <span className="weather-card__condition">{current.condition}</span>
              <span className="weather-card__temp">{current.temperature}°C</span>
              <span className="weather-card__meta">
                {t('weatherWindHumidity', { wind: current.windKmh, humidity: current.humidity })}
              </span>
              {current.berthingImpact && (
                <p className="weather-card__berthing-note" role="status">
                  {current.berthingNote}
                </p>
              )}
            </div>
            <div className="weather-card__forecast">
              <span className="weather-card__forecast-label">{t('forecast')}</span>
              <ul className="weather-card__forecast-list">
                {forecast.map((day, i) => (
                  <li key={i} className="weather-card__forecast-item">
                    <span className="weather-card__forecast-day">{day.label}</span>
                    <span className="weather-card__forecast-condition">{day.condition}</span>
                    <span className="weather-card__forecast-temp">
                      {day.tempMin}°–{day.tempMax}°
                    </span>
                    <span className="weather-card__forecast-rain">{t('rainPct', { n: day.rainChance })}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="weather-card-overlay" aria-hidden="true">
          <span className="weather-card-overlay__watermark">{t('widgetComingSoon')}</span>
        </div>
      </div>
    </section>
  )

  if (selectedPortId == null) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="page-title">{tPages('dashboard')}</h1>
        </header>
        <div className="card dashboard-empty-state">
          <p className="text-steel">{tPages('dashboardSelectPortHint')}</p>
        </div>
        {weatherFooter}
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="page-title">{tPages('dashboard')}</h1>
        <span className="dashboard-header__meta">
          {lastUpdated && (
            <>
              {t('lastUpdated')}{' '}
              {lastUpdated.toLocaleString(getAppLocaleTag(), { dateStyle: 'short', timeStyle: 'short' })}
            </>
          )}
        </span>
      </header>

      {selectedPort && (
        <div className="dashboard-port-chip" role="status">
          <span className="dashboard-port-chip__dot" aria-hidden />
          <span className="dashboard-port-chip__label">{t('portWord')}</span>
          <span className="dashboard-port-chip__name">{selectedPort.name}</span>
          <span className="dashboard-port-chip__meta">
            {' '}
            {t('jettyCount', { count: jetties.length })}
          </span>
        </div>
      )}

      {apiErr && (
        <div className="dashboard-api-banner" role="alert">
          {t('apiLoadPartial')} {apiErr}
        </div>
      )}

      <section className="card dashboard-pipeline">
        <h2 className="card__title">{t('vesselPipeline')}</h2>
        <div className="pipeline-flow" role="navigation" aria-label={t('vesselPipeline')}>
          {pipelineStages.map((stage, index) => (
            <Fragment key={stage.id}>
              {index > 0 && (
                <span className="pipeline-arrow" aria-hidden>
                  →
                </span>
              )}
              <Link
                to={stage.path}
                className={`pipeline-stage pipeline-stage--${stage.color}`}
              >
                <span className="pipeline-stage__label">{stage.label}</span>
                <span className="pipeline-stage__count">
                  {stage.id === 'si' && pipelineCounts.si}
                  {stage.id === 'planned-berthing' && pipelineCounts.plannedBerthing}
                  {stage.id === 'at-berth' && pipelineCounts.atBerth}
                  {stage.id === 'clearance' && pipelineCounts.clearance}
                </span>
                <span className="pipeline-stage__sublabel">
                  {stage.id === 'si' && (
                    <>
                      {t('pipelineSiSub', { approved: siStats.approved, total: siStats.total })}
                    </>
                  )}
                  {stage.id === 'planned-berthing' && <>{t('pipelinePlannedSub')}</>}
                  {stage.id === 'at-berth' && <>{t('pipelineAtBerthSub')}</>}
                  {stage.id === 'clearance' && <>{t('pipelineClearanceSub')}</>}
                </span>
              </Link>
            </Fragment>
          ))}
        </div>
      </section>

      <section className="dashboard-row1">
        <div className="dashboard-row1__chart">
          <DashboardActivityChart queue={queue} sis={sis} loading={loading} />
        </div>

        <div className="dashboard-kpi-grid" aria-label={t('kpiGridAria')}>
          <div className="metric-card">
            <span className="metric-card__label">{t('slotOccupancy')}</span>
            <span className="metric-card__value">
              {slotOccupancy.totalSlots > 0 ? (
                <>
                  {slotOccupancy.usedSlots}/{slotOccupancy.totalSlots}
                  <span className="metric-card__unit">{slotOccupancy.pct}%</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <div className="metric-card__bar-wrap" role="presentation">
              <div
                className={`metric-card__bar${slotOccupancy.overCapacity ? ' metric-card__bar--over' : ''}`}
                style={{
                  width:
                    slotOccupancy.totalSlots > 0
                      ? `${Math.min(100, slotOccupancy.pct)}%`
                      : '0%',
                }}
              />
            </div>
            <span className="metric-card__type">
              {t('slotOccupancyHint')}{' '}
              <InteractiveTooltip
                title={t('slotTooltipTitle')}
                subtitle={t('slotTooltipSubtitle')}
                items={slotOccupancyItems}
                emptyText={t('slotEmpty')}
                maxWidth={360}
              >
                <span className="metric-card__type-link">{t('slotDetails')}</span>
              </InteractiveTooltip>
            </span>
            <Link to="/at-berth" className="metric-card__link">
              {t('viewAtBerth')}
            </Link>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">{t('jettyStatus')}</span>
            <div className="metric-card__jetty-status" role="list" aria-label={t('jettyStatus')}>
              <InteractiveTooltip
                title={t('jettyTooltipAvail')}
                items={jettyStatusLists.avail}
                emptyText={t('jettyEmptyAvail')}
              >
                <span className="metric-card__jetty-chip metric-card__jetty-chip--ok" role="listitem">
                  {t('available')} <strong>{jettyStatusCounts.Available}</strong>
                </span>
              </InteractiveTooltip>
              <InteractiveTooltip
                title={t('jettyTooltipOos')}
                items={jettyStatusLists.oos}
                emptyText={t('jettyEmptyOos')}
              >
                <span className="metric-card__jetty-chip metric-card__jetty-chip--bad" role="listitem">
                  {t('outOfService')} <strong>{jettyStatusCounts['Out of Service']}</strong>
                </span>
              </InteractiveTooltip>
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">{t('readyToSail')}</span>
            <span className="metric-card__value">{opStats.signoffApproved}</span>
            <Link to="/verification" className="metric-card__link">
              {t('clearanceLink')}
            </Link>
          </div>
          <div className="metric-card metric-card--risk">
            <span className="metric-card__label">{t('slaAtRisk')}</span>
            <InteractiveTooltip
              title={t('slaTooltipTitle')}
              subtitle={t('slaTooltipSubtitle')}
              items={slaAtRisk.map((o) => ({
                primary: o.vesselName || `Op #${o.id}`,
                secondary: `${o.jettyName || '—'} · +${o.overHours < 1 ? `${Math.round(o.overHours * 60)}m` : `${o.overHours.toFixed(1)}h`} over ETC`,
              }))}
              emptyText={t('slaEmpty')}
              maxWidth={360}
            >
              <span className="metric-card__value">{slaAtRisk.length}</span>
            </InteractiveTooltip>
            <span className="metric-card__type">{t('slaSub')}</span>
          </div>
        </div>
      </section>

      <div className="dashboard-main-grid dashboard-main-grid--single">
        <div className="dashboard-main-column">
          <div className="dashboard-perf-row">
            <section className="card dashboard-performance">
              <div className="dashboard-performance__head">
                <h2 className="card__title">{t('perfTitle')}</h2>
                <div className="dashboard-performance__toggle" role="group" aria-label={t('perfTitle')}>
                  {PERF_WINDOW_DEFS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className={`dashboard-performance__toggle-btn${perfWindow === w.key ? ' is-active' : ''}`}
                      onClick={() => setPerfWindow(w.key)}
                    >
                      {t(w.key === '7d' ? 'perfToggle7d' : 'perfToggle24h')}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <p className="text-steel">{t('loadingEllipsis')}</p>
              ) : (
                <div className="dashboard-performance__grid" role="list" aria-label={t('perfTitle')}>
                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">{t('perfWaiting')}</div>
                    <InteractiveTooltip
                      title={t('perfWaitingTooltip')}
                      subtitle={`${performance.windowLabel} · n=${performance.waiting.sampleSize}`}
                      items={performance.waiting.worst.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Wait: ${formatDurationHours(x.hours)}`,
                      }))}
                      emptyText={t('perfWaitingEmpty')}
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.waiting.medianHours == null
                          ? '—'
                          : formatDurationHours(performance.waiting.medianHours)}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    {t('perfWaitingSub', {
                      window: performance.windowLabel,
                      n: performance.waiting.sampleSize,
                    })}
                    </div>
                  </div>

                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">{t('perfTurnaround')}</div>
                    <InteractiveTooltip
                      title={t('perfTurnaroundTooltip')}
                      subtitle={`${performance.windowLabel} · n=${performance.turnaround.sampleSize}`}
                      items={performance.turnaround.worst.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Turnaround: ${formatDurationHours(x.hours)}`,
                      }))}
                      emptyText={t('perfTurnaroundEmpty')}
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.turnaround.medianHours == null
                          ? '—'
                          : formatDurationHours(performance.turnaround.medianHours)}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    {t('perfTurnaroundSub', {
                      window: performance.windowLabel,
                      n: performance.turnaround.sampleSize,
                    })}
                    </div>
                  </div>

                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">{t('perfOnTime')}</div>
                    <InteractiveTooltip
                      title={t('perfOnTimeTooltip')}
                      subtitle={`${performance.windowLabel} · eligible=${performance.onTime.eligible}`}
                      items={performance.onTime.late.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Late: +${formatDurationHours(x.lateHours)}`,
                      }))}
                      emptyText={t('perfOnTimeEmpty')}
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.onTime.ratePct == null ? '—' : `${performance.onTime.ratePct}%`}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    {t('perfOnTimeSub', {
                      window: performance.windowLabel,
                      eligible: performance.onTime.eligible,
                    })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="card dashboard-at-berth">
              <div className="dashboard-at-berth__head">
                <h2 className="card__title">{t('atBerthNow')}</h2>
                <Link to="/at-berth" className="btn btn--small btn--primary">
                  {t('viewAll')}
                </Link>
              </div>
              {loading ? (
                <p className="text-steel">{t('loadingEllipsis')}</p>
              ) : (
                <>
                  <div className="at-berth-summary__groups at-berth-summary__groups--compact">
                    {purposesUi.map(({ key: purpose, label }) => (
                      <div key={purpose} className="at-berth-summary__group">
                        <h3 className="at-berth-summary__group-title at-berth-summary__group-title--small">
                          {label}
                        </h3>
                        <div className="at-berth-summary__grid">
                          {AT_BERTH_SUMMARY_PHASES.map((phase) => (
                            <div
                              key={phase}
                              className={`at-berth-card at-berth-card--${purpose.toLowerCase()} at-berth-card--compact`}
                              title={`${phase}: ${atBerthCounts[purpose][phase]}`}
                            >
                              <div className="at-berth-compact-stack" aria-label={`${phaseShortLabel[phase]} ${atBerthCounts[purpose][phase]}`}>
                                <span className="at-berth-compact-stack__icon" aria-hidden>
                                  {PHASE_EMOJI[phase]}
                                </span>
                                <span className="at-berth-compact-stack__label">{phaseShortLabel[phase]}</span>
                                <span className="at-berth-compact-stack__count">{atBerthCounts[purpose][phase]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-clearance-row dashboard-clearance-row--triple">
                    <Link
                      to="/verification"
                      className="dashboard-clearance-card dashboard-clearance-card--ready"
                    >
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        ⚓
                      </span>
                      <span className="dashboard-clearance-card__label">{t('clearanceReady')}</span>
                      <span className="dashboard-clearance-card__count">{opStats.signoffApproved}</span>
                    </Link>
                    <div className="dashboard-clearance-card dashboard-clearance-card--departed">
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        🚀
                      </span>
                      <span className="dashboard-clearance-card__label">{t('clearanceSailed')}</span>
                      <span className="dashboard-clearance-card__count">{opStats.sailed}</span>
                    </div>
                    <div
                      className={`dashboard-clearance-card dashboard-clearance-card--exception ${opStats.signoffRequested > 0 ? 'dashboard-clearance-card--exception-active' : ''}`}
                    >
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        ⚠
                      </span>
                      <span className="dashboard-clearance-card__label">{t('clearancePendingSignOff')}</span>
                      <span className="dashboard-clearance-card__count">{opStats.signoffRequested}</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="card">
            <div className="dashboard-at-berth__head">
              <h2 className="card__title">{t('recentUpdates')}</h2>
            </div>
            {!canViewActivityLog ? (
              <p className="text-steel">{t('activityRestricted')}</p>
            ) : loading ? (
              <p className="text-steel">{t('loadingEllipsis')}</p>
            ) : activityItems.length === 0 ? (
              <p className="text-steel">{t('noRecentActivity')}</p>
            ) : (
              <ul className="dashboard-activity-feed">
                {activityItems.map((item) => (
                  <li key={`${item.id}-${item.pageKey}`} className="dashboard-activity-feed__item">
                    <span className="dashboard-activity-feed__dot" aria-hidden />
                    <div>
                      <div className="dashboard-activity-feed__summary">{item.summary}</div>
                      <div className="dashboard-activity-feed__meta">
                        {formatRelativeTime(item.createdAt, t)}
                        {item.actorUsername ? ` · ${item.actorUsername}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Next arrivals / line-up widget removed (not used). */}
        </div>
      </div>

      {weatherFooter}
    </div>
  )
}
