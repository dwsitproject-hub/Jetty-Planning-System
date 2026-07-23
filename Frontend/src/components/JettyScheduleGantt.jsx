import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import html2canvas from 'html2canvas'
import { formatDateDisplay, formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  toDateInputValue,
  parseDateInputStart,
  parseDateInputEndExclusive,
} from '../utils/jettyScheduleOccupancy'
import { buildScheduleSegments, assignBankLanesByVessel } from '../utils/jettyScheduleGanttLanes'
import VisualizationPopoutButton from './VisualizationPopoutButton'
import GanttDenseBlock from './GanttDenseBlock'
import {
  buildActualBlockModel,
  buildPlannedBlockModel,
  ganttDenseBlockAriaLabel,
  GANTT_BAR_STACK_STEP,
} from '../utils/ganttBarDisplay.js'
import {
  buildGanttDragProposal,
  buildArrivalPayloadFromProposal,
  jettyIdFromRowKey,
  snapDeltaMs,
  GANTT_DRAG_THRESHOLD_PX,
} from '../utils/ganttDragProposal.js'
import { saveArrivalUpdate as saveArrivalUpdateApi } from '../api/allocation'
import { ApiError } from '../api/client'
import { useRbac } from '../context/RbacContext'
import '../styles/dashboard.css'
import '../styles/etc-breach.css'

/** Default +3 calendar days from planned/actual start when completions unknown (display only) */
const MAX_RANGE_MS = 548 * 24 * 60 * 60 * 1000
const DAY_COL_MIN = 72

function defaultDateRangeInputs() {
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0, 0, 0, 0, 0)
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

function buildDateColumns(windowStartMs, windowEndMs) {
  const cols = []
  const cur = new Date(windowStartMs)
  cur.setHours(0, 0, 0, 0)
  while (cur.getTime() < windowEndMs) {
    const dayStart = new Date(cur)
    const colStart = Math.max(dayStart.getTime(), windowStartMs)
    const nextDay = new Date(dayStart)
    nextDay.setDate(nextDay.getDate() + 1)
    const colEnd = Math.min(nextDay.getTime(), windowEndMs)
    if (colStart < colEnd) {
      cols.push({
        key: `${dayStart.getFullYear()}-${dayStart.getMonth() + 1}-${dayStart.getDate()}`,
        label: `${dayStart.getDate()} ${dayStart.toLocaleDateString('en-GB', { month: 'short' })}`,
        title: `${dayStart.toLocaleDateString('en-GB', { weekday: 'short' })}, ${formatDateDisplay(dayStart)}`,
        startMs: colStart,
        endMs: colEnd,
      })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return cols
}

/** Position segment on the full timeline (0–100% of filtered range). */
function segmentTrackStyle(seg, windowStartMs, totalMs) {
  if (totalMs <= 0) return null
  const leftPct = ((seg.startMs - windowStartMs) / totalMs) * 100
  const rawWidthPct = ((seg.endMs - seg.startMs) / totalMs) * 100
  const w = Math.max(0.12, Math.min(100 - Math.max(0, leftPct), rawWidthPct))
  const l = Math.max(0, Math.min(100 - w, leftPct))
  return {
    left: `${l}%`,
    width: `${w}%`,
    rawWidthPct,
  }
}

function segmentColorClass(seg) {
  const st = (seg.status || 'arriving').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const layer = seg.layer
  const grad = seg.gradient ? 'grad' : 'solid'
  return `jetty-schedule-gantt__bar--${layer}-${grad} jetty-schedule-gantt__bar--st-${st}`
}

function segmentPillClass(seg) {
  const overdueMod = seg.etcOverdue ? ' jetty-schedule-gantt__bar--actual-etc-overdue' : ''
  return `jetty-schedule-gantt__bar ${segmentColorClass(seg)}${overdueMod}`
}

function ganttBarInlineStyle(seg, posStyle, stackIndex) {
  return {
    ...posStyle,
    top: `${6 + stackIndex * GANTT_BAR_STACK_STEP}px`,
    ...(seg.etcOverdue && seg.etcOverduePct != null
      ? { '--etc-overdue-start': `${seg.etcOverduePct}%` }
      : {}),
  }
}

function ganttBarAriaLabel(seg, layer) {
  const model =
    layer === 'planned' ? buildPlannedBlockModel(seg) : buildActualBlockModel(seg, null)
  return ganttDenseBlockAriaLabel(model, layer)
}

function renderDenseBarContent(seg, layer, barWidthPct, sourceRow = null) {
  const model =
    layer === 'planned'
      ? buildPlannedBlockModel(seg)
      : buildActualBlockModel(seg, sourceRow)
  return <GanttDenseBlock layer={layer} model={model} barWidthPct={barWidthPct} />
}

function findScheduleSourceRow(listRows, seg) {
  if (!Array.isArray(listRows)) return null
  return listRows.find((r) => {
    if (r.vesselId === seg.vesselId) return true
    if (seg.bankLaneKey && r.vesselId === seg.bankLaneKey) return true
    if (
      seg.bankLaneKey &&
      r.shipmentPlanId != null &&
      seg.bankLaneKey === `plan-${r.shipmentPlanId}`
    ) {
      return true
    }
    return false
  })
}

/** "+6h 30m" / "-1d 2h" for the drag badge. */
function formatDragDelta(deltaMs) {
  const sign = deltaMs < 0 ? '-' : '+'
  let rest = Math.abs(deltaMs)
  const d = Math.floor(rest / 86400000)
  rest -= d * 86400000
  const h = Math.floor(rest / 3600000)
  rest -= h * 3600000
  const m = Math.round(rest / 60000)
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (!parts.length) parts.push('0m')
  return `${sign}${parts.join(' ')}`
}

export default function JettyScheduleGantt({
  berthIds,
  berthsState,
  list,
  onSelectVessel,
  onScheduleChanged,
  popoutProfile = 'plan',
  hidePopoutButton = false,
  isPopout = false,
}) {
  const { t: tAlloc } = useTranslation('allocation')
  const def = useMemo(() => defaultDateRangeInputs(), [])
  const [dateFrom, setDateFrom] = useState(def.from)
  const [dateTo, setDateTo] = useState(def.to)

  const rbac = useRbac() || {}
  const canEditSchedule =
    typeof rbac.canEdit === 'function' ? Boolean(rbac.canEdit('allocation-plan')) : false

  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const nowMs = Date.now()

  const { windowStartMs, windowEndMs, dateColumns, baseSegments, totalMs, rangeError } = useMemo(() => {
    const plan = Array.isArray(list) ? list : []
    const wStart = parseDateInputStart(dateFrom)
    const wEnd = parseDateInputEndExclusive(dateTo)
    if (wStart == null || wEnd == null) {
      return {
        windowStartMs: 0,
        windowEndMs: 0,
        dateColumns: [],
        baseSegments: [],
        totalMs: 0,
        rangeError: 'Please select valid start and end dates.',
      }
    }
    if (wStart >= wEnd) {
      return {
        windowStartMs: wStart,
        windowEndMs: wEnd,
        dateColumns: [],
        baseSegments: [],
        totalMs: 0,
        rangeError: 'End date must be after start date.',
      }
    }
    if (wEnd - wStart > MAX_RANGE_MS) {
      return {
        windowStartMs: wStart,
        windowEndMs: wEnd,
        dateColumns: [],
        baseSegments: [],
        totalMs: 0,
        rangeError: 'Date range is too large (maximum about 18 months). Please narrow the filter.',
      }
    }
    const cols = buildDateColumns(wStart, wEnd)
    const barList = buildScheduleSegments(plan, wStart, wEnd, nowMs)
    return {
      windowStartMs: wStart,
      windowEndMs: wEnd,
      dateColumns: cols,
      baseSegments: barList,
      totalMs: wEnd - wStart,
      rangeError: null,
    }
  }, [list, dateFrom, dateTo, tick])

  const rowDefs = useMemo(() => {
    const berths = Array.isArray(berthsState) ? berthsState : []
    const byId = new Map(berths.map((b) => [b.id, b]))
    const out = []
    for (const jettyId of Array.isArray(berthIds) ? berthIds : []) {
      const b = byId.get(jettyId)
      const capRaw = b?.capacity != null ? Number(b.capacity) : 1
      const cap = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : 1
      for (let i = 0; i < cap; i += 1) {
        out.push({
          jettyId,
          laneIndex: i,
          rowKey: `${jettyId}__${i}`,
          label: `${jettyId}-${String(i + 1).padStart(2, '0')}`,
          capacity: cap,
        })
      }
    }
    return out
  }, [berthIds, berthsState])

  const segments = useMemo(() => {
    const listRows = Array.isArray(list) ? list : []
    return assignBankLanesByVessel(baseSegments, rowDefs, listRows, Date.now())
  }, [baseSegments, rowDefs, list, tick])

  const nowFraction =
    totalMs > 0 ? Math.min(1, Math.max(0, (nowMs - windowStartMs) / totalMs)) : 0
  const showNowLine = rangeError == null && nowMs >= windowStartMs && nowMs <= windowEndMs

  const nCols = dateColumns.length
  const gridTemplateColumns =
    nCols > 0
      ? `minmax(160px, 200px) repeat(${nCols}, minmax(${DAY_COL_MIN}px, ${DAY_COL_MIN}px))`
      : 'minmax(160px, 200px)'

  const handleResetRange = () => {
    const next = defaultDateRangeInputs()
    setDateFrom(next.from)
    setDateTo(next.to)
  }

  const exportRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  // ---- Drag-to-reschedule state ----------------------------------------------------------
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const pendingOpenedAtRef = useRef(0)
  const [pendingChange, setPendingChange] = useState(null) // { proposal, seg, row }
  const [pendingChoice, setPendingChoice] = useState('estimation')
  const [pendingSaving, setPendingSaving] = useState(false)
  const [pendingSaveError, setPendingSaveError] = useState(null)
  const [notice, setNotice] = useState(null)
  // After a confirmed move the bar can land on another lane/row (lanes are
  // auto-assigned) — scroll it into view and flash it so it never "disappears".
  const [flashVesselId, setFlashVesselId] = useState(null)

  useEffect(() => {
    if (!flashVesselId) return undefined
    // setTimeout, not requestAnimationFrame: rAF never fires in hidden/background
    // tabs, which would leave the flash pending forever.
    const locate = setTimeout(() => {
      const el = document.querySelector(
        `.jetty-schedule-gantt__bar[data-vessel-bar="${CSS.escape(String(flashVesselId))}"]`
      )
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
        el.classList.add('jetty-schedule-gantt__bar--flash')
        setTimeout(() => el.classList.remove('jetty-schedule-gantt__bar--flash'), 3200)
      }
      setFlashVesselId(null)
    }, 60)
    return () => clearTimeout(locate)
  }, [flashVesselId, segments])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(id)
  }, [notice])

  const cleanupDragVisuals = (d) => {
    if (!d) return
    if (d.listeners) {
      window.removeEventListener('pointermove', d.listeners.onMove)
      window.removeEventListener('pointerup', d.listeners.onUp)
      window.removeEventListener('pointercancel', d.listeners.onCancel)
    }
    if (d.barEl) {
      d.barEl.classList.remove('jetty-schedule-gantt__bar--dragging')
      d.barEl.style.transform = ''
    }
    if (d.badgeEl && d.badgeEl.parentNode) d.badgeEl.parentNode.removeChild(d.badgeEl)
    if (d.lastRowEl) d.lastRowEl.classList.remove('jetty-schedule-gantt__row--drop-target')
  }

  // Safety net: never leave a drag half-finished if the component unmounts mid-gesture.
  useEffect(
    () => () => {
      cleanupDragVisuals(dragRef.current)
      dragRef.current = null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const findDropRowEl = (x, y, ignoreEl) => {
    const els = document.elementsFromPoint(x, y)
    for (const el of els) {
      // The dragged bar is translated under the cursor — resolving through it would
      // always land on its ORIGINAL row and silently swallow the jetty change.
      if (ignoreEl && (el === ignoreEl || ignoreEl.contains(el))) continue
      if (el instanceof HTMLElement && el.dataset && el.dataset.ganttRow) return el
      const host = el instanceof Element ? el.closest('[data-gantt-row]') : null
      if (host && (!ignoreEl || !ignoreEl.contains(host))) return host
    }
    return null
  }

  const updateDragBadge = (d, e) => {
    const snapped = snapDeltaMs(d.rawDeltaMs)
    const startLabel = formatDateTimeDisplay(new Date(d.seg.startMs + snapped).toISOString())
    const parts = []
    if (d.kind === 'resize-end') {
      const endLabel = formatDateTimeDisplay(new Date(d.seg.endMs + snapped).toISOString())
      parts.push(`${formatDragDelta(snapped)} → ETC ${endLabel}`)
    } else {
      parts.push(`${formatDragDelta(snapped)} → ${startLabel}`)
    }
    if (d.kind === 'move' && d.targetJettyId && d.targetJettyId !== d.seg.jettyId) {
      parts.push(`⚓ ${d.seg.jettyId} → ${d.targetJettyId}`)
    }
    d.badgeEl.textContent = parts.join('   ')
    d.badgeEl.style.left = `${e.clientX + 14}px`
    d.badgeEl.style.top = `${e.clientY + 16}px`
  }

  const handleBarPointerDown = (e, seg, row) => {
    if (!canEditSchedule || exporting || !row) return
    if (e.button != null && e.button !== 0) return
    // A previous gesture may not have seen its pointerup (released outside the
    // window without capture) — never let a stale drag corrupt the new one.
    if (dragRef.current) {
      cleanupDragVisuals(dragRef.current)
      dragRef.current = null
    }
    const barEl = e.currentTarget
    const trackEl = barEl.closest('.jetty-schedule-gantt__track')
    if (!trackEl || totalMs <= 0) return
    const handleEl =
      e.target instanceof Element ? e.target.closest('[data-gantt-handle]') : null
    // On very narrow bars the edge handles would cover everything — treat as move.
    const barWide = barEl.getBoundingClientRect().width >= 36
    const kind =
      handleEl && barWide
        ? handleEl.dataset.ganttHandle === 'start'
          ? 'resize-start'
          : 'resize-end'
        : 'move'
    if (typeof e.preventDefault === 'function') e.preventDefault()
    const trackRect = trackEl.getBoundingClientRect()
    // Capture immediately: a real cursor leaves the (thin) bar/handle almost at once,
    // so waiting for a threshold move ON the element would silently kill the gesture.
    try {
      barEl.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    // Track the rest of the gesture on window, not the bar: this survives the cursor
    // leaving the element, lost/failed pointer capture, and re-renders mid-drag.
    const onMove = (ev) => handleBarPointerMove(ev)
    const onUp = (ev) => handleBarPointerEnd(ev)
    const onCancel = (ev) => handleBarPointerEnd(ev, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    dragRef.current = {
      pointerId: e.pointerId,
      kind,
      seg,
      row,
      barEl,
      startX: e.clientX,
      startY: e.clientY,
      pxPerMs: trackRect.width / totalMs,
      started: false,
      rawDeltaMs: 0,
      targetJettyId: null,
      badgeEl: null,
      lastRowEl: null,
      listeners: { onMove, onUp, onCancel },
    }
  }

  const handleBarPointerMove = (e) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    // Button no longer held → we missed the pointerup (released outside the window).
    // Finish the gesture from where it is instead of ghost-dragging forever.
    if (e.buttons != null && e.buttons === 0) {
      handleBarPointerEnd(e, !d.started)
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.started) {
      if (Math.abs(dx) < GANTT_DRAG_THRESHOLD_PX && Math.abs(dy) < GANTT_DRAG_THRESHOLD_PX) return
      d.started = true
      const badge = document.createElement('div')
      badge.className = 'jetty-schedule-gantt__drag-badge'
      document.body.appendChild(badge)
      d.badgeEl = badge
    }
    // Re-add every move: a data-refresh re-render mid-drag resets className.
    d.barEl.classList.add('jetty-schedule-gantt__bar--dragging')
    d.rawDeltaMs = d.pxPerMs > 0 ? dx / d.pxPerMs : 0
    if (d.kind === 'move') {
      const snappedPx = snapDeltaMs(d.rawDeltaMs) * d.pxPerMs
      d.barEl.style.transform = `translate(${snappedPx}px, ${dy}px)`
      const rowEl = findDropRowEl(e.clientX, e.clientY, d.barEl)
      if (d.lastRowEl && d.lastRowEl !== rowEl) {
        d.lastRowEl.classList.remove('jetty-schedule-gantt__row--drop-target')
      }
      if (rowEl && rowEl !== d.lastRowEl) {
        rowEl.classList.add('jetty-schedule-gantt__row--drop-target')
      }
      d.lastRowEl = rowEl || null
      d.targetJettyId = rowEl ? jettyIdFromRowKey(rowEl.dataset.ganttRow) : null
    }
    updateDragBadge(d, e)
  }

  const handleBarPointerEnd = (e, cancelled = false) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    cleanupDragVisuals(d)
    if (!d.started) return
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, 150)
    if (cancelled) return
    const proposal = buildGanttDragProposal({
      kind: d.kind,
      deltaMs: snapDeltaMs(d.rawDeltaMs),
      seg: d.seg,
      row: d.row,
      targetJettyId: d.targetJettyId,
    })
    if (!proposal) {
      // Give feedback instead of a silent snap-back (e.g. dropped on another lane
      // of the SAME jetty, or the time shift rounded to zero).
      setNotice(
        tAlloc('ganttDragNoChange', {
          defaultValue:
            'No change to apply — same jetty and no time shift (lanes within a jetty are assigned automatically).',
        })
      )
      return
    }
    // Default to the family that positions the bar: blue (actual) bars sit on TA/TB,
    // so confirming the default makes the bar stay where it was dropped.
    const preferActual = d.seg.layer === 'actual' && proposal.canActual
    setPendingChoice(
      preferActual
        ? 'actual'
        : proposal.canEstimation
          ? 'estimation'
          : proposal.canActual
            ? 'actual'
            : 'estimation'
    )
    setPendingSaveError(null)
    pendingOpenedAtRef.current = Date.now()
    setPendingChange({ proposal, seg: d.seg, row: d.row })
  }

  const closePendingChange = () => {
    if (pendingSaving) return
    setPendingChange(null)
    setPendingSaveError(null)
  }

  // The dialog renders synchronously between the drop's pointerup and the browser's
  // trailing click — that click can land on the full-screen overlay and close the
  // dialog before the user ever sees it. Ignore overlay clicks right after opening,
  // and only close when the click is on the overlay itself (not bubbled/retargeted).
  const handleOverlayClick = (e) => {
    if (e.target !== e.currentTarget) return
    if (Date.now() - pendingOpenedAtRef.current < 400) return
    closePendingChange()
  }

  const handleConfirmPendingChange = async () => {
    if (!pendingChange) return
    const { proposal, row } = pendingChange
    const choice = proposal.needsChoice
      ? pendingChoice
      : proposal.canEstimation
        ? 'estimation'
        : proposal.canActual
          ? 'actual'
          : 'none'
    setPendingSaving(true)
    setPendingSaveError(null)
    try {
      await saveArrivalUpdateApi(
        buildArrivalPayloadFromProposal(proposal, choice, row, 'allocation-plan')
      )
      setPendingChange(null)
      setNotice(tAlloc('ganttDragSaved', { defaultValue: 'Schedule updated.' }))
      if (typeof onScheduleChanged === 'function') {
        await Promise.resolve(onScheduleChanged()).catch(() => {})
      }
      setFlashVesselId(row?.vesselId ?? null)
    } catch (err) {
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : tAlloc('ganttDragSaveFailed', { defaultValue: 'Update failed. Please try again.' })
      setPendingSaveError(msg)
    } finally {
      setPendingSaving(false)
    }
  }
  // ----------------------------------------------------------------------------------------

  const handleExportJpeg = async () => {
    const node = exportRef.current
    if (!node || rangeError) return
    setExporting(true)
    // Lay out the full chart (no scroll cap), with an EXPLICIT pixel width taken from the
    // matrix so we avoid `max-content` intrinsic-sizing (which loops with the bars'
    // min-width:max-content and hangs the canvas renderer).
    const matrix = node.querySelector('.jetty-schedule-gantt__matrix')
    const fullWidth = Math.ceil((matrix ? matrix.scrollWidth : node.scrollWidth) + 16)
    node.classList.add('jetty-schedule-gantt__export-area--capturing')
    node.style.width = `${fullWidth}px`
    let objectUrl = null
    try {
      void node.offsetHeight
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const width = Math.ceil(node.scrollWidth)
      const height = Math.ceil(node.scrollHeight)
      // Guard against any renderer hang so the button never stays stuck on "Exporting…".
      const canvas = await Promise.race([
        html2canvas(node, {
          backgroundColor: '#ffffff',
          scale: 1.5,
          useCORS: true,
          logging: false,
          width,
          height,
          windowWidth: width,
          windowHeight: height,
          scrollX: 0,
          scrollY: 0,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('export timed out')), 60000)
        ),
      ])
      // Blob + object URL downloads reliably even for large (multi-MB) images, unlike a data URL.
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95))
      if (!blob) throw new Error('canvas.toBlob returned null')
      objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `jetty-schedule_${dateFrom}_to_${dateTo}.jpeg`
      link.href = objectUrl
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Jetty schedule JPEG export failed:', err)
    } finally {
      node.classList.remove('jetty-schedule-gantt__export-area--capturing')
      node.style.width = ''
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
      setExporting(false)
    }
  }

  const renderScheduleLane = (rowKey) => {
    const segs = segments
      .filter((s) => s.rowKey === rowKey)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    const listRows = Array.isArray(list) ? list : []
    // Bars only stack vertically when they OVERLAP in time; sequential vessels
    // share the same baseline so "after" reads as one continuous lane.
    const levelEnds = []
    const stackIndexBySeg = segs.map((seg) => {
      let level = levelEnds.findIndex((endMs) => seg.startMs >= endMs)
      if (level === -1) {
        level = levelEnds.length
        levelEnds.push(seg.endMs)
      } else {
        levelEnds[level] = seg.endMs
      }
      return level
    })
    const laneH = Math.max(30, 8 + Math.max(1, levelEnds.length) * GANTT_BAR_STACK_STEP)
    return (
      <div
        className="jetty-schedule-gantt__track jetty-schedule-gantt__track--actual"
        style={{ minHeight: `${laneH}px` }}
      >
        {segs.map((seg, i) => {
          const pos = segmentTrackStyle(seg, windowStartMs, totalMs)
          if (!pos) return null
          const { rawWidthPct: _rawWidthPct, ...posStyle } = pos
          const style = ganttBarInlineStyle(seg, posStyle, stackIndexBySeg[i])

          const barLayer = seg.layer === 'planned' ? 'planned' : 'actual'
          const pillClass = segmentPillClass(seg)
          const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
          const sourceRow = findScheduleSourceRow(listRows, seg)
          const canDrag = Boolean(canEditSchedule && sourceRow)
          const isSailed = seg.status === 'Sailed off'
          const showEndHandle =
            canDrag && !isSailed && sourceRow &&
            (sourceRow.operationId != null || sourceRow.shippingInstructionId != null)
          const ariaLabel = ganttBarAriaLabel(seg, barLayer)
          const barClassName = `${pillClass}${canClick ? ' jetty-schedule-gantt__bar--btn' : ''}${canDrag ? ' jetty-schedule-gantt__bar--draggable' : ''}`
          const denseContent = renderDenseBarContent(
            seg,
            barLayer,
            _rawWidthPct,
            barLayer === 'actual' ? sourceRow : null
          )
          const handles = canDrag ? (
            <>
              <span
                className="jetty-schedule-gantt__bar-handle jetty-schedule-gantt__bar-handle--start"
                data-gantt-handle="start"
                aria-hidden
              />
              {showEndHandle ? (
                <span
                  className="jetty-schedule-gantt__bar-handle jetty-schedule-gantt__bar-handle--end"
                  data-gantt-handle="end"
                  aria-hidden
                />
              ) : null}
            </>
          ) : null
          const dragProps = canDrag
            ? { onPointerDown: (e) => handleBarPointerDown(e, seg, sourceRow) }
            : {}

          const vesselBarId = sourceRow?.vesselId ?? seg.vesselId ?? undefined
          if (canClick) {
            return (
              <button
                key={`${seg.layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
                type="button"
                className={barClassName}
                style={style}
                data-vessel-bar={vesselBarId}
                aria-label={ariaLabel}
                onClick={() => {
                  if (suppressClickRef.current) return
                  onSelectVessel(seg.vesselId)
                }}
                {...dragProps}
              >
                {denseContent}
                {handles}
              </button>
            )
          }
          return (
            <span
              key={`${seg.layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
              className={barClassName}
              style={style}
              data-vessel-bar={vesselBarId}
              role="img"
              aria-label={ariaLabel}
              {...dragProps}
            >
              {denseContent}
              {handles}
            </span>
          )
        })}
      </div>
    )
  }

  const legendContent = (
    <>
      <span className="allocation-schedule__legend-item">
        <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--actual-solid" />
        {tAlloc('ganttLegendActual', { defaultValue: 'Actual' })}
      </span>
      <span className="allocation-schedule__legend-item">
        <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--planned-solid" />
        {tAlloc('ganttLegendEstimate', { defaultValue: 'Estimate (no actual yet)' })}
      </span>
      <span className="allocation-schedule__legend-item">
        <span className="jetty-schedule-gantt__legend-chip jetty-schedule-gantt__legend-chip--late" aria-hidden>
          {tAlloc('ganttLateChip', { defaultValue: 'LATE' })}
        </span>
        {tAlloc('ganttLegendLatePastEtc', { defaultValue: 'Late (past ETC)' })}
      </span>
      <span className="allocation-schedule__legend-item">
        <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--status-sailed-off" />
        {tAlloc('ganttLegendSailed', { defaultValue: 'Sailed off' })}
      </span>
      <span className="allocation-schedule__legend-item">
        <span className="jetty-schedule-gantt__now-dot" aria-hidden /> {tAlloc('ganttLegendNow', { defaultValue: 'Now' })}
      </span>
    </>
  )

  const pendingProposal = pendingChange?.proposal ?? null
  const pendingTargetBerth = pendingProposal?.jettyChange
    ? (Array.isArray(berthsState) ? berthsState : []).find(
        (b) => b.id === pendingProposal.jettyChange.to
      )
    : null
  const pendingTargetOcc = pendingTargetBerth
    ? Number(pendingTargetBerth.occupiedCount ?? (pendingTargetBerth.currentVesselId ? 1 : 0)) || 0
    : 0
  const pendingTargetCap =
    pendingTargetBerth && pendingTargetBerth.capacity != null
      ? Math.max(1, Number(pendingTargetBerth.capacity) || 1)
      : 1
  const pendingTargetFull = Boolean(pendingTargetBerth) && pendingTargetOcc >= pendingTargetCap
  const pendingDateChanges = pendingProposal
    ? pendingProposal.needsChoice
      ? pendingChoice === 'actual'
        ? pendingProposal.actual
        : pendingProposal.estimation
      : [...pendingProposal.estimation, ...(pendingProposal.canActual ? pendingProposal.actual : [])]
    : []
  const pendingAllChanges = pendingProposal
    ? [...pendingDateChanges, ...pendingProposal.always]
    : []

  return (
    <section className={`jetty-schedule-gantt${isPopout ? ' jetty-schedule-gantt--popout' : ' card'}`}>
      {!isPopout ? (
        <div className="card__title-row">
          <h2 className="card__title">Jetty schedule</h2>
          {!hidePopoutButton ? (
            <VisualizationPopoutButton mode="schedule" profile={popoutProfile} />
          ) : null}
        </div>
      ) : null}

      <div className="jetty-schedule-gantt__filters" role="search" aria-label="Schedule date range">
        <div className="jetty-schedule-gantt__filter-field">
          <label htmlFor="jetty-schedule-from">From</label>
          <input
            id="jetty-schedule-from"
            type="date"
            className="jetty-schedule-gantt__date-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="jetty-schedule-gantt__filter-field">
          <label htmlFor="jetty-schedule-to">To</label>
          <input
            id="jetty-schedule-to"
            type="date"
            className="jetty-schedule-gantt__date-input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn--secondary jetty-schedule-gantt__reset" onClick={handleResetRange}>
          Reset
        </button>
        <button
          type="button"
          className="btn btn--secondary jetty-schedule-gantt__export"
          onClick={handleExportJpeg}
          disabled={exporting || Boolean(rangeError)}
          title={tAlloc('ganttExportJpegHint', { defaultValue: 'Export the current view (date range) as a JPEG image' })}
        >
          {exporting
            ? tAlloc('exportExporting', { defaultValue: 'Exporting…' })
            : tAlloc('exportButton', { defaultValue: 'Export' })}
        </button>
      </div>

      <p className="jetty-schedule-gantt__intro">
        {rangeError ? <span className="jetty-schedule-gantt__error">{rangeError}</span> : null}
        {!rangeError && notice ? (
          <span className="jetty-schedule-gantt__notice" role="status">
            {notice}
          </span>
        ) : null}
      </p>

      <div className="jetty-schedule-gantt__export-area" ref={exportRef}>
        {exporting ? (
          <div className="jetty-schedule-gantt__export-title">
            {tAlloc('jettySchedule', { defaultValue: 'Jetty schedule' })} · {dateFrom} → {dateTo}
          </div>
        ) : null}
        {isPopout ? (
        <details className="jetty-schedule-gantt__legend-details">
          <summary>{tAlloc('vizPopoutLegend', { defaultValue: 'Legend' })}</summary>
          <div className="allocation-schedule__legend jetty-schedule-gantt__legend jetty-schedule-gantt__legend--two">
            {legendContent}
          </div>
        </details>
      ) : (
        <div className="allocation-schedule__legend jetty-schedule-gantt__legend jetty-schedule-gantt__legend--two">
          {legendContent}
        </div>
      )}

      <div className="jetty-schedule-gantt__scroll">
        <div
          className="jetty-schedule-gantt__matrix"
          style={nCols > 0 ? { minWidth: `${200 + nCols * DAY_COL_MIN}px` } : undefined}
        >
          {rangeError ? (
            <p className="jetty-schedule-gantt__empty">Adjust the date range above to see the chart.</p>
          ) : nCols === 0 ? (
            <p className="jetty-schedule-gantt__empty">No date range available.</p>
          ) : (
            <>
              <div className="jetty-schedule-gantt__header-row" style={{ gridTemplateColumns }}>
                <div className="jetty-schedule-gantt__corner">JETTY ID</div>
                {dateColumns.map((col) => (
                  <div key={col.key} className="jetty-schedule-gantt__th-day" title={col.title}>
                    {col.label}
                  </div>
                ))}
              </div>

              <div className="jetty-schedule-gantt__body">
                <div className="jetty-schedule-gantt__body-inner">
                  {showNowLine && (
                    <div
                      className="jetty-schedule-gantt__now-line"
                      title={`Now: ${formatDateTimeDisplay(new Date(nowMs).toISOString())}`}
                      style={{
                        left: `calc(var(--jetty-schedule-id-col, 200px) + (100% - var(--jetty-schedule-id-col, 200px)) * ${nowFraction})`,
                      }}
                    />
                  )}

                  {rowDefs.map((row) => {
                    const berth = (Array.isArray(berthsState) ? berthsState : []).find((b) => b.id === row.jettyId)
                    const isOos = (berth?.status || '') === 'Out of Service'
                    const occCount =
                      berth?.occupiedCount != null
                        ? Number(berth.occupiedCount)
                        : berth?.currentVesselId
                          ? 1
                          : 0
                    const statusLabel = isOos
                      ? `Out of service (lanes shown for schedule only)`
                      : occCount > 0
                        ? `Occupied (${occCount}/${row.capacity})`
                        : `Ready (0/${row.capacity})`
                    return (
                      <div
                        key={row.rowKey}
                        data-gantt-row={row.rowKey}
                        className={`jetty-schedule-gantt__row${isOos ? ' jetty-schedule-gantt__row--oos' : ''}`}
                        style={{ gridTemplateColumns }}
                      >
                        <div className="jetty-schedule-gantt__id-cell">
                          <span className="jetty-schedule-gantt__jetty-id">{row.label}</span>
                          <span className="jetty-schedule-gantt__jetty-status">Status: {statusLabel}</span>
                        </div>

                        <div className="jetty-schedule-gantt__timeline-cell" style={{ gridColumn: '2 / -1' }}>
                          <div className="jetty-schedule-gantt__timeline-inner">
                            <div
                              className="jetty-schedule-gantt__timeline-daylines"
                              style={{ gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))` }}
                              aria-hidden
                            >
                              {dateColumns.map((col) => (
                                <div key={col.key} className="jetty-schedule-gantt__timeline-dayline" />
                              ))}
                            </div>
                            <div className="jetty-schedule-gantt__timeline-tracks">
                              {renderScheduleLane(row.rowKey)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      {pendingChange ? (
        <div className="modal-overlay" onClick={handleOverlayClick} aria-hidden="true">
          <div
            className="modal jetty-schedule-gantt__confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="gantt-drag-confirm-title"
            aria-modal="true"
          >
            <h2 id="gantt-drag-confirm-title" className="modal__title">
              {tAlloc('ganttDragConfirmTitle', { defaultValue: 'Confirm schedule change' })}
              {' — '}
              {pendingChange.seg.vesselName}
            </h2>

            {pendingProposal?.jettyChange ? (
              <>
                <p className="jetty-schedule-gantt__confirm-jetty">
                  {tAlloc('ganttDragJetty', { defaultValue: 'Jetty' })}:{' '}
                  <strong>{pendingProposal.jettyChange.from ?? '—'}</strong> →{' '}
                  <strong>{pendingProposal.jettyChange.to}</strong>
                </p>
                <p className="jetty-schedule-gantt__confirm-note">
                  {tAlloc('ganttDragLaneNote', {
                    defaultValue:
                      'The lane (01/02) within the jetty is assigned automatically — the bar may appear on a different lane row.',
                  })}
                </p>
                {pendingTargetFull ? (
                  <p className="jetty-schedule-gantt__confirm-warning">
                    {tAlloc('ganttDragJettyFullWarning', {
                      defaultValue:
                        'Jetty {{jetty}} already has {{occ}}/{{cap}} berth(s) occupied — this move may exceed its capacity.',
                      jetty: pendingProposal.jettyChange.to,
                      occ: pendingTargetOcc,
                      cap: pendingTargetCap,
                    })}
                  </p>
                ) : null}
              </>
            ) : null}

            {pendingProposal?.needsChoice ? (
              <fieldset className="jetty-schedule-gantt__confirm-choice">
                <legend>
                  {tAlloc('ganttDragChoiceLegend', {
                    defaultValue: 'Which dates should this change apply to?',
                  })}
                </legend>
                <label>
                  <input
                    type="radio"
                    name="gantt-drag-choice"
                    value="estimation"
                    checked={pendingChoice === 'estimation'}
                    onChange={() => setPendingChoice('estimation')}
                  />
                  <span>
                    {tAlloc('ganttDragChoiceEstimation', {
                      defaultValue: 'Estimation (ETA / ETB)',
                    })}
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="gantt-drag-choice"
                    value="actual"
                    checked={pendingChoice === 'actual'}
                    onChange={() => setPendingChoice('actual')}
                  />
                  <span>
                    {tAlloc('ganttDragChoiceActual', { defaultValue: 'Actual (TA / TB)' })}
                  </span>
                </label>
              </fieldset>
            ) : null}

            {pendingProposal && pendingProposal.deltaMs !== 0 && !pendingProposal.needsChoice &&
            (pendingProposal.canEstimation || pendingProposal.canActual) ? (
              <p className="jetty-schedule-gantt__confirm-note">
                {pendingProposal.canEstimation
                  ? tAlloc('ganttDragEstimationOnlyNote', {
                      defaultValue:
                        'Only estimation dates (ETA/ETB) will change — no actual times are recorded yet.',
                    })
                  : tAlloc('ganttDragActualOnlyNote', {
                      defaultValue:
                        'Only actual dates (TA/TB) will change — no estimation dates are set.',
                    })}
              </p>
            ) : null}

            {pendingAllChanges.length > 0 ? (
              <table className="jetty-schedule-gantt__confirm-table">
                <thead>
                  <tr>
                    <th>{tAlloc('ganttDragField', { defaultValue: 'Field' })}</th>
                    <th>{tAlloc('ganttDragFrom', { defaultValue: 'Current' })}</th>
                    <th>{tAlloc('ganttDragTo', { defaultValue: 'New' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingAllChanges.map((c) => (
                    <tr key={c.field}>
                      <td>{c.label}</td>
                      <td>
                        {c.fromMs != null
                          ? formatDateTimeDisplay(new Date(c.fromMs).toISOString())
                          : '—'}
                      </td>
                      <td>{formatDateTimeDisplay(new Date(c.toMs).toISOString())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {pendingSaveError ? (
              <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert">
                {pendingSaveError}
              </p>
            ) : null}

            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={closePendingChange}
                disabled={pendingSaving}
              >
                {tAlloc('ganttDragCancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleConfirmPendingChange}
                disabled={pendingSaving}
              >
                {pendingSaving
                  ? tAlloc('ganttDragSaving', { defaultValue: 'Saving…' })
                  : tAlloc('ganttDragConfirm', { defaultValue: 'Confirm change' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
