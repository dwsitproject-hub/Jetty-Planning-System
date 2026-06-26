import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toJpeg } from 'html-to-image'
import InteractiveTooltip from './InteractiveTooltip'
import { formatOverdueDuration } from '../utils/etcBreach'
import { formatDateDisplay, formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  toDateInputValue,
  parseDateInputStart,
  parseDateInputEndExclusive,
} from '../utils/jettyScheduleOccupancy'
import { buildScheduleSegments, assignBankLanesByVessel } from '../utils/jettyScheduleGanttLanes'
import {
  readGanttLayerMode,
  resolveGanttLayerVisibility,
  writeGanttLayerMode,
} from '../utils/ganttLayerMode.js'
import GanttLayerToggle from './GanttLayerToggle'
import VisualizationPopoutButton from './VisualizationPopoutButton'
import GanttDenseBlock from './GanttDenseBlock'
import {
  buildActualBlockModel,
  buildPlannedBlockModel,
  ganttDenseBlockAriaLabel,
  GANTT_BAR_STACK_STEP,
} from '../utils/ganttBarDisplay.js'
import '../styles/dashboard.css'
import '../styles/etc-breach.css'

/** Default +3 calendar days from planned/actual start when completions unknown (display only) */
const MAX_RANGE_MS = 548 * 24 * 60 * 60 * 1000
const DAY_COL_MIN = 72

function startOfDay(d) {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

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

function buildGanttTooltipItems(seg, canClick) {
  const fmt = (ms) => (ms == null ? '—' : formatDateTimeDisplay(new Date(ms).toISOString()))
  const items = []
  if (seg.cargoDisplay) {
    items.push({ primary: 'Cargo', secondary: seg.cargoDisplay })
  }
  items.push({ primary: seg.label || '—' })
  items.push({ primary: `Status: ${seg.status || '—'}` })
  items.push({
    primary: `Start: ${formatDateTimeDisplay(new Date(seg.startMs).toISOString())}${seg.startSource ? ` (from ${seg.startSource})` : ''}`,
    secondary: `End: ${formatDateTimeDisplay(new Date(seg.endMs).toISOString())}`,
  })
  items.push({
    primary: `Planned refs — ETB: ${fmt(seg.plannedEtbMs)} · ETA: ${fmt(seg.etaMs)}`,
  })
  items.push({
    primary: `Actual refs — TB: ${fmt(seg.tbMs)} · TA: ${fmt(seg.taMs)}`,
  })
  if (seg.estCompMs != null) {
    items.push({ primary: `Est. completion: ${fmt(seg.estCompMs)}` })
  }
  if (seg.overMs != null && seg.overMs > 0) {
    items.push({
      primary: 'ETC breached',
      secondary: `${formatOverdueDuration(seg.overMs)} over est. completion (${fmt(seg.estCompMs)})`,
    })
  }
  if (canClick) items.push({ primary: 'Click to open vessel details.' })
  return items
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

export default function JettyScheduleGantt({
  berthIds,
  berthsState,
  list,
  onSelectVessel,
  layerMode: layerModeProp,
  onLayerModeChange,
  popoutProfile = 'plan',
  hidePopoutButton = false,
  isPopout = false,
}) {
  const { t: tAlloc } = useTranslation('allocation')
  const def = useMemo(() => defaultDateRangeInputs(), [])
  const [dateFrom, setDateFrom] = useState(def.from)
  const [dateTo, setDateTo] = useState(def.to)
  const [internalLayerMode, setInternalLayerMode] = useState(() => readGanttLayerMode())

  const layerMode = layerModeProp ?? internalLayerMode
  const { showPlanned, showActual, showDualLanes } = resolveGanttLayerVisibility(layerMode)

  const handleLayerModeChange = (next) => {
    writeGanttLayerMode(next)
    if (layerModeProp == null) {
      setInternalLayerMode(next)
    }
    onLayerModeChange?.(next)
  }

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

  const handleExportJpeg = async () => {
    const node = exportRef.current
    if (!node || rangeError) return
    setExporting(true)
    // While capturing, let the scroll area lay out its full width so every date column
    // and row is included (not just the visible scroll viewport).
    node.classList.add('jetty-schedule-gantt__export-area--capturing')
    try {
      // Wait a frame so the layout change applies before the snapshot.
      await new Promise((r) => requestAnimationFrame(() => r()))
      const dataUrl = await toJpeg(node, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
      })
      const link = document.createElement('a')
      const layerTag =
        layerMode === 'planned' ? 'planned' : layerMode === 'actual' ? 'actual' : 'both'
      link.download = `jetty-schedule_${dateFrom}_to_${dateTo}_${layerTag}.jpeg`
      link.href = dataUrl
      link.click()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Jetty schedule JPEG export failed:', err)
    } finally {
      node.classList.remove('jetty-schedule-gantt__export-area--capturing')
      setExporting(false)
    }
  }

  const renderContinuousLane = (rowKey, layer) => {
    const segs = segments
      .filter((s) => s.rowKey === rowKey && s.layer === layer)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    const listRows = Array.isArray(list) ? list : []
    const laneH = Math.max(30, 8 + segs.length * GANTT_BAR_STACK_STEP)
    return (
      <div
        className={`jetty-schedule-gantt__track jetty-schedule-gantt__track--${layer}`}
        style={{ minHeight: `${laneH}px` }}
      >
        {segs.map((seg, i) => {
          const pos = segmentTrackStyle(seg, windowStartMs, totalMs)
          if (!pos) return null
          const { rawWidthPct: _rawWidthPct, ...posStyle } = pos
          const style = ganttBarInlineStyle(seg, posStyle, i)

          // All actual bars render as one flat colour (no multi-phase shading) so "Actual"
          // reads as a single colour across the chart. Phase/milestone detail stays in the tooltip.
          const pillClass = segmentPillClass(seg)
          const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
          const tooltipItems = buildGanttTooltipItems(seg, canClick)
          const barLayer = layer === 'planned' ? 'planned' : 'actual'
          const ariaLabel = ganttBarAriaLabel(seg, barLayer)
          const barClassName = `${pillClass}${canClick ? ' jetty-schedule-gantt__bar--btn' : ''}`
          const sourceRow = barLayer === 'actual' ? findScheduleSourceRow(listRows, seg) : null
          const denseContent = renderDenseBarContent(seg, barLayer, _rawWidthPct, sourceRow)

          if (canClick) {
            return (
              <InteractiveTooltip
                key={`${layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
                title={seg.vesselName}
                subtitle={seg.purposeLabel || undefined}
                items={tooltipItems}
                emptyText="No details."
                placement="right"
                interactiveChild
              >
                <button
                  type="button"
                  className={barClassName}
                  style={style}
                  aria-label={ariaLabel}
                  onClick={() => onSelectVessel(seg.vesselId)}
                >
                  {denseContent}
                </button>
              </InteractiveTooltip>
            )
          }
          return (
            <InteractiveTooltip
              key={`${layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
              title={seg.vesselName}
              subtitle={seg.purposeLabel || undefined}
              items={tooltipItems}
              emptyText="No details."
              placement="right"
              interactiveChild
            >
              <span
                className={barClassName}
                style={style}
                role="img"
                aria-label={ariaLabel}
              >
                {denseContent}
              </span>
            </InteractiveTooltip>
          )
        })}
      </div>
    )
  }

  const legendContent = (
    <>
      {showPlanned ? (
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--planned-solid" />
          {tAlloc('ganttLegendPlanned', { defaultValue: 'Planned' })}
        </span>
      ) : null}
      {showActual ? (
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--actual-solid" />
          {tAlloc('ganttLegendActual', { defaultValue: 'Actual' })}
        </span>
      ) : null}
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

  return (
    <section className={`jetty-schedule-gantt${isPopout ? ' jetty-schedule-gantt--popout' : ' card'}`}>
      {!isPopout ? (
        <div className="card__title-row">
          <h2 className="card__title">Jetty schedule</h2>
          {!hidePopoutButton ? (
            <VisualizationPopoutButton mode="schedule" profile={popoutProfile} layerMode={layerMode} />
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
        <GanttLayerToggle value={layerMode} onChange={handleLayerModeChange} />
        <button type="button" className="btn btn--secondary jetty-schedule-gantt__reset" onClick={handleResetRange}>
          Reset
        </button>
        <button
          type="button"
          className="btn btn--secondary jetty-schedule-gantt__export"
          onClick={handleExportJpeg}
          disabled={exporting || Boolean(rangeError)}
          title={tAlloc('ganttExportJpegHint', { defaultValue: 'Export the current view (date range + layer) as a JPEG image' })}
        >
          {exporting
            ? tAlloc('ganttExporting', { defaultValue: 'Exporting…' })
            : tAlloc('ganttExportJpeg', { defaultValue: 'Export JPEG' })}
        </button>
      </div>

      <p className="jetty-schedule-gantt__intro">
        {rangeError ? <span className="jetty-schedule-gantt__error">{rangeError}</span> : null}
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
          <div
            className={`allocation-schedule__legend jetty-schedule-gantt__legend jetty-schedule-gantt__legend--two${showActual ? '' : ' jetty-schedule-gantt__legend--planned-only'}`}
          >
            {legendContent}
          </div>
        </details>
      ) : (
        <div
          className={`allocation-schedule__legend jetty-schedule-gantt__legend jetty-schedule-gantt__legend--two${showActual ? '' : ' jetty-schedule-gantt__legend--planned-only'}`}
        >
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
                        className={`jetty-schedule-gantt__row${isOos ? ' jetty-schedule-gantt__row--oos' : ''}`}
                        style={{ gridTemplateColumns }}
                      >
                        <div className="jetty-schedule-gantt__id-cell">
                          <span className="jetty-schedule-gantt__jetty-id">{row.label}</span>
                          {showDualLanes ? (
                            <>
                              <span className="jetty-schedule-gantt__lane-label">Planned</span>
                              <span className="jetty-schedule-gantt__lane-label">Actual</span>
                            </>
                          ) : showPlanned ? (
                            <span className="jetty-schedule-gantt__lane-label">Planned</span>
                          ) : (
                            <span className="jetty-schedule-gantt__lane-label">Actual</span>
                          )}
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
                            <div
                              className={`jetty-schedule-gantt__timeline-tracks${showDualLanes ? ' jetty-schedule-gantt__timeline-tracks--dual' : ''}`}
                            >
                              {showPlanned && renderContinuousLane(row.rowKey, 'planned')}
                              {showActual && renderContinuousLane(row.rowKey, 'actual')}
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
    </section>
  )
}
