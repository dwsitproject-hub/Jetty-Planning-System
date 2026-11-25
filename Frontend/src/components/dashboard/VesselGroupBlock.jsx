/**
 * By Vessel: one row per vessel (loading and unloading together); a row opens its voyages.
 */
import { Fragment, useCallback, useMemo, useState } from 'react'
import { groupVoyagesByVessel } from '../../utils/managementDashboardByVessel.js'
import { sortModalRows } from '../../utils/widgetDetailSort.js'
import { castOffSortTimestamp, fmtMgmtCastOffDate } from '../../utils/managementDashboardMetricEvidence.js'
import { fmtMgmtDurationDays, fmtMgmtDurationHours } from './ManagementProductTable.jsx'
import { SortHeader, VoyageBlock, statusChip, statusLabel, voyageTdClass } from './VoyageDrilldownTable.jsx'

const fmtNum = (n, d) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))
const fmtRate = (n) => (n == null ? '—' : `${fmtNum(n, 1)} MT/h`)
const vesselStatus = (v) => (v.alongside ? statusLabel(v.alongside) : 'Sailed')

const COLUMNS = [
  { key: 'vessel', label: 'Vessel', sortValue: (v) => v.vessel },
  { key: 'voyages', label: 'Voyages', align: 'right', sortValue: (v) => v.callCount },
  { key: 'commodity', label: 'Commodity', sortValue: (v) => v.movedLines.map((l) => l.label).join(', ') },
  { key: 'moved', label: 'Moved (MT)', align: 'right', sortValue: (v) => v.movedTotal },
  { key: 'wait', label: 'Avg wait', align: 'right', sortValue: (v) => v.wait },
  { key: 'pre', label: 'Avg berth → start cargo', align: 'right', sortValue: (v) => v.pre },
  { key: 'flow', label: 'Avg achieved rate', headerLines: ['Avg achieved', 'rate'], align: 'right', sortValue: (v) => v.rate },
  { key: 'activeFlow', label: 'Avg active rate', headerLines: ['Avg active', 'rate'], align: 'right', sortValue: (v) => v.activeRate },
  { key: 'downtime', label: 'Total downtime (h)', align: 'right', sortValue: (v) => v.downtimeH },
  {
    key: 'cargoDoneToSail',
    label: 'Avg cargo done → sailed off',
    headerLines: ['Avg cargo done →', 'sailed off'],
    align: 'right',
    sortValue: (v) => v.cargoDoneToSailH,
  },
  {
    key: 'dateCompleted',
    label: 'Last completed',
    headerLines: ['Last', 'completed'],
    align: 'right',
    sortValue: (v) => castOffSortTimestamp(v.lastCastOff),
  },
  { key: 'status', label: 'Status', sortValue: vesselStatus },
]

function LinesCell({ lines, pick }) {
  if (!lines.length) return '—'
  return (
    <span className="mgmt-voyage-pair">
      {lines.map((l, i) => <span key={`${l.label}-${i}`}>{pick(l)}</span>)}
    </span>
  )
}

function callMix(v) {
  const parts = []
  if (v.loadCalls) parts.push(`${v.loadCalls} load`)
  if (v.unloadCalls) parts.push(`${v.unloadCalls} unload`)
  return parts.join(' · ')
}

/** Downtime comes from the pumped / cleaned / downtime breakdown, so it shows only while that switch is on. */
const columnsFor = (breakdown) => (breakdown ? COLUMNS : COLUMNS.filter((c) => c.key !== 'downtime'))

function vesselCells(v, open) {
  return {
    vessel: (
      <td>
        <span className="mgmt-vessel-row__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <b>{v.vessel}</b>
        <br />
        <span className="text-steel" style={{ fontSize: 11 }}>{v.jetties.join(', ') || '—'}</span>
      </td>
    ),
    voyages: (
      <td className="mgmt-r">
        <b>{v.callCount}</b>
        <br />
        <span className="text-steel" style={{ fontSize: 11 }}>{callMix(v)}</span>
      </td>
    ),
    commodity: <td><LinesCell lines={v.movedLines} pick={(l) => l.label} /></td>,
    moved: <td className="mgmt-r mgmt-moved"><LinesCell lines={v.movedLines} pick={(l) => fmtNum(l.qty, 0)} /></td>,
    wait: <td className={voyageTdClass('wait')}>{fmtMgmtDurationDays(v.wait)}</td>,
    pre: <td className={voyageTdClass('pre')}>{fmtMgmtDurationDays(v.pre)}</td>,
    flow: <td className={voyageTdClass('flow')}>{fmtRate(v.rate)}</td>,
    activeFlow: <td className={voyageTdClass('activeFlow')}>{fmtRate(v.activeRate)}</td>,
    downtime: <td className={voyageTdClass('downtime')}>{v.downtimeH == null ? '—' : `${fmtNum(v.downtimeH, 1)} h`}</td>,
    cargoDoneToSail: <td className={voyageTdClass('cargoDoneToSail')}>{fmtMgmtDurationHours(v.cargoDoneToSailH)}</td>,
    dateCompleted: <td className={voyageTdClass('dateCompleted')}>{fmtMgmtCastOffDate(v.lastCastOff)}</td>,
    status: <td>{v.alongside ? statusChip(v.alongside) : <span className="mgmt-chip mgmt-chip--ghost">Sailed</span>}</td>,
  }
}

export default function VesselGroupBlock({ rows, voyageBlockProps }) {
  const vessels = useMemo(() => groupVoyagesByVessel(rows), [rows])
  const columns = useMemo(() => columnsFor(voyageBlockProps?.breakdown), [voyageBlockProps?.breakdown])
  const [sort, setSort] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  const onSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  const sorted = useMemo(() => sortModalRows(vessels, columns, sort), [vessels, columns, sort])
  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key))

  if (!sorted.length) return <p className="text-steel">No vessels in this view.</p>

  return (
    <div className="mgmt-product-block">
      <div className="table-wrap">
        <table className="data-table mgmt-product-voyage-table">
          <thead>
            <tr>{columns.map((c) => <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />)}</tr>
          </thead>
          <tbody>
            {sorted.map((v) => {
              const open = openKey === v.key
              const cells = vesselCells(v, open)
              return (
                <Fragment key={v.key}>
                  <tr
                    className={`mgmt-vessel-row${open ? ' mgmt-vessel-row--open' : ''}`}
                    tabIndex={0}
                    aria-expanded={open}
                    title="Show this vessel's voyages"
                    onClick={() => toggle(v.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggle(v.key)
                      }
                    }}
                  >
                    {columns.map((c) => <Fragment key={c.key}>{cells[c.key]}</Fragment>)}
                  </tr>
                  {open ? (
                    <tr className="mgmt-vessel-row__voyages">
                      <td colSpan={columns.length}>
                        <VoyageBlock rows={v.voyages} {...voyageBlockProps} />
                      </td>
                    </tr>
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
