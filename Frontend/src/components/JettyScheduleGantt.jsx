import { useMemo, useState, useEffect } from 'react'

/** Replaces emoji (often renders as empty box on Windows) */
function GanttVesselIcon() {
  return (
    <svg
      className="jetty-schedule-gantt__bar-ship"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {/* Simple hull + deck (no emoji — avoids missing-glyph box on Windows) */}
      <path
        fill="currentColor"
        d="M2 20h20v2H2v-2zm2-2h16l-2-6H6L4 18zm2.5-8L8 6h8l.5 2 2.5 4H7L6.5 10z"
      />
    </svg>
  )
}

/** Small completion marker for sailed-off vessels */
function GanttCompletedIcon() {
  return (
    <svg
      className="jetty-schedule-gantt__bar-ship"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8-8 1.4 1.4-9.4 9.4z"
      />
    </svg>
  )
}

/** Default +3 calendar days from planned/actual start when completions unknown (display only) */
const DEFAULT_TAIL_MS = 3 * 24 * 60 * 60 * 1000
const MAX_RANGE_MS = 548 * 24 * 60 * 60 * 1000
const DAY_COL_MIN = 72
/** Show planned + actual lanes on viewports ≥ this width, or when user checks "Compare" */
const WIDE_BREAKPOINT_MQ = '(min-width: 1100px)'

function startOfDay(d) {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

function addMonths(date, delta) {
  const x = new Date(date.getTime())
  x.setMonth(x.getMonth() + delta)
  return x
}

function toDateInputValue(d) {
  const x = startOfDay(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultDateRangeInputs() {
  const today = new Date()
  const from = startOfDay(today)
  const to = startOfDay(addMonths(today, 1))
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

function parseDateInputStart(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

function parseDateInputEndExclusive(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const [y, m, d] = str.split('-').map(Number)
  const day = new Date(y, m - 1, d, 0, 0, 0, 0)
  day.setDate(day.getDate() + 1)
  return day.getTime()
}

function parseMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
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
        label: dayStart.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        startMs: colStart,
        endMs: colEnd,
      })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return cols
}

function clipToWindow(startMs, endMs, wStart, wEnd) {
  if (endMs <= wStart || startMs >= wEnd) return null
  return {
    startMs: Math.max(startMs, wStart),
    endMs: Math.min(endMs, wEnd),
  }
}

function pushSegment(out, base, wStart, wEnd) {
  const c = clipToWindow(base.startMs, base.endMs, wStart, wEnd)
  if (!c || c.endMs <= c.startMs) return
  out.push({ ...base, startMs: c.startMs, endMs: c.endMs })
}

function buildScheduleSegments(plan, windowStartMs, windowEndMs) {
  const sorted = [...plan].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99))
  const out = []

  sorted.forEach((r) => {
    const jettyId = (r.jetty || '').trim().split('/')[0].trim()
    if (!jettyId) return

    const vesselId = r.vesselId
    const vesselName = r.vesselName || r.vesselId || '—'
    const plannedEtb = parseMs(r.plannedEtbDateTime) ?? parseMs(r.etbDateTime)
    const ta = parseMs(r.taDateTime)
    const tb = parseMs(r.tbDateTime)
    const estComp = parseMs(r.estimatedCompletionDateTime)
    const actComp = parseMs(r.actualCompletionDateTime)
    const castOff = parseMs(r.castOffDateTime)
    const status = actComp != null ? 'Sailed off' : tb != null ? 'Berthing' : 'Arriving'
    /** Known end of alongside ops when recorded (cast-off can stand in if completion time missing) */
    const actualEnd = actComp ?? castOff ?? null

    // Planned: ETB → est. completion when set; else +3 days from ETB (open end).
    // (Independent of actual completion — matches “planned” semantics.)

    if (plannedEtb != null) {
      let opsEnd
      let gradient
      let label
      if (estComp != null && estComp > plannedEtb) {
        opsEnd = estComp
        gradient = false
        label = 'Planned · alongside → est. completion'
      } else {
        opsEnd = plannedEtb + DEFAULT_TAIL_MS
        gradient = true
        label =
          estComp == null
            ? 'Planned · alongside (+3 days — est. completion not set)'
            : 'Planned · alongside (+3 days — est. completion not after ETB)'
      }
      pushSegment(
        out,
        {
          layer: 'planned',
          phase: 'ops',
          jettyId,
          vesselId,
          vesselName,
          gradient,
          status,
          label,
          startMs: plannedEtb,
          endMs: opsEnd,
        },
        windowStartMs,
        windowEndMs
      )
    }

    if (ta != null && tb == null) {
      // TB not yet recorded: one “actual” bar from TA. Must follow the same completion matrix
      // as alongside — otherwise (2) looked like +3 days here while planned used est. completion.
      let transitEnd
      let transitGradient = true
      let transitLabel
      const hasEst = estComp != null
      const hasAct = actComp != null

      if (hasEst && hasAct) {
        if (actComp > ta) {
          transitEnd = actComp
          transitGradient = false
          transitLabel = 'Actual · TA → actual completion (berth time TBD)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else if (hasEst && !hasAct) {
        // (2) Est filled, actual completion NULL → end at est. completion, open-ended until TB/actual completion
        if (estComp > ta) {
          transitEnd = estComp
          transitGradient = true
          transitLabel =
            'Actual · TA → est. completion (berth TBD — open end; actual completion not recorded)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else if (!hasEst && hasAct) {
        if (actComp > ta) {
          transitEnd = actComp
          transitGradient = false
          transitLabel = 'Actual · TA → actual completion (berth time TBD)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else {
        // (1) both NULL → +3 days from TA
        transitEnd = ta + DEFAULT_TAIL_MS
        transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
      }

      pushSegment(
        out,
        {
          layer: 'actual',
          phase: 'transit',
          jettyId,
          vesselId,
          vesselName,
          gradient: transitGradient,
          status,
          label: transitLabel,
          startMs: ta,
          endMs: transitEnd,
        },
        windowStartMs,
        windowEndMs
      )
    }

    // Actual alongside: only after TB exists (do not draw ops bar until alongside started).
    // Matrix uses estimatedCompletionDateTime + actualCompletionDateTime; cast-off fills in
    // a known end only when both completion fields are empty (branch 1).
    if (tb != null) {
      const hasEst = estComp != null
      const hasAct = actComp != null
      let opsEnd
      let gradient
      let label

      if (hasEst && hasAct) {
        // Both filled → actual end is actual completion (known)
        if (actComp > tb) {
          opsEnd = actComp
          gradient = false
          label = 'Actual · alongside → actual completion'
        } else {
          opsEnd = tb + DEFAULT_TAIL_MS
          gradient = true
          label = 'Actual · alongside (actual completion not after TB — tail is indicative)'
        }
      } else if (hasEst && !hasAct) {
        // Est filled, actual completion NULL → show to est. completion, open-ended (provisional)
        if (estComp > tb) {
          opsEnd = estComp
          gradient = true
          label =
            'Actual · alongside → est. completion (actual completion not recorded — open end)'
        } else {
          opsEnd = tb + DEFAULT_TAIL_MS
          gradient = true
          label = 'Actual · alongside (est. completion not after TB — tail is indicative)'
        }
      } else if (!hasEst && hasAct) {
        // Est NULL, actual completion filled → solid to actual completion
        if (actComp > tb) {
          opsEnd = actComp
          gradient = false
          label = 'Actual · alongside → actual completion'
        } else {
          opsEnd = tb + DEFAULT_TAIL_MS
          gradient = true
          label = 'Actual · alongside (actual completion not after TB — tail is indicative)'
        }
      } else {
        // Both NULL → +3 days from TB, or cast-off / completion from actualEnd if present
        if (actualEnd != null && actualEnd > tb) {
          opsEnd = actualEnd
          gradient = false
          label = 'Actual · alongside → completion / cast-off'
        } else {
          opsEnd = tb + DEFAULT_TAIL_MS
          gradient = true
          label = 'Actual · alongside (+3 days — completion not set)'
        }
      }

      pushSegment(
        out,
        {
          layer: 'actual',
          phase: 'ops',
          jettyId,
          vesselId,
          vesselName,
          gradient,
          status,
          label,
          startMs: tb,
          endMs: opsEnd,
        },
        windowStartMs,
        windowEndMs
      )
    }
  })

  return out
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

function segmentPillClass(seg) {
  const st = (seg.status || 'arriving').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const layer = seg.layer
  const grad = seg.gradient ? 'grad' : 'solid'
  return `jetty-schedule-gantt__bar jetty-schedule-gantt__bar--${layer}-${grad} jetty-schedule-gantt__bar--st-${st}`
}

/** Short jetty id from allocation list row (matches segment jettyId). */
function jettyIdFromListRow(row) {
  return (row?.jetty || '').trim().split('/')[0].trim()
}

/**
 * Bank lanes (01, 02, …) are per vessel on a jetty, not per planned/actual layer.
 * Sort: earliest TB first, then operation id, then vessel id — then assign lane 0..capacity-1.
 */
function assignBankLanesByVessel(baseSegments, rowDefs, listRows) {
  const caps = new Map()
  for (const r of rowDefs) caps.set(r.jettyId, r.capacity)

  const metaByJettyVessel = new Map()
  for (const row of listRows) {
    const jid = jettyIdFromListRow(row)
    if (!jid || !row?.vesselId) continue
    const k = `${jid}\0${row.vesselId}`
    const tbMs = parseMs(row.tbDateTime)
    const opRaw = row.operationId
    const opId = opRaw != null && !Number.isNaN(Number(opRaw)) ? Number(opRaw) : null
    metaByJettyVessel.set(k, { tbMs, opId })
  }

  const vesselsByJetty = new Map()
  for (const s of baseSegments) {
    if (!s.vesselId) continue
    if (!vesselsByJetty.has(s.jettyId)) vesselsByJetty.set(s.jettyId, new Set())
    vesselsByJetty.get(s.jettyId).add(s.vesselId)
  }

  const laneByJettyVessel = new Map()
  for (const [jettyId, vesselSet] of vesselsByJetty) {
    const cap = Math.max(1, caps.get(jettyId) || 1)
    const vessels = [...vesselSet]
    vessels.sort((a, b) => {
      const ka = `${jettyId}\0${a}`
      const kb = `${jettyId}\0${b}`
      const ma = metaByJettyVessel.get(ka) || {}
      const mb = metaByJettyVessel.get(kb) || {}
      const tbA = ma.tbMs ?? null
      const tbB = mb.tbMs ?? null
      if (tbA != null && tbB != null && tbA !== tbB) return tbA - tbB
      if (tbA != null && tbB == null) return -1
      if (tbA == null && tbB != null) return 1
      const opA = ma.opId != null ? ma.opId : Number.MAX_SAFE_INTEGER
      const opB = mb.opId != null ? mb.opId : Number.MAX_SAFE_INTEGER
      if (opA !== opB) return opA - opB
      return String(a).localeCompare(String(b))
    })
    vessels.forEach((vid, idx) => {
      const lane = Math.min(idx, cap - 1)
      laneByJettyVessel.set(`${jettyId}\0${vid}`, lane)
    })
  }

  const out = []
  for (const s of baseSegments) {
    const lane = laneByJettyVessel.get(`${s.jettyId}\0${s.vesselId}`) ?? 0
    out.push({ ...s, laneIndex: lane, rowKey: `${s.jettyId}__${lane}` })
  }
  return out
}

export default function JettyScheduleGantt({ berthIds, berthsState, list, onSelectVessel }) {
  const def = useMemo(() => defaultDateRangeInputs(), [])
  const [dateFrom, setDateFrom] = useState(def.from)
  const [dateTo, setDateTo] = useState(def.to)
  const [comparePlanActual, setComparePlanActual] = useState(false)
  const [isWide, setIsWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE_BREAKPOINT_MQ).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(WIDE_BREAKPOINT_MQ)
    const onChange = () => setIsWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const showDualLanes = isWide || comparePlanActual

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
    const barList = buildScheduleSegments(plan, wStart, wEnd)
    return {
      windowStartMs: wStart,
      windowEndMs: wEnd,
      dateColumns: cols,
      baseSegments: barList,
      totalMs: wEnd - wStart,
      rangeError: null,
    }
  }, [list, dateFrom, dateTo])

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
    return assignBankLanesByVessel(baseSegments, rowDefs, listRows)
  }, [baseSegments, rowDefs, list])

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const nowMs = Date.now()
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

  const renderContinuousLane = (rowKey, layer) => {
    const segs = segments
      .filter((s) => s.rowKey === rowKey && s.layer === layer)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    const laneH = Math.max(30, 8 + segs.length * 26)
    return (
      <div
        className={`jetty-schedule-gantt__track jetty-schedule-gantt__track--${layer}`}
        style={{ minHeight: `${laneH}px` }}
      >
        {segs.map((seg, i) => {
          const pos = segmentTrackStyle(seg, windowStartMs, totalMs)
          if (!pos) return null
          const { rawWidthPct, ...posStyle } = pos
          const style = {
            ...posStyle,
            top: `${6 + i * 26}px`,
          }
          const minimal = rawWidthPct < 6
          const pillClass = segmentPillClass(seg)
          const tooltip = `${seg.vesselName}: ${seg.label}`
          const canClick = Boolean(seg.vesselId && typeof onSelectVessel === 'function')
          const title = `${tooltip}${canClick ? ' — click for details' : ''}`

          const inner = minimal ? null : (
            <>
              {seg.status === 'Sailed off' ? <GanttCompletedIcon /> : <GanttVesselIcon />}
              <span className="jetty-schedule-gantt__bar-text">{seg.vesselName}</span>
            </>
          )

          if (canClick) {
            return (
              <button
                key={`${layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
                type="button"
                className={`${pillClass} jetty-schedule-gantt__bar--btn${minimal ? ' jetty-schedule-gantt__bar--minimal' : ''}`}
                style={style}
                title={title}
                aria-label={minimal ? title : undefined}
                onClick={() => onSelectVessel(seg.vesselId)}
              >
                {inner}
              </button>
            )
          }
          return (
            <span
              key={`${layer}-${seg.phase}-${seg.vesselName}-${seg.startMs}-${i}`}
              className={`${pillClass}${minimal ? ' jetty-schedule-gantt__bar--minimal' : ''}`}
              style={style}
              title={title}
              role={minimal ? 'img' : undefined}
              aria-label={minimal ? title : undefined}
            >
              {inner}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <section className="card jetty-schedule-gantt">
      <h2 className="card__title">Jetty schedule</h2>

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
        {!isWide && (
          <label className="jetty-schedule-gantt__compare">
            <input
              type="checkbox"
              checked={comparePlanActual}
              onChange={(e) => setComparePlanActual(e.target.checked)}
            />
            Compare plan vs actual
          </label>
        )}
      </div>

      <p className="jetty-schedule-gantt__intro">
        {rangeError ? <span className="jetty-schedule-gantt__error">{rangeError}</span> : null}
      </p>

      <div
        className={`allocation-schedule__legend jetty-schedule-gantt__legend jetty-schedule-gantt__legend--two${showDualLanes ? '' : ' jetty-schedule-gantt__legend--planned-only'}`}
      >
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--planned-solid" /> Planned
          (known)
        </span>
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--planned-grad" /> Planned (open
          end)
        </span>
        {showDualLanes && (
          <>
            <span className="allocation-schedule__legend-item">
              <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--actual-solid" /> Actual
              (known)
            </span>
            <span className="allocation-schedule__legend-item">
              <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--actual-grad" /> Actual (open
              end)
            </span>
          </>
        )}
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__now-dot" aria-hidden /> Now
        </span>
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--status-arriving" /> Arriving
          / allocated
        </span>
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--status-berthing" /> Berthing
        </span>
        <span className="allocation-schedule__legend-item">
          <span className="jetty-schedule-gantt__swatch jetty-schedule-gantt__swatch--status-sailed-off" /> Sailed
          off
        </span>
      </div>

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
                  <div key={col.key} className="jetty-schedule-gantt__th-day">
                    {col.label}
                  </div>
                ))}
              </div>

              <div className="jetty-schedule-gantt__body">
                <div className="jetty-schedule-gantt__body-inner">
                  {showNowLine && (
                    <div
                      className="jetty-schedule-gantt__now-line"
                      title={`Now: ${new Date(nowMs).toLocaleString()}`}
                      style={{
                        left: `calc(var(--jetty-schedule-id-col, 200px) + (100% - var(--jetty-schedule-id-col, 200px)) * ${nowFraction})`,
                      }}
                    />
                  )}

                  {rowDefs.map((row) => {
                    const berth = (Array.isArray(berthsState) ? berthsState : []).find((b) => b.id === row.jettyId)
                    const occCount =
                      berth?.occupiedCount != null
                        ? Number(berth.occupiedCount)
                        : berth?.currentVesselId
                          ? 1
                          : 0
                    const statusLabel = occCount > 0 ? `Occupied (${occCount}/${row.capacity})` : `Ready (0/${row.capacity})`
                    return (
                      <div
                        key={row.rowKey}
                        className="jetty-schedule-gantt__row"
                        style={{ gridTemplateColumns }}
                      >
                        <div className="jetty-schedule-gantt__id-cell">
                          <span className="jetty-schedule-gantt__jetty-id">{row.label}</span>
                          {showDualLanes ? (
                            <>
                              <span className="jetty-schedule-gantt__lane-label">Planned</span>
                              <span className="jetty-schedule-gantt__lane-label">Actual</span>
                            </>
                          ) : (
                            <span className="jetty-schedule-gantt__lane-label">Planned</span>
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
                              {renderContinuousLane(row.rowKey, 'planned')}
                              {showDualLanes && renderContinuousLane(row.rowKey, 'actual')}
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
    </section>
  )
}
