/**
 * By Voyage: one row per call, grouped Incoming (unload) / Outgoing (load).
 */
import { Fragment, useCallback, useMemo, useState } from 'react'
import { voyageDisplayActiveRate, voyageFlowRate } from '../../utils/managementDashboardFlow.js'
import { voyageMovedQtyLines, voyageMovedQtySortValue } from '../../utils/managementDashboardProduct.js'
import { sortModalRows } from '../../utils/widgetDetailSort.js'
import {
  castOffSortTimestamp,
  fmtMgmtCastOffDate,
} from '../../utils/managementDashboardMetricEvidence.js'
import { fmtMgmtDurationDays, fmtMgmtDurationHours } from './ManagementProductTable.jsx'
import ProductMetricEvidenceRow from './ProductMetricEvidenceRow.jsx'
import VoyageCommodityFilter from './VoyageCommodityFilter.jsx'
import VesselGroupBlock from './VesselGroupBlock.jsx'
import { HourlyRateBreakdownRow, HourlyRateCell, HoursByRateHeader } from './HourlyRateCell.jsx'
import useHourlyRateProfiles from '../../hooks/useHourlyRateProfiles.js'
import {
  commodityFilterOptions,
  fastShare,
  filterVoyagesByCommodity,
  lineScaleMax,
} from '../../utils/hourlyRateBands.js'

const METRIC_COLUMNS = ['wait', 'pre', 'flow', 'activeFlow', 'pumped', 'kurasQty', 'kurasRate', 'downtime', 'cargoDoneToSail']

function fmtNum(n, d = 1) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

export function statusLabel(r) {
  if (r.sailedInPeriod) return 'Sailed'
  if (r.status === 'SAILED') return 'At berth'
  return {
    DOCKED: 'Docked',
    IN_PROGRESS: 'In progress',
    SIGNOFF_REQUESTED: 'Sign-off req.',
    SIGNOFF_APPROVED: 'Ready to sail',
  }[r.status] || r.status || ''
}

export function statusChip(r) {
  const label = statusLabel(r)
  if (r.sailedInPeriod) return <span className="mgmt-chip mgmt-chip--ghost">{label}</span>
  return (
    <span className={`mgmt-chip ${r.purpose === 'Loading' ? 'mgmt-chip--load' : 'mgmt-chip--disch'}`}>
      {label}
    </span>
  )
}

function pairLines(row) {
  const raw = String(row?.commodity ?? '').trim()
  if (!raw || raw === '—') return []
  return voyageMovedQtyLines(row)
}

function CommodityCell({ row }) {
  const lines = pairLines(row)
  if (lines.length <= 1) return lines[0]?.label || '—'
  return (
    <span className="mgmt-voyage-pair mgmt-voyage-pair--commodity">
      {lines.map((l, i) => (
        <span key={`${l.label}-${i}`}>{l.label}</span>
      ))}
    </span>
  )
}

function MovedQtyCell({ row }) {
  const lines = pairLines(row)
  const items = lines.length ? lines : [{ label: '—', qty: null }]
  return (
    <span className="mgmt-voyage-pair mgmt-voyage-pair--moved">
      {items.map((l, i) => (
        <span key={`${l.label}-${i}`}>{l.qty == null ? '—' : fmtNum(l.qty, 0)}</span>
      ))}
    </span>
  )
}

const positive = (v) => (v != null && Number.isFinite(v) && v > 0 ? v : null)

const activeRateOf = voyageDisplayActiveRate

const VOYAGE_COLUMNS = [
  { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '' },
  { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '' },
  { key: 'commodity', label: 'Commodity', sortValue: (r) => r.commodity || '' },
  { key: 'moved', label: 'Moved (MT)', align: 'right', sortValue: voyageMovedQtySortValue },
  { key: 'pumped', label: 'Pumped (MT)', align: 'right', sortValue: (r) => r.rateBreakdown?.normal?.qty ?? null },
  { key: 'wait', label: 'Wait', align: 'right', sortValue: (r) => r.wait },
  { key: 'pre', label: 'Berth → start cargo', align: 'right', sortValue: (r) => r.pre },
  { key: 'flow', label: 'Achieved rate', align: 'right', sortValue: (r) => voyageFlowRate(r) },
  { key: 'activeFlow', label: 'Active rate', align: 'right', sortValue: activeRateOf },
  { key: 'kurasQty', label: 'Cleaned / Kuras (MT)', align: 'right', sortValue: (r) => r.rateBreakdown?.kuras?.qty ?? null },
  { key: 'kurasRate', label: 'Cleaning / Kuras rate', align: 'right', sortValue: (r) => positive(r.rateBreakdown?.kuras?.rateMtH) },
  { key: 'downtime', label: 'Total downtime (h)', align: 'right', sortValue: (r) => r.rateBreakdown?.downtime?.hours ?? null },
  { key: 'hoursByRate', label: 'Hours by rate', sortValue: (r) => fastShare(r.hourlyProfile) },
  { key: 'cargoDoneToSail', label: 'Cargo done → sailed off', align: 'right', sortValue: (r) => r.cargoDoneToSailH },
  {
    key: 'dateCompleted',
    label: 'Date completed',
    align: 'right',
    sortValue: (r) => castOffSortTimestamp(r.castOff),
  },
  { key: 'status', label: 'Status', sortValue: statusLabel },
]

const COLUMN_ORDER = {
  standard: ['vessel', 'jetty', 'commodity', 'moved', 'wait', 'pre', 'flow', 'activeFlow', 'hoursByRate', 'cargoDoneToSail', 'dateCompleted', 'status'],
  /** Pumped / cleaned / downtime view (net-rate switch on): the rate columns sit together. */
  breakdown: ['vessel', 'jetty', 'commodity', 'wait', 'pre', 'pumped', 'flow', 'activeFlow', 'kurasQty', 'kurasRate', 'downtime', 'hoursByRate', 'cargoDoneToSail', 'dateCompleted', 'status'],
}

function columnsFor(breakdown) {
  return COLUMN_ORDER[breakdown ? 'breakdown' : 'standard'].map((key) => VOYAGE_COLUMNS.find((c) => c.key === key))
}

/** Tail-column layout: spacing + separators so durations/dates do not run together. */
const VOYAGE_COLUMN_UI = {
  flow: { thClass: 'mgmt-voyage-th--flow', tdClass: 'mgmt-voyage-col--flow' },
  activeFlow: { thClass: 'mgmt-voyage-th--flow', tdClass: 'mgmt-voyage-col--flow' },
  kurasRate: { thClass: 'mgmt-voyage-th--flow', tdClass: 'mgmt-voyage-col--flow' },
  cargoDoneToSail: {
    thClass: 'mgmt-voyage-th--cargo-done',
    tdClass: 'mgmt-voyage-col--cargo-done',
    headerLines: ['Cargo done →', 'sailed off'],
  },
  dateCompleted: {
    thClass: 'mgmt-voyage-th--date-completed',
    tdClass: 'mgmt-voyage-col--date-completed',
    headerLines: ['Date', 'completed'],
  },
}

function voyageThClass(column) {
  const ui = VOYAGE_COLUMN_UI[column.key]
  return [column.align === 'right' ? 'mgmt-r' : '', 'mgmt-voyage-th', ui?.thClass].filter(Boolean).join(' ')
}

export function voyageTdClass(columnKey, extra = '') {
  const col = VOYAGE_COLUMNS.find((c) => c.key === columnKey)
  const ui = VOYAGE_COLUMN_UI[columnKey]
  return [col?.align === 'right' ? 'mgmt-r' : '', ui?.tdClass, extra].filter(Boolean).join(' ')
}

export function SortHeader({ column, sort, onSort }) {
  const active = sort?.key === column.key
  const lines = column.headerLines ?? VOYAGE_COLUMN_UI[column.key]?.headerLines
  return (
    <th className={voyageThClass(column)}>
      <button
        type="button"
        className="mgmt-modal-sort mgmt-voyage-th__sort"
        onClick={() => onSort(column.key)}
        aria-label={`Sort by ${column.label}`}
      >
        {lines ? (
          <span className="mgmt-voyage-th__label">
            {lines[0]}
            <br />
            {lines[1]}
          </span>
        ) : (
          column.label
        )}
        <span className="mgmt-voyage-th__sort-icon" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
        </span>
      </button>
    </th>
  )
}

export function BlockTitle({ title, chipClass }) {
  if (!title) return null
  return (
    <h3 className="mgmt-product-block__title">
      {title}
      <span className={`mgmt-chip ${chipClass}`} style={{ marginLeft: 8 }}>
        {chipClass === 'mgmt-chip--disch' ? 'UNLOAD' : 'LOAD'}
      </span>
    </h3>
  )
}

export function VoyageBlock({
  title,
  chipClass,
  rows,
  expanded,
  onToggle,
  opDetailsById,
  timelinesByOpId,
  rateView,
  onRateViewChange,
  profilesLoading,
  breakdown,
  showPurpose = false,
}) {
  const columns = useMemo(() => columnsFor(breakdown), [breakdown])
  const colSpan = columns.length
  const [sort, setSort] = useState(null)
  const onSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  const sorted = useMemo(() => sortModalRows(rows, columns, sort), [rows, columns, sort])
  const scaleMax = useMemo(() => lineScaleMax(rows), [rows])

  if (!sorted.length) {
    return (
      <div className="mgmt-product-block">
        <BlockTitle title={title} chipClass={chipClass} />
        <p className="text-steel mgmt-sub" style={{ marginBottom: 0 }}>
          No voyages for this direction in this view.
        </p>
      </div>
    )
  }

  const metricProps = (rowKey, columnKey) => {
    const open = expanded?.rowKey === rowKey && expanded?.columnKey === columnKey
    return {
      role: 'button',
      tabIndex: 0,
      className: [
        voyageTdClass(columnKey, 'mgmt-product-voyage-metric-cell'),
        open ? 'mgmt-product-voyage-metric-cell--open' : '',
      ].filter(Boolean).join(' '),
      title: 'Show calculation details',
      'aria-expanded': open,
      onClick: (e) => {
        e.stopPropagation()
        onToggle(rowKey, columnKey)
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(rowKey, columnKey)
        }
      },
    }
  }

  return (
    <div className="mgmt-product-block">
      <BlockTitle title={title} chipClass={chipClass} />
      <div className="table-wrap">
        <table className="data-table mgmt-product-voyage-table">
          <thead>
            <tr>
              {columns.map((column) =>
                column.key === 'hoursByRate' ? (
                  <HoursByRateHeader
                    key={column.key}
                    view={rateView}
                    onViewChange={onRateViewChange}
                    sort={sort}
                    onSort={onSort}
                  />
                ) : (
                  <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const rk = String(r.id)
              const rate = voyageFlowRate(r)
              const activeRate = activeRateOf(r)
              const bd = r.rateBreakdown
              const show = expanded?.rowKey === rk && METRIC_COLUMNS.includes(expanded.columnKey)
              const showRateBreakdown = expanded?.rowKey === rk && expanded.columnKey === 'hoursByRate'
              const num = (v, d, unit) => (v == null ? '—' : `${fmtNum(v, d)}${unit}`)
              const cells = {
                vessel: (
                  <td>
                    <b>{r.vessel}</b>
                    <br />
                    <span className="text-steel" style={{ fontSize: 11 }}>{r.code}</span>
                    {showPurpose ? (
                      <span className={`mgmt-chip ${r.purpose === 'Loading' ? 'mgmt-chip--load' : 'mgmt-chip--disch'}`} style={{ marginLeft: 6 }}>
                        {r.purpose === 'Loading' ? 'LOAD' : 'UNLOAD'}
                      </span>
                    ) : null}
                  </td>
                ),
                jetty: <td>{r.jetty || '—'}</td>,
                commodity: <td><CommodityCell row={r} /></td>,
                moved: <td className="mgmt-r mgmt-moved"><MovedQtyCell row={r} /></td>,
                pumped: <td {...metricProps(rk, 'pumped')}>{num(bd?.normal?.qty, 0, '')}</td>,
                wait: <td {...metricProps(rk, 'wait')}>{fmtMgmtDurationDays(r.wait)}</td>,
                pre: <td {...metricProps(rk, 'pre')}>{fmtMgmtDurationDays(r.pre)}</td>,
                flow: <td {...metricProps(rk, 'flow')}>{num(rate, 1, ' MT/h')}</td>,
                activeFlow: <td {...metricProps(rk, 'activeFlow')}>{num(activeRate, 1, ' MT/h')}</td>,
                kurasQty: <td {...metricProps(rk, 'kurasQty')}>{num(bd?.kuras?.qty, 0, '')}</td>,
                kurasRate: <td {...metricProps(rk, 'kurasRate')}>{num(positive(bd?.kuras?.rateMtH), 1, ' MT/h')}</td>,
                downtime: <td {...metricProps(rk, 'downtime')}>{num(bd?.downtime?.hours, 1, ' h')}</td>,
                hoursByRate: (
                  <td
                    {...(r.hourlyProfile ? metricProps(rk, 'hoursByRate') : {})}
                    className={`mgmt-voyage-col--rate-hours${r.hourlyProfile ? ' mgmt-product-voyage-metric-cell' : ''}${showRateBreakdown ? ' mgmt-product-voyage-metric-cell--open' : ''}`}
                    title={r.hourlyProfile ? 'Show hours by rate breakdown' : undefined}
                  >
                    <HourlyRateCell
                      profile={r.hourlyProfile}
                      view={rateView}
                      scaleMax={scaleMax}
                      loading={profilesLoading}
                      manual={r.cargoRateSource === 'manual'}
                    />
                  </td>
                ),
                cargoDoneToSail: <td {...metricProps(rk, 'cargoDoneToSail')}>{fmtMgmtDurationHours(r.cargoDoneToSailH)}</td>,
                dateCompleted: <td className={voyageTdClass('dateCompleted')}>{fmtMgmtCastOffDate(r.castOff)}</td>,
                status: <td>{statusChip(r)}</td>,
              }
              return (
                <Fragment key={rk}>
                  <tr>
                    {columns.map((c) => <Fragment key={c.key}>{cells[c.key]}</Fragment>)}
                  </tr>
                  {show ? (
                    <ProductMetricEvidenceRow
                      row={r}
                      columnKey={expanded.columnKey}
                      opDetailsById={opDetailsById}
                      timelinesByOpId={timelinesByOpId}
                      colSpan={colSpan}
                    />
                  ) : null}
                  {showRateBreakdown ? (
                    <HourlyRateBreakdownRow row={r} view={rateView} scaleMax={scaleMax} colSpan={colSpan} />
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function VoyageDrilldownTable({
  rows,
  opDetailsById,
  timelinesByOpId,
  showIncoming = true,
  showOutgoing = true,
  breakdown = false,
  groupBy = 'voyage',
}) {
  const allRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [commodities, setCommodities] = useState(() => new Set())
  const [rateView, setRateView] = useState('pie')
  const { profilesById, loading: profilesLoading } = useHourlyRateProfiles(allRows)
  const options = useMemo(() => commodityFilterOptions(allRows), [allRows])
  const list = useMemo(
    () =>
      filterVoyagesByCommodity(allRows, commodities).map((r) => ({
        ...r,
        hourlyProfile: profilesById[String(r.id)] ?? null,
      })),
    [allRows, commodities, profilesById],
  )
  const incoming = list.filter((r) => r.purpose !== 'Loading')
  const outgoing = list.filter((r) => r.purpose === 'Loading')
  const [expanded, setExpanded] = useState(null)
  const onToggle = useCallback((rowKey, columnKey) => {
    setExpanded((prev) =>
      prev?.rowKey === rowKey && prev?.columnKey === columnKey ? null : { rowKey, columnKey },
    )
  }, [])

  if (!showIncoming && !showOutgoing) return null
  const filter = (
    <VoyageCommodityFilter
      options={options}
      selected={commodities}
      onChange={setCommodities}
      shown={list.length}
      total={allRows.length}
    />
  )
  if ((showIncoming ? incoming.length : 0) + (showOutgoing ? outgoing.length : 0) === 0) {
    return (
      <>
        {filter}
        <p className="text-steel">No voyages in this view.</p>
      </>
    )
  }

  const blockProps = {
    expanded,
    onToggle,
    opDetailsById,
    timelinesByOpId,
    rateView,
    onRateViewChange: setRateView,
    profilesLoading,
    breakdown,
  }

  if (groupBy === 'vessel') {
    return (
      <div className="mgmt-product-tables">
        {filter}
        <VesselGroupBlock
          rows={[...(showIncoming ? incoming : []), ...(showOutgoing ? outgoing : [])]}
          voyageBlockProps={{ ...blockProps, showPurpose: true }}
        />
      </div>
    )
  }

  return (
    <div className="mgmt-product-tables">
      {filter}
      {showIncoming ? (
        <VoyageBlock
          title="Incoming"
          chipClass="mgmt-chip--disch"
          rows={incoming}
          {...blockProps}
        />
      ) : null}
      {showOutgoing ? (
        <VoyageBlock
          title="Outgoing"
          chipClass="mgmt-chip--load"
          rows={outgoing}
          {...blockProps}
        />
      ) : null}
    </div>
  )
}
