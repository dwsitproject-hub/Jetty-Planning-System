import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import EtcBreachBadge from './EtcBreachBadge'
import PurposeBadge from './PurposeBadge'
import { berths as defaultBerths, vessels as mockVessels } from '../data/mockData'
import { fetchJettyLayout } from '../api/jettyLayout'
import { fetchJetties } from '../api/jetties'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import {
  toDateInputValue,
  parseDateInputStart,
  asOfMsForSelectedDate,
  buildBerthsForSchematicDate,
  buildIncomingByJettyForDate,
  computeScheduleKpis,
} from '../utils/jettyScheduleOccupancy'
import { formatDateDisplay, formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import VisualizationPopoutButton from './VisualizationPopoutButton'
import '../styles/jetty-schematic.css'

const AT_BERTH_PAGE_KEY = 'at-berth'

/**
 * LOAD vs DISCH for slot tinting. Must not use naive `includes('LOAD')` — "Unloading" → "UNLOADING" contains "LOAD".
 * Prefer explicit purpose / loadDischarge (queue + vessel map); berth occupant may carry operation fields.
 */
function getOperationType(vessel, occupant) {
  const v = { ...(occupant || {}), ...(vessel || {}) }
  if (!vessel && !occupant) return 'DISCH'

  const purpose = String(v.purpose || '').trim().toLowerCase()
  if (purpose === 'loading') return 'LOAD'
  if (purpose === 'unloading') return 'DISCH'

  const ld = String(v.loadDischarge || '').toUpperCase()
  if (ld === 'LOAD') return 'LOAD'
  if (ld === 'DISCH') return 'DISCH'

  const s = String(v.status || '').toUpperCase()
  const pl = String(v.phaseLabel || '').toUpperCase()
  if (/\bUNLOAD/i.test(pl) || /\bUNLOAD/i.test(s)) return 'DISCH'
  if (/\bLOADING\b/i.test(pl) || /\bLOADING\b/i.test(s)) return 'LOAD'

  return 'DISCH'
}

/**
 * Parse a qty display string ("3.999 MT", "2,500 MT", "1.234,5 KL") into { total, unit }.
 * Handles both id-ID (dot thousands) and en-US (comma thousands) styles; returns null when ambiguous.
 */
function parseQtyDisplay(display) {
  if (!display || typeof display !== 'string') return null
  const line = display.split('\n')[0].trim()
  const m = line.match(/([\d.,]+)\s*([A-Za-z]+)?/)
  if (!m) return null
  let numStr = m[1]
  const seps = numStr.match(/[.,]/g) || []
  if (seps.length) {
    const lastSep = Math.max(numStr.lastIndexOf('.'), numStr.lastIndexOf(','))
    const trailing = numStr.length - lastSep - 1
    if (trailing === 3) {
      numStr = numStr.replace(/[.,]/g, '')
    } else {
      const intPart = numStr.slice(0, lastSep).replace(/[.,]/g, '')
      numStr = `${intPart}.${numStr.slice(lastSep + 1)}`
    }
  }
  const total = Number(numStr)
  if (!Number.isFinite(total) || total <= 0) return null
  return { total, unit: m[2] || 'MT' }
}

function formatQtyNumber(n) {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Top-view vessel shape (rounded stern, pointed bow, cargo deck with hatch lines, bridge block).
 * Hull fill follows purpose via CSS on the lane (--load green / --disch blue).
 */
function VesselShape({ widthPct = null }) {
  return (
    <svg
      className="jetty-vessel__svg"
      viewBox="0 0 220 30"
      preserveAspectRatio="none"
      style={widthPct != null ? { width: `${widthPct}%` } : undefined}
      aria-hidden
      focusable="false"
    >
      <path
        className="jetty-vessel__hull"
        d="M8 15 Q8 4 24 4 L164 4 Q198 4 213 15 Q198 26 164 26 L24 26 Q8 26 8 15 Z"
      />
      <rect className="jetty-vessel__deck" x="28" y="8" width="116" height="14" rx="4" />
      <line className="jetty-vessel__hatch" x1="52" y1="8" x2="52" y2="22" />
      <line className="jetty-vessel__hatch" x1="76" y1="8" x2="76" y2="22" />
      <line className="jetty-vessel__hatch" x1="100" y1="8" x2="100" y2="22" />
      <line className="jetty-vessel__hatch" x1="124" y1="8" x2="124" y2="22" />
      <rect className="jetty-vessel__bridge" x="152" y="9" width="15" height="12" rx="2" />
      <rect className="jetty-vessel__funnel" x="170" y="12" width="5" height="6" rx="1" />
    </svg>
  )
}

/** Match backend/allocation: short jetty id from master name (e.g. "Jetty 1A" -> "1A") */
function jettyNameToBerthId(name) {
  if (!name || typeof name !== 'string') return null
  const s = name.replace(/^Jetty\s+/i, '').trim()
  return s || null
}

function parseMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/** "3d 4h" / "5h 20m" elapsed label. */
function formatDurationShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rem}m`
  return `${rem}m`
}

/** Same ordering as Jetty schedule bank lanes (TB → operationId → vesselId). */
function sortBerthOccupants(occupants) {
  const list = Array.isArray(occupants) ? [...occupants] : []
  list.sort((a, b) => {
    const tbA = parseMs(a?.tbDateTime)
    const tbB = parseMs(b?.tbDateTime)
    if (tbA != null && tbB != null && tbA !== tbB) return tbA - tbB
    if (tbA != null && tbB == null) return -1
    if (tbA == null && tbB != null) return 1
    const opA = a?.operationId != null ? Number(a.operationId) : Number.MAX_SAFE_INTEGER
    const opB = b?.operationId != null ? Number(b.operationId) : Number.MAX_SAFE_INTEGER
    if (opA !== opB) return opA - opB
    return String(a?.vesselId || '').localeCompare(String(b?.vesselId || ''))
  })
  return list
}

/**
 * One slot per bank lane; aligns with Gantt 01/02 when over capacity last lane shows +N more.
 */
function buildBerthLaneSlots(berth, capacity) {
  const cap = Math.max(1, Number(capacity) >= 1 ? Number(capacity) : 1)
  const sorted = sortBerthOccupants(berth?.occupants)
  const slots = []
  for (let lane = 0; lane < cap; lane += 1) {
    if (lane < sorted.length) {
      const overflowCount = sorted.length > cap && lane === cap - 1 ? sorted.length - cap : 0
      const occ = sorted[lane]
      slots.push({
        laneIndex: lane,
        vesselId: occ?.vesselId || null,
        occupant: occ,
        overflowCount,
      })
    } else {
      slots.push({ laneIndex: lane, vesselId: null, occupant: null, overflowCount: 0 })
    }
  }
  return slots
}

function berthCapacity(berth) {
  const c = berth?.capacity != null ? Number(berth.capacity) : 1
  return Number.isFinite(c) && c >= 1 ? c : 1
}

const ADMIN_LAYOUT_PLACEHOLDER =
  'Jetty layout is not configured. Please ask your admin to set it up in the master menu'

export default function JettySchematic({
  berths: berthsProp,
  scheduleList = [],
  viewAsOfMs = Date.now(),
  vesselById = {},
  selectedBerthId,
  onSelectBerth,
  onSelectVessel,
  popoutProfile = 'plan',
  hidePopoutButton = false,
  isPopout = false,
  /** Optional: open the queue list filtered by a schematic KPI ('eta' | 'etb' | 'etc'). */
  onKpiOpen,
  /** Ref for JPG export capture region (below filters). */
  exportRootRef,
  /** Optional export menu slot (plan-centric allocation page). */
  exportMenu,
}) {
  const { t } = useTranslation('pages')
  const { t: tAlloc } = useTranslation('allocation')
  const { canApprove } = useRbac()
  const canViewJettyLiveCctv = canApprove(AT_BERTH_PAGE_KEY)
  const { selectedPortId, requiresSelection, noPortAssigned } = usePortScope()
  const canLoadLayout = selectedPortId != null && !requiresSelection && !noPortAssigned

  const [layoutColumns, setLayoutColumns] = useState(null)
  const [layoutPhase, setLayoutPhase] = useState('idle')
  const [jettyIdToBerthId, setJettyIdToBerthId] = useState({})
  const [berthIdToRtspLink, setBerthIdToRtspLink] = useState({})
  /** Physical specs from Master Jetty (length/draft/DWT) — drives proportional scaling. */
  const [berthIdToSpecs, setBerthIdToSpecs] = useState({})

  useEffect(() => {
    if (!canLoadLayout) {
      setLayoutColumns(null)
      setLayoutPhase('no-port')
      setJettyIdToBerthId({})
      setBerthIdToRtspLink({})
      setBerthIdToSpecs({})
      return undefined
    }

    let cancelled = false
    setLayoutPhase('loading')

    ;(async () => {
      try {
        const [layoutRes, jetList] = await Promise.all([fetchJettyLayout(), fetchJetties(selectedPortId)])
        if (cancelled) return

        const cols = Array.isArray(layoutRes?.columns) ? layoutRes.columns : []
        const idMap = {}
        const rtspMap = {}
        const specMap = {}
        for (const j of Array.isArray(jetList) ? jetList : []) {
          if (j?.id == null) continue
          const bid = jettyNameToBerthId(j.name)
          if (bid) {
            idMap[String(j.id)] = bid
            const link = typeof j.rtspLink === 'string' ? j.rtspLink.trim() : ''
            if (link) rtspMap[bid] = link
            specMap[bid] = {
              lengthM: j.jettyLengthM != null ? Number(j.jettyLengthM) : null,
              draft: j.jettyDraft != null ? Number(j.jettyDraft) : null,
              dwt: j.jettyDwt != null ? Number(j.jettyDwt) : null,
            }
          }
        }
        setJettyIdToBerthId(idMap)
        setBerthIdToRtspLink(rtspMap)
        setBerthIdToSpecs(specMap)

        if (cols.length === 0) {
          setLayoutColumns([])
          setLayoutPhase('empty')
        } else {
          setLayoutColumns(cols)
          setLayoutPhase('ready')
        }
      } catch {
        if (!cancelled) {
          setLayoutColumns(null)
          setLayoutPhase('error')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [canLoadLayout, selectedPortId])

  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()))
  const todayYmd = toDateInputValue(new Date(viewAsOfMs))
  const isTodaySelected = selectedDate === todayYmd
  const asOfMs = asOfMsForSelectedDate(selectedDate, viewAsOfMs)

  const handleDateChange = (e) => {
    const next = e.target.value
    if (!next) return
    setSelectedDate(next > todayYmd ? todayYmd : next)
  }

  const displayBerths = useMemo(
    () =>
      buildBerthsForSchematicDate({
        scheduleRows: scheduleList,
        berthsMaster: berthsProp ?? defaultBerths,
        dateYmd: selectedDate,
        asOfMs,
      }),
    [scheduleList, berthsProp, selectedDate, asOfMs]
  )

  const displayIncoming = useMemo(
    () => buildIncomingByJettyForDate(scheduleList, selectedDate, asOfMs),
    [scheduleList, selectedDate, asOfMs]
  )

  /** ETA / ETB / ETC due on the selected date without their actuals yet. */
  const scheduleKpis = useMemo(
    () => computeScheduleKpis(scheduleList, selectedDate),
    [scheduleList, selectedDate]
  )

  /** Incoming vessel details (ETA/ETB/commodity/qty) looked up by name from schedule rows. */
  const incomingRowByName = useMemo(() => {
    const map = {}
    for (const r of Array.isArray(scheduleList) ? scheduleList : []) {
      const name = r?.vesselName
      if (name && !map[name]) map[name] = r
    }
    return map
  }, [scheduleList])

  const berths = displayBerths
  const interactive = typeof onSelectBerth === 'function'
  const canSelectVessel = typeof onSelectVessel === 'function'
  const getVessel = (id) => {
    if (!id) return null
    return vesselById[id] || mockVessels[id] || null
  }

  function resolveBerthId(dbJettyId) {
    if (dbJettyId == null || dbJettyId === '') return null
    return jettyIdToBerthId[String(dbJettyId)] ?? null
  }

  const openJettyLiveCctv = useCallback((berthId, rtspLink) => {
    const params = new URLSearchParams()
    params.set('rtsp', rtspLink)
    params.set('label', berthId)
    const url = `${window.location.origin}/jetty-live?${params.toString()}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  function renderCctvButton(berthId) {
    if (!canViewJettyLiveCctv) return null
    const rtspLink = berthIdToRtspLink[berthId]
    const hasCctv = Boolean(rtspLink)
    const noCctvLabel = t('jettySchematicNoCctv')
    return (
      <button
        type="button"
        className="jetty-schematic__cctv-btn"
        disabled={!hasCctv}
        title={hasCctv ? t('jettySchematicViewCctv', { label: berthId }) : noCctvLabel}
        aria-label={hasCctv ? t('jettySchematicViewCctv', { label: berthId }) : noCctvLabel}
        onClick={(e) => {
          e.stopPropagation()
          if (hasCctv) openJettyLiveCctv(berthId, rtspLink)
        }}
      >
        <span className="jetty-schematic__cctv-btn-icon" aria-hidden>
          📹
        </span>
      </button>
    )
  }

  function berthOccupantIds(berth) {
    if (!berth) return []
    if (Array.isArray(berth.occupants) && berth.occupants.length) {
      return berth.occupants.map((o) => o?.vesselId).filter(Boolean)
    }
    return berth.currentVesselId ? [berth.currentVesselId] : []
  }

  function formatIncomingList(val) {
    if (Array.isArray(val)) return val.filter(Boolean)
    if (typeof val === 'string' && val.trim()) return [val.trim()]
    return []
  }

  function jettyTooltip(berthId, cap, occIds, occNames, incomingLabel) {
    const occLabel = occNames.length ? occNames.join(', ') : '—'
    return `Jetty ${berthId}\nOccupied: ${occIds.length}/${cap}\nCurrent : ${occLabel}\nIncoming : ${incomingLabel}`
  }

  function formatMaterialDisplay(v) {
    return v?.materialDisplay ?? v?.product ?? v?.commodity ?? '—'
  }

  /** Detached info card (mockup style) — vessel shape is rendered separately in the lane. */
  function slotContentForSingleVessel(vesselId, occupant, overflowCount, laneSuffix, op) {
    const v = getVessel(vesselId)
    const displayName = v?.vesselName || occupant?.vesselName || String(vesselId || '—')
    if (!vesselId) return 'Vacant'
    const materialDisplay = formatMaterialDisplay(v)
    const agent = v?.agent || null

    // Cargo progress: done/total + balance derived from totalQtyDisplay × completionPercent
    const qty = parseQtyDisplay(v?.totalQtyDisplay)
    const pct = Number(v?.completionPercent)
    const hasPct = Number.isFinite(pct)
    let cargoLine = null
    let balanceLine = null
    if (qty) {
      const done = hasPct ? Math.max(0, Math.min(qty.total, (qty.total * pct) / 100)) : null
      cargoLine =
        done != null
          ? `${formatQtyNumber(done)} ${qty.unit} / ${formatQtyNumber(qty.total)} ${qty.unit}`
          : `${formatQtyNumber(qty.total)} ${qty.unit}`
      if (done != null) balanceLine = `Balance ${formatQtyNumber(qty.total - done)} ${qty.unit}`
    }

    return (
      <span className="jetty-slot__inner jetty-card__box">
        <span className="jetty-card__titlerow">
          <span className="jetty-card__lane-chip" aria-hidden>
            {laneSuffix}
          </span>
          <span className="jetty-slot__title jetty-card__name">{displayName}</span>
          <span className="jetty-card__title-actions">
            <span
              className={`jetty-card__purpose-chip jetty-card__purpose-chip--${op === 'LOAD' ? 'load' : 'disch'}`}
              aria-hidden
            >
              <PurposeBadge purpose={v?.purpose} loadDischarge={v?.loadDischarge} />
            </span>
            {renderCardEtcBadge(v)}
          </span>
        </span>
        {agent ? <span className="jetty-slot__line jetty-card__agent">{agent}</span> : null}
        <span className="jetty-slot__line jetty-card__cargo jetty-slot__line--material">
          {materialDisplay}
          {cargoLine ? `  ${cargoLine}` : ''}
        </span>
        {balanceLine ? (
          <span className="jetty-slot__line jetty-card__balance">{balanceLine}</span>
        ) : null}
        {(() => {
          const tbMs = parseMs(v?.tbDateTime)
          const dur = tbMs != null && asOfMs > tbMs ? formatDurationShort(asOfMs - tbMs) : null
          return dur ? (
            <span className="jetty-slot__line jetty-card__berthed">
              {tAlloc('cardTimeSinceBerthing', { defaultValue: 'Berthed' })} {dur}
            </span>
          ) : null
        })()}
        {overflowCount > 0 && (
          <span className="jetty-slot__line jetty-slot__line--overflow">+{overflowCount} more</span>
        )}
      </span>
    )
  }

  function renderCardEtcBadge(v) {
    if (!isTodaySelected || !v?.etcBreach) return null
    return (
      <EtcBreachBadge
        overMs={v.etcBreach.overMs}
        etcMs={v.etcBreach.etcMs}
        size="icon-only"
        className="jetty-card__etc-badge"
      />
    )
  }

  function renderLaneSuffix(laneLabel, laneSuffix) {
    return (
      <span className="jetty-schematic__lane-suffix" title={laneLabel} aria-hidden>
        {laneSuffix}
      </span>
    )
  }

  /** @param {'top' | 'bottom'} stackPlacement — top uses column-reverse so lane 01 sits inner (adjacent to pipeline). */
  function renderBerthLaneStack(berthId, berth, stackPlacement) {
    const cap = berthCapacity(berth)
    const spec = berthIdToSpecs[berthId] || null
    const occIds = berthOccupantIds(berth)
    const occNames = occIds.map((id) => getVessel(id)?.vesselName || berth?.currentVesselName || id).filter(Boolean)
    const incomingNames = formatIncomingList(displayIncoming[berthId])
    const incomingLabel = incomingNames.length ? incomingNames.join(', ') : '—'
    const isOos = (berth?.status || '') === 'Out of Service'
    const specLine = spec?.lengthM
      ? `\nJetty spec: ${spec.lengthM} m · draft ${spec.draft ?? '—'} · DWT ${spec.dwt != null ? spec.dwt.toLocaleString('en-US') : '—'}`
      : ''
    const baseTooltip =
      (isOos
        ? `Out of service — not available for new allocation.\n${jettyTooltip(berthId, cap, occIds, occNames, incomingLabel)}`
        : jettyTooltip(berthId, cap, occIds, occNames, incomingLabel)) + specLine

    const slots = buildBerthLaneSlots(berth, cap)
    let firstVacantIncomingShown = false
    /** Same lane pixel height as a double-bank row when capacity is 1 (avoids one huge green box). */
    const laneHeightDivisor = Math.max(cap, 2)

    const stackModifier =
      stackPlacement === 'top' ? ' jetty-schematic__berth-stack--above-pipeline' : ''

    return (
      <div
        className={`jetty-schematic__berth-stack${isOos ? ' jetty-schematic__berth-stack--oos' : ''}${stackModifier}`}
        style={{ ['--berth-lane-height-divisor']: laneHeightDivisor }}
      >
        {isOos ? (
          <span className="jetty-schematic__oos-badge" title="Out of service — not available for new allocation.">
            OOS
          </span>
        ) : null}
        {slots.map((slot) => {
          const laneLabel = `${berthId}-${String(slot.laneIndex + 1).padStart(2, '0')}`
          const laneSuffix = String(slot.laneIndex + 1).padStart(2, '0')
          const isVacant = !slot.vesselId
          const v = slot.vesselId ? getVessel(slot.vesselId) : null
          const op = v || slot.occupant ? getOperationType(v, slot.occupant) : null
          const vacantClass = 'jetty-schematic__slot jetty-schematic__slot--vacant'
          const ragKey = v && isTodaySelected ? v.ragStatus || 'green' : 'green'
          const occClass =
            !isVacant && (v || slot.occupant)
              ? `jetty-schematic__slot jetty-schematic__slot--${op === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${ragKey}`
              : vacantClass

          let slotClassName = isVacant ? vacantClass : occClass
          if (selectedBerthId === berthId) slotClassName += ' jetty-schematic__slot--selected'
          if (isTodaySelected && v?.etcBreach) slotClassName += ' jetty-schematic__lane--etc-breach'

          const showIncomingThisVacant = isVacant && incomingNames.length > 0 && !firstVacantIncomingShown
          if (showIncomingThisVacant) firstVacantIncomingShown = true

          // Vessel-vs-jetty fit (LOA / draft / DWT) for tooltip + proportional ship length
          const loa = Number(v?.vesselLoaM)
          const vesselWidthPct =
            spec?.lengthM > 0 && Number.isFinite(loa) && loa > 0
              ? Math.max(18, Math.min(98, (loa / spec.lengthM) * 100))
              : null
          const fitLines = []
          if (!isVacant) {
            if (Number.isFinite(loa) && loa > 0) {
              fitLines.push(
                `LOA ${loa} m${spec?.lengthM ? ` / ${spec.lengthM} m${loa > spec.lengthM ? ' ⚠' : ''}` : ''}`
              )
            }
            const vDraft = Number(v?.vesselDraft)
            if (Number.isFinite(vDraft) && vDraft > 0) {
              fitLines.push(`Draft ${vDraft}${spec?.draft ? ` / ${spec.draft}${vDraft > spec.draft ? ' ⚠' : ''}` : ''}`)
            }
            const vDwt = Number(v?.vesselDwt)
            if (Number.isFinite(vDwt) && vDwt > 0) {
              fitLines.push(
                `DWT ${vDwt.toLocaleString('en-US')}${
                  spec?.dwt ? ` / ${spec.dwt.toLocaleString('en-US')}${vDwt > spec.dwt ? ' ⚠' : ''}` : ''
                }`
              )
            }
          }
          const fitSuffix = fitLines.length ? `\n${fitLines.join(' · ')}` : ''

          const tooltip = showIncomingThisVacant
            ? `${baseTooltip}\nThis lane: incoming — ${incomingLabel}`
            : isVacant
              ? `${baseTooltip}\nLane ${laneLabel}: vacant`
              : `${baseTooltip}\nLane ${laneLabel}: ${v?.vesselName || slot.occupant?.vesselName || slot.vesselId}${
                  isTodaySelected && v?.etcBreach
                    ? `\nETC breached · ${Math.round(v.etcBreach.overHours * 10) / 10}h over`
                    : ''
                }${fitSuffix}`

          const inner = isVacant ? (
            <>
              {renderLaneSuffix(laneLabel, laneSuffix)}
              <span className="jetty-slot__inner">
                <span className="jetty-slot__line">Vacant</span>
                {showIncomingThisVacant &&
                  incomingNames.slice(0, 2).map((nm) => {
                    const ir = incomingRowByName[nm]
                    const eta = ir ? formatDateTimeDisplay(ir.etaDateTime || ir.eta) : null
                    const etb = ir ? formatDateTimeDisplay(ir.etbDateTime || ir.etb) : null
                    const cargo = ir
                      ? [ir.commodityDisplay || ir.commodity, ir.totalQtyDisplay].filter(Boolean).join(' ')
                      : null
                    return (
                      <span key={nm} className="jetty-slot__line jetty-slot__line--incoming jetty-incoming__block">
                        <strong>Incoming: {nm}</strong>
                        {eta ? <span className="jetty-incoming__meta">ETA {eta}</span> : null}
                        {etb ? <span className="jetty-incoming__meta">ETB {etb}</span> : null}
                        {cargo ? <span className="jetty-incoming__meta">{cargo}</span> : null}
                      </span>
                    )
                  })}
                {showIncomingThisVacant && incomingNames.length > 2 && (
                  <span className="jetty-slot__line jetty-slot__line--incoming">
                    +{incomingNames.length - 2} more
                  </span>
                )}
              </span>
            </>
          ) : (
            <span
              className={`jetty-slot__vessel-block jetty-lane__composite jetty-lane__composite--${stackPlacement}`}
            >
              <span className="jetty-vessel" aria-hidden>
                <VesselShape widthPct={vesselWidthPct} />
              </span>
              {slotContentForSingleVessel(slot.vesselId, slot.occupant, slot.overflowCount, laneSuffix, op)}
            </span>
          )

          if (interactive) {
            const onLaneClick = isVacant
              ? () => onSelectBerth(berthId)
              : () => canSelectVessel && onSelectVessel(slot.vesselId)
            return (
              <button
                key={`${berthId}-${slot.laneIndex}`}
                type="button"
                className={`jetty-schematic__lane ${slotClassName}`}
                onClick={onLaneClick}
                title={tooltip}
                disabled={!isVacant && !canSelectVessel}
              >
                {inner}
              </button>
            )
          }

          return (
            <div
              key={`${berthId}-${slot.laneIndex}`}
              className={`jetty-schematic__lane ${slotClassName}`}
              title={tooltip}
              role="img"
              aria-label={tooltip}
            >
              {inner}
            </div>
          )
        })}
      </div>
    )
  }

  function renderBerthZone(stackPlacement, berthId, berth) {
    const stack = renderBerthLaneStack(berthId, berth, stackPlacement)
    const spec = berthIdToSpecs[berthId] || null
    const nameBand = (
      <div className="jetty-schematic__jetty-name-band">
        <span className="jetty-schematic__jetty-name-label" aria-hidden>
          {berthId}
          {spec?.lengthM ? (
            <span className="jetty-schematic__jetty-name-spec"> · {spec.lengthM} m</span>
          ) : null}
        </span>
        {renderCctvButton(berthId)}
      </div>
    )
    if (stackPlacement === 'top') {
      return (
        <div className="jetty-schematic__berth-zone jetty-schematic__berth-zone--top">
          {stack}
          {nameBand}
        </div>
      )
    }
    return (
      <div className="jetty-schematic__berth-zone jetty-schematic__berth-zone--bottom">
        {nameBand}
        {stack}
      </div>
    )
  }

  const isLoading =
    canLoadLayout && (layoutPhase === 'loading' || (layoutPhase === 'idle' && layoutColumns === null))

  const sectionClassName = `jetty-schematic-section${isPopout ? ' jetty-schematic-section--popout' : ' card'}`
  const cardTitle = !isPopout ? <h2 className="card__title">Jetty Schematic</h2> : null

  if (!canLoadLayout) {
    return (
      <section className={sectionClassName}>
        {cardTitle}
        <p className="jetty-schematic__placeholder" role="status">
          Select an operational port to view the jetty schematic.
        </p>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className={sectionClassName}>
        {cardTitle}
        <p className="jetty-schematic__placeholder jetty-schematic__placeholder--muted" role="status">
          Loading jetty layout…
        </p>
      </section>
    )
  }

  if (layoutPhase === 'error') {
    return (
      <section className={sectionClassName}>
        {cardTitle}
        <p className="jetty-schematic__placeholder" role="alert">
          Unable to load jetty layout. Please refresh the page or try again later.
        </p>
      </section>
    )
  }

  if (layoutPhase === 'empty' || !layoutColumns?.length) {
    return (
      <section className={sectionClassName}>
        {cardTitle}
        <p className="jetty-schematic__placeholder" role="status">
          {ADMIN_LAYOUT_PLACEHOLDER}
        </p>
      </section>
    )
  }

  const handleResetDate = () => {
    setSelectedDate(todayYmd)
  }

  const historicalHint =
    !isTodaySelected && selectedDate
      ? tAlloc('jettySchematicHistoricalHint', {
          date: formatDateDisplay(selectedDate),
          defaultValue: `Showing allocation for ${selectedDate}`,
        })
      : null

  return (
    <section className={sectionClassName}>
      {!isPopout ? (
        <div className="card__title-row">
          <h2 className="card__title">Jetty Schematic</h2>
          {!hidePopoutButton ? (
            <VisualizationPopoutButton mode="schematic" profile={popoutProfile} />
          ) : null}
        </div>
      ) : null}
      <div
        className="jetty-schematic__filters jetty-schedule-gantt__filters"
        role="search"
        aria-label={tAlloc('jettySchematicViewAsOf', { defaultValue: 'View as of date' })}
      >
        <div className="jetty-schedule-gantt__filter-field">
          <label htmlFor="jetty-schematic-date">
            {tAlloc('jettySchematicViewAsOf', { defaultValue: 'View as of' })}
          </label>
          <input
            id="jetty-schematic-date"
            type="date"
            className="jetty-schedule-gantt__date-input"
            max={todayYmd}
            value={selectedDate}
            onChange={handleDateChange}
          />
        </div>
        <button
          type="button"
          className="btn btn--secondary jetty-schedule-gantt__reset"
          onClick={handleResetDate}
        >
          {tAlloc('jettySchematicResetDate', { defaultValue: 'Reset' })}
        </button>
        {exportMenu || null}
      </div>
      <div
        id="allocation-export-schematic"
        ref={exportRootRef}
        className="allocation-export-schematic"
      >
      {historicalHint ? (
        <p className="jetty-schematic__historical-hint" role="status">
          {historicalHint}
        </p>
      ) : null}
      <div className="jetty-schematic__legend-row">
        <span className="jetty-schematic__date-chip">DATE : {formatDateDisplay(selectedDate)}</span>
        <span className="jetty-schematic__kpis" aria-label="Due today counters">
          {[
            { key: 'eta', label: tAlloc('kpiEtaNotArrived', { defaultValue: 'ETA by Today not yet arrived' }) },
            { key: 'etb', label: tAlloc('kpiEtbNotBerthing', { defaultValue: 'ETB by Today not yet berthing' }) },
            { key: 'etc', label: tAlloc('kpiEtcNotCompleted', { defaultValue: 'ETC by Today not yet completed' }) },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`jetty-schematic__kpi-chip jetty-schematic__kpi-chip--${key}`}
              title={`${label} — click to view in the berthing queue`}
              onClick={() => {
                const kpi = scheduleKpis[key]
                if (typeof onKpiOpen === 'function') {
                  onKpiOpen(key, kpi, selectedDate)
                } else {
                  window.location.href = `/allocation-plans?schematic_kpi=${key}&kpi_date=${selectedDate}`
                }
              }}
            >
              {label}: <strong>{scheduleKpis[key].count}</strong>
            </button>
          ))}
        </span>
        <span className="jetty-schematic__legend" aria-label="Legend">
          <span className="jetty-schematic__legend-item jetty-schematic__legend-item--load">Loading</span>
          <span className="jetty-schematic__legend-item jetty-schematic__legend-item--disch">Unloading</span>
          <span className="jetty-schematic__legend-item jetty-schematic__legend-item--vacant">Vacant</span>
        </span>
      </div>
      <div className="jetty-schematic-wrap">
        <div className="jetty-schematic">
          {layoutColumns.map((col, colIndex) => {
            const topBerthId =
              col.top?.type === 'jetty' && col.top.jettyId ? resolveBerthId(col.top.jettyId) : null
            const bottomBerthId =
              col.bottom?.type === 'jetty' && col.bottom.jettyId ? resolveBerthId(col.bottom.jettyId) : null
            const topBerth = topBerthId ? berths.find((b) => b.id === topBerthId) : null
            const bottomBerth = bottomBerthId ? berths.find((b) => b.id === bottomBerthId) : null

            // Proportional column width: longest jetty in the column drives flex-grow.
            const topLen = topBerthId ? berthIdToSpecs[topBerthId]?.lengthM : null
            const bottomLen = bottomBerthId ? berthIdToSpecs[bottomBerthId]?.lengthM : null
            const colLen = Math.max(Number(topLen) || 0, Number(bottomLen) || 0)
            const colFlexGrow = colLen > 0 ? colLen : 140

            return (
              <div key={colIndex} className="jetty-schematic__column" style={{ flexGrow: colFlexGrow }}>
                {col.top?.type === 'jetty' && topBerthId ? (
                  renderBerthZone('top', topBerthId, topBerth)
                ) : (
                  <div className="jetty-schematic__berth-zone jetty-schematic__berth-zone--placeholder">
                    <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden>
                      <span className="jetty-schematic__slot-jetty-name">—</span>
                    </div>
                  </div>
                )}
                {col.middle?.type === 'block' ? (
                  <div className="jetty-schematic__pipeline-segment" aria-hidden />
                ) : (
                  <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden>—</div>
                )}
                {col.bottom?.type === 'jetty' && bottomBerthId ? (
                  renderBerthZone('bottom', bottomBerthId, bottomBerth)
                ) : (
                  <div className="jetty-schematic__berth-zone jetty-schematic__berth-zone--placeholder">
                    <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden>
                      <span className="jetty-schematic__slot-jetty-name">—</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      </div>
    </section>
  )
}
