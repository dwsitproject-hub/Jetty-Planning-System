/**
 * By Vessel: summary strip + one row per vessel (loading and unloading together); a row opens its detail.
 */
import { Fragment, useCallback, useMemo, useState } from 'react'
import { groupVoyagesByVessel, summarizeVessels } from '../../utils/managementDashboardByVessel.js'
import { sortModalRows } from '../../utils/widgetDetailSort.js'
import VesselDetail from './VesselDetail.jsx'
import { MovedBarCell, RateRangeCell } from './VesselRowVisuals.jsx'
import VesselSummaryStrip from './VesselSummaryStrip.jsx'
import { SortHeader, statusLabel } from './VoyageDrilldownTable.jsx'

const COLUMNS = [
  { key: 'vessel', label: 'Vessel', sortValue: (v) => v.vessel },
  { key: 'voyages', label: 'Voyages', align: 'right', sortValue: (v) => v.callCount },
  { key: 'moved', label: 'Moved (MT)', align: 'right', sortValue: (v) => v.movedTotal },
  { key: 'flow', label: 'Avg achieved rate', headerLines: ['Avg achieved', 'rate'], align: 'right', sortValue: (v) => v.rate },
  { key: 'activeFlow', label: 'Avg active rate', headerLines: ['Avg active', 'rate'], align: 'right', sortValue: (v) => v.activeRate },
]

function callMix(v) {
  const parts = []
  if (v.loadCalls) parts.push(`${v.loadCalls} load`)
  if (v.unloadCalls) parts.push(`${v.unloadCalls} unload`)
  return parts.join(' · ')
}

function vesselCells(v, open, summary) {
  return {
    vessel: (
      <td>
        <span className="mgmt-vessel-row__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <b>{v.vessel}</b>
        {v.alongside ? <span className="mgmt-vdot" title={`At berth now · ${statusLabel(v.alongside)}`} /> : null}
        <br />
        <span className="text-steel" style={{ fontSize: 11 }}>{v.movedLines.map((l) => l.label).join(' · ') || '—'}</span>
      </td>
    ),
    voyages: (
      <td className="mgmt-r">
        <b>{v.callCount}</b>
        <br />
        <span className="text-steel" style={{ fontSize: 11 }}>{callMix(v)}</span>
      </td>
    ),
    moved: <td className="mgmt-r mgmt-moved"><MovedBarCell total={v.movedTotal} scaleMax={summary.movedScaleMax} /></td>,
    flow: <td className="mgmt-r"><RateRangeCell value={v.rate} range={v.rateRange} scaleMax={summary.rateScaleMax} /></td>,
    activeFlow: <td className="mgmt-r"><RateRangeCell value={v.activeRate} range={v.activeRateRange} scaleMax={summary.rateScaleMax} /></td>,
  }
}

export default function VesselGroupBlock({ rows, voyageBlockProps }) {
  const vessels = useMemo(() => groupVoyagesByVessel(rows), [rows])
  const summary = useMemo(() => summarizeVessels(vessels), [vessels])
  const [sort, setSort] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  const onSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  const sorted = useMemo(() => sortModalRows(vessels, COLUMNS, sort), [vessels, sort])
  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key))

  if (!sorted.length) return <p className="text-steel">No vessels in this view.</p>

  return (
    <div className="mgmt-product-block">
      <VesselSummaryStrip summary={summary} />
      <div className="table-wrap">
        <table className="data-table mgmt-product-voyage-table mgmt-vessel-table">
          <thead>
            <tr>{COLUMNS.map((c) => <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />)}</tr>
          </thead>
          <tbody>
            {sorted.map((v) => {
              const open = openKey === v.key
              const cells = vesselCells(v, open, summary)
              return (
                <Fragment key={v.key}>
                  <tr
                    className={`mgmt-vessel-row${open ? ' mgmt-vessel-row--open' : ''}`}
                    tabIndex={0}
                    aria-expanded={open}
                    title="Show this vessel's details"
                    onClick={() => toggle(v.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggle(v.key)
                      }
                    }}
                  >
                    {COLUMNS.map((c) => <Fragment key={c.key}>{cells[c.key]}</Fragment>)}
                  </tr>
                  {open ? (
                    <tr className="mgmt-vessel-row__voyages">
                      <td colSpan={COLUMNS.length}>
                        <VesselDetail vessel={v} voyageBlockProps={voyageBlockProps} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-steel mgmt-sub mgmt-vessel-note">
        <span className="mgmt-vdot" /> At berth now · Line under a rate: slowest to fastest voyage, dot = average · click a vessel for its time split and voyages
      </p>
    </div>
  )
}
