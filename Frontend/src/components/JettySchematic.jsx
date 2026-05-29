import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import EtcBreachBadge from './EtcBreachBadge'
import PurposeBadge from './PurposeBadge'
import { berths as defaultBerths, vessels as mockVessels } from '../data/mockData'
import { fetchJettyLayout } from '../api/jettyLayout'
import { fetchJetties } from '../api/jetties'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
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
  vesselById = {},
  incomingByJetty = {},
  selectedBerthId,
  onSelectBerth,
  onSelectVessel,
  /** Label for the second line in an occupied slot (default: SI number). */
  slotReferenceLabel = 'SI No',
}) {
  const { t } = useTranslation('pages')
  const { canApprove } = useRbac()
  const canViewJettyLiveCctv = canApprove(AT_BERTH_PAGE_KEY)
  const { selectedPortId, requiresSelection, noPortAssigned } = usePortScope()
  const canLoadLayout = selectedPortId != null && !requiresSelection && !noPortAssigned

  const [layoutColumns, setLayoutColumns] = useState(null)
  const [layoutPhase, setLayoutPhase] = useState('idle')
  const [jettyIdToBerthId, setJettyIdToBerthId] = useState({})
  const [berthIdToRtspLink, setBerthIdToRtspLink] = useState({})

  useEffect(() => {
    if (!canLoadLayout) {
      setLayoutColumns(null)
      setLayoutPhase('no-port')
      setJettyIdToBerthId({})
      setBerthIdToRtspLink({})
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
        for (const j of Array.isArray(jetList) ? jetList : []) {
          if (j?.id == null) continue
          const bid = jettyNameToBerthId(j.name)
          if (bid) {
            idMap[String(j.id)] = bid
            const link = typeof j.rtspLink === 'string' ? j.rtspLink.trim() : ''
            if (link) rtspMap[bid] = link
          }
        }
        setJettyIdToBerthId(idMap)
        setBerthIdToRtspLink(rtspMap)

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

  const berths = berthsProp ?? defaultBerths
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

  function slotContentForSingleVessel(vesselId, occupant, overflowCount) {
    const v = getVessel(vesselId)
    const displayName = v?.vesselName || occupant?.vesselName || String(vesselId || '—')
    if (!vesselId) return 'Vacant'
    const siRef = v?.siId ?? '—'
    const materialDisplay = formatMaterialDisplay(v)
    return (
      <span className="jetty-slot__inner">
        <span className="jetty-slot__title">{displayName}</span>
        <span className="jetty-slot__line jetty-slot__line--purpose">
          <PurposeBadge purpose={v?.purpose} loadDischarge={v?.loadDischarge} />
        </span>
        <span className="jetty-slot__line jetty-slot__line--plan-ref">
          {slotReferenceLabel}: {siRef}
        </span>
        <span className="jetty-slot__line jetty-slot__line--material">
          Material : {materialDisplay}
        </span>
        {overflowCount > 0 && (
          <span className="jetty-slot__line jetty-slot__line--overflow">+{overflowCount} more</span>
        )}
      </span>
    )
  }

  function renderLaneEtcBadge(v) {
    if (!v?.etcBreach) return null
    return (
      <EtcBreachBadge
        overMs={v.etcBreach.overMs}
        etcMs={v.etcBreach.etcMs}
        size="icon-only"
        className="jetty-schematic__lane-etc"
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
    const occIds = berthOccupantIds(berth)
    const occNames = occIds.map((id) => getVessel(id)?.vesselName || berth?.currentVesselName || id).filter(Boolean)
    const incomingNames = formatIncomingList(incomingByJetty[berthId])
    const incomingLabel = incomingNames.length ? incomingNames.join(', ') : '—'
    const isOos = (berth?.status || '') === 'Out of Service'
    const baseTooltip = isOos
      ? `Out of service — not available for new allocation.\n${jettyTooltip(berthId, cap, occIds, occNames, incomingLabel)}`
      : jettyTooltip(berthId, cap, occIds, occNames, incomingLabel)

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
          const op = v ? getOperationType(v, slot.occupant) : null
          const vacantClass = 'jetty-schematic__slot jetty-schematic__slot--vacant'
          const occClass = v
            ? `jetty-schematic__slot jetty-schematic__slot--${op === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${v.ragStatus || 'green'}`
            : vacantClass

          let slotClassName = isVacant ? vacantClass : occClass
          if (selectedBerthId === berthId) slotClassName += ' jetty-schematic__slot--selected'
          if (v?.etcBreach) slotClassName += ' jetty-schematic__lane--etc-breach'

          const showIncomingThisVacant = isVacant && incomingNames.length > 0 && !firstVacantIncomingShown
          if (showIncomingThisVacant) firstVacantIncomingShown = true

          const tooltip = showIncomingThisVacant
            ? `${baseTooltip}\nThis lane: incoming — ${incomingLabel}`
            : isVacant
              ? `${baseTooltip}\nLane ${laneLabel}: vacant`
              : `${baseTooltip}\nLane ${laneLabel}: ${v?.vesselName || slot.occupant?.vesselName || slot.vesselId}${
                  v?.etcBreach
                    ? `\nETC breached · ${Math.round(v.etcBreach.overHours * 10) / 10}h over`
                    : ''
                }`

          const inner = isVacant ? (
            <>
              {renderLaneSuffix(laneLabel, laneSuffix)}
              <span className="jetty-slot__inner">
                <span className="jetty-slot__line">Vacant</span>
                {showIncomingThisVacant && (
                  <span className="jetty-slot__line jetty-slot__line--incoming">Incoming: {incomingLabel}</span>
                )}
              </span>
            </>
          ) : (
            <>
              {renderLaneSuffix(laneLabel, laneSuffix)}
              {renderLaneEtcBadge(v)}
              <span className="jetty-slot__vessel-block">
                {slotContentForSingleVessel(slot.vesselId, slot.occupant, slot.overflowCount)}
              </span>
            </>
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
    const nameBand = (
      <div className="jetty-schematic__jetty-name-band">
        <span className="jetty-schematic__jetty-name-label" aria-hidden>
          {berthId}
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

  if (!canLoadLayout) {
    return (
      <section className="card jetty-schematic-section">
        <h2 className="card__title">Jetty Schematic</h2>
        <p className="jetty-schematic__placeholder" role="status">
          Select an operational port to view the jetty schematic.
        </p>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className="card jetty-schematic-section">
        <h2 className="card__title">Jetty Schematic</h2>
        <p className="jetty-schematic__placeholder jetty-schematic__placeholder--muted" role="status">
          Loading jetty layout…
        </p>
      </section>
    )
  }

  if (layoutPhase === 'error') {
    return (
      <section className="card jetty-schematic-section">
        <h2 className="card__title">Jetty Schematic</h2>
        <p className="jetty-schematic__placeholder" role="alert">
          Unable to load jetty layout. Please refresh the page or try again later.
        </p>
      </section>
    )
  }

  if (layoutPhase === 'empty' || !layoutColumns?.length) {
    return (
      <section className="card jetty-schematic-section">
        <h2 className="card__title">Jetty Schematic</h2>
        <p className="jetty-schematic__placeholder" role="status">
          {ADMIN_LAYOUT_PLACEHOLDER}
        </p>
      </section>
    )
  }

  return (
    <section className="card jetty-schematic-section">
      <h2 className="card__title">Jetty Schematic</h2>
      <div className="jetty-schematic-wrap">
        <div className="jetty-schematic">
          {layoutColumns.map((col, colIndex) => {
            const topBerthId =
              col.top?.type === 'jetty' && col.top.jettyId ? resolveBerthId(col.top.jettyId) : null
            const bottomBerthId =
              col.bottom?.type === 'jetty' && col.bottom.jettyId ? resolveBerthId(col.bottom.jettyId) : null
            const topBerth = topBerthId ? berths.find((b) => b.id === topBerthId) : null
            const bottomBerth = bottomBerthId ? berths.find((b) => b.id === bottomBerthId) : null

            return (
              <div key={colIndex} className="jetty-schematic__column">
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
    </section>
  )
}
