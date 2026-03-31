import { useState, useMemo, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations } from '../api/operations'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchShippingInstruction } from '../api/shippingInstructions'
import { fetchJetties } from '../api/jetties'
import {
  buildDetailRowFromOperation,
  buildDetailRowFromQueueRow,
  computeJettyUtilizationSummary,
  detailRowOverlapsRange,
  groupDetailRowsByJetty,
  jettyShortName,
  resolveJettyIdFromDisplay,
} from '../data/jettyVesselReportFromApi'
import { downloadJettyVesselReportExcel } from '../data/jettyVesselReportExcel'
import { usePortScope } from '../context/PortScopeContext'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/allocation.css'

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

const TABLE_COLUMNS = [
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
  {
    key: 'shippingInstruction',
    label: 'SI / Ref',
    getValue: (r) => r.shippingInstruction || '—',
    getSortValue: (r) => (r.shippingInstruction || '').toLowerCase(),
  },
  { key: 'vessel', label: 'Vessel', getValue: (r) => <strong>{r.vessel || '—'}</strong>, getSortValue: (r) => (r.vessel || '').toLowerCase() },
  { key: 'purpose', label: 'Purpose', getValue: (r) => r.purpose || '—', getSortValue: (r) => (r.purpose || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getValue: (r) => formatDateTimeDisplay(r.eta), getSortValue: (r) => (r.eta ? new Date(r.eta).getTime() : 0) },
  {
    key: 'arrivalDateTime',
    label: 'Arrival Date Time',
    getValue: (r) => formatDateTimeDisplay(r.arrivalDateTime),
    getSortValue: (r) => (r.arrivalDateTime ? new Date(r.arrivalDateTime).getTime() : 0),
  },
  { key: 'etb', label: 'ETB', getValue: (r) => formatDateTimeDisplay(r.etb), getSortValue: (r) => (r.etb ? new Date(r.etb).getTime() : 0) },
  {
    key: 'berthedDateTime',
    label: 'Berthed Date Time',
    getValue: (r) => formatDateTimeDisplay(r.berthedDateTime),
    getSortValue: (r) => (r.berthedDateTime ? new Date(r.berthedDateTime).getTime() : 0),
  },
  {
    key: 'sailedOffDateTime',
    label: 'Sailed off Date Time',
    getValue: (r) => formatDateTimeDisplay(r.sailedOffDateTime),
    getSortValue: (r) => (r.sailedOffDateTime ? new Date(r.sailedOffDateTime).getTime() : 0),
  },
  { key: 'commodity', label: 'Commodity', getValue: (r) => r.commodity || '—', getSortValue: (r) => (r.commodity || '').toLowerCase() },
  { key: 'quantity', label: 'Quantity', getValue: (r) => r.quantity || '—', getSortValue: (r) => (r.quantity || '').toLowerCase() },
  { key: 'stowage', label: 'Stowage', getValue: (r) => r.stowage || '—', getSortValue: (r) => (r.stowage || '').toLowerCase() },
  { key: 'loadPort', label: 'Load port', getValue: (r) => r.loadPort || '—', getSortValue: (r) => (r.loadPort || '').toLowerCase() },
  { key: 'dischPort', label: 'Disch port', getValue: (r) => r.dischPort || '—', getSortValue: (r) => (r.dischPort || '').toLowerCase() },
  { key: 'shipper', label: 'Shipper', getValue: (r) => r.shipper || '—', getSortValue: (r) => (r.shipper || '').toLowerCase() },
  { key: 'consignee', label: 'Consignee', getValue: (r) => r.consignee || '—', getSortValue: (r) => (r.consignee || '').toLowerCase() },
  { key: 'surveyor', label: 'Surveyor', getValue: (r) => r.surveyor || '—', getSortValue: (r) => (r.surveyor || '').toLowerCase() },
  { key: 'agent', label: 'Agent', getValue: (r) => r.agent || '—', getSortValue: (r) => (r.agent || '').toLowerCase() },
]

export default function VesselReport() {
  const { selectedPortId, requiresSelection, noPortAssigned, noPortMessage } = usePortScope()
  const defaultRange = useMemo(getDefaultDateRange, [])

  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [selectedJettyIds, setSelectedJettyIds] = useState([])
  const [jetties, setJetties] = useState([])
  const [filterDataLoading, setFilterDataLoading] = useState(false)
  const [filterLoadError, setFilterLoadError] = useState(null)

  const [appliedFilters, setAppliedFilters] = useState(null)
  const [reportRows, setReportRows] = useState([])
  const [reportSummary, setReportSummary] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [exporting, setExporting] = useState(false)

  const canRunReport = selectedPortId != null && !requiresSelection && !noPortAssigned

  useEffect(() => {
    if (selectedPortId == null) {
      setJetties([])
      setFilterLoadError(null)
      return
    }
    let cancelled = false
    setFilterDataLoading(true)
    setFilterLoadError(null)
    ;(async () => {
      try {
        const jetList = await fetchJetties(selectedPortId)
        if (cancelled) return
        setJetties(Array.isArray(jetList) ? jetList : [])
      } catch (e) {
        if (!cancelled) {
          setFilterLoadError(e?.message || 'Failed to load jetties')
          setJetties([])
        }
      } finally {
        if (!cancelled) setFilterDataLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedPortId])

  useEffect(() => {
    setAppliedFilters(null)
    setReportRows([])
    setReportSummary(null)
    setReportError(null)
    setSelectedJettyIds([])
  }, [selectedPortId])

  const jettyOptions = useMemo(
    () =>
      jetties.map((j) => ({
        value: String(j.id),
        label: j.name || `Jetty ${j.id}`,
      })),
    [jetties]
  )

  const groupedByJetty = useMemo(() => groupDetailRowsByJetty(reportRows), [reportRows])

  const handleGenerateReport = useCallback(async () => {
    if (!canRunReport) return
    setReportLoading(true)
    setReportError(null)
    try {
      const jetList = jetties.length > 0 ? jetties : await fetchJetties(selectedPortId)
      const [operations, overview] = await Promise.all([
        fetchOperations({ portId: selectedPortId }),
        fetchAllocationOverview(),
      ])

      const queue = Array.isArray(overview?.queue) ? overview.queue : []
      const overviewByOpId = new Map()
      for (const row of queue) {
        if (row.operationId != null) overviewByOpId.set(Number(row.operationId), row)
      }

      const jSet =
        selectedJettyIds.length > 0 ? new Set(selectedJettyIds.map(String)) : null

      const opsWithJetty = (Array.isArray(operations) ? operations : []).filter((o) => {
        if (o.jettyId == null) return false
        if (jSet && !jSet.has(String(o.jettyId))) return false
        return true
      })

      const siIds = [...new Set(opsWithJetty.map((o) => o.shippingInstructionId).filter(Boolean))]
      const siMap = new Map()
      await Promise.all(
        siIds.map(async (id) => {
          try {
            siMap.set(id, await fetchShippingInstruction(id))
          } catch {
            siMap.set(id, null)
          }
        })
      )

      const detailRows = []
      for (const op of opsWithJetty) {
        const r = buildDetailRowFromOperation(
          op,
          siMap.get(op.shippingInstructionId) ?? null,
          overviewByOpId.get(Number(op.id))
        )
        if (!detailRowOverlapsRange(r, startDate, endDate)) continue
        detailRows.push(r)
      }

      for (const q of queue) {
        if (q.operationId != null) continue
        if (!q.jetty || !q.shippingInstructionId) continue
        const jid = resolveJettyIdFromDisplay(q.jetty, jetList)
        if (jSet && (!jid || !jSet.has(String(jid)))) continue
        const r = buildDetailRowFromQueueRow(q, jetList)
        if (!detailRowOverlapsRange(r, startDate, endDate)) continue
        detailRows.push(r)
      }

      const summary = computeJettyUtilizationSummary(
        detailRows,
        jetList,
        startDate,
        endDate,
        jSet
      )

      detailRows.sort((a, b) => {
        const ja = (a.jetty || '').localeCompare(b.jetty || '')
        if (ja !== 0) return ja
        const ta = a.berthedDateTime ? new Date(a.berthedDateTime).getTime() : 0
        const tb = b.berthedDateTime ? new Date(b.berthedDateTime).getTime() : 0
        return ta - tb || (a.vessel || '').localeCompare(b.vessel || '')
      })

      setReportRows(detailRows)
      setReportSummary(summary)
      setAppliedFilters({
        startDate,
        endDate,
        selectedJettyIds: [...selectedJettyIds],
      })
    } catch (e) {
      setReportError(e?.message || 'Failed to build report')
      setReportRows([])
      setReportSummary(null)
      setAppliedFilters(null)
    } finally {
      setReportLoading(false)
    }
  }, [canRunReport, selectedPortId, jetties, selectedJettyIds, startDate, endDate])

  const filterKeys = TABLE_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'berthedDateTime', dir: 'desc' })

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredRows = reportRows.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const raw = r[key]
      const val = typeof raw === 'string' ? raw : formatDateTimeDisplay(raw) || ''
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedRows = [...filteredRows].sort((a, b) => {
    const col = TABLE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const handleDownloadExcel = useCallback(async () => {
    if (!appliedFilters || reportRows.length === 0) return
    setExporting(true)
    try {
      await downloadJettyVesselReportExcel(reportSummary, reportRows, appliedFilters.startDate, appliedFilters.endDate)
    } finally {
      setExporting(false)
    }
  }, [appliedFilters, reportRows, reportSummary])

  return (
    <div className="allocation-page daily-activities-report">
      <h1 className="page-title">Jetty - Vessel Report</h1>
      <p className="allocation-page__intro">
        Jetty utilization and allocation: which vessel is on which jetty, with berth-time overlap in the selected window.
        Includes operations and approved incoming shipping instructions already assigned to a jetty.
      </p>
      <p className="text-steel">
        <Link to="/reporting" className="link">← Back to Reporting</Link>
      </p>

      {noPortAssigned && (
        <section className="card">
          <p className="text-steel">{noPortMessage}</p>
        </section>
      )}
      {requiresSelection && (
        <section className="card">
          <p className="text-steel">Select a port in the header to run this report.</p>
        </section>
      )}

      <section className="card daily-activities-report__filters">
        <h2 className="card__title">Filters</h2>
        {filterLoadError && <p className="text-steel" role="alert">{filterLoadError}</p>}
        {filterDataLoading && canRunReport && <p className="text-steel">Loading jetties…</p>}
        <div className="daily-activities-report__filter-grid">
          <div className="daily-activities-report__field">
            <label htmlFor="jv-report-start-date" className="daily-activities-report__label">Start date</label>
            <input
              id="jv-report-start-date"
              type="date"
              className="daily-activities-report__input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canRunReport}
            />
          </div>
          <div className="daily-activities-report__field">
            <label htmlFor="jv-report-end-date" className="daily-activities-report__label">End date</label>
            <input
              id="jv-report-end-date"
              type="date"
              className="daily-activities-report__input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!canRunReport}
            />
          </div>
        </div>
        <div className="daily-activities-report__multi-section">
          <DropdownMultiSelect
            id="jv-report-jetty"
            label="Jetty (optional, multi-select)"
            placeholder="All jetties…"
            options={jettyOptions}
            selectedValues={selectedJettyIds}
            onChange={setSelectedJettyIds}
            className="daily-activities-report__dropdown"
            disabled={!canRunReport || jettyOptions.length === 0}
          />
        </div>
        <div className="daily-activities-report__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleGenerateReport}
            disabled={!canRunReport || reportLoading}
          >
            {reportLoading ? 'Generating…' : 'Generate Report'}
          </button>
          <button
            type="button"
            className="btn btn--secondary daily-activities-report__download-btn"
            onClick={handleDownloadExcel}
            disabled={!appliedFilters || reportRows.length === 0 || exporting}
            title={!appliedFilters || reportRows.length === 0 ? 'Generate a report first' : 'Download Excel'}
          >
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        {reportError && <p className="text-steel" role="alert">{reportError}</p>}
      </section>

      {!appliedFilters ? (
        <section className="card">
          <p className="text-steel">
            {canRunReport
              ? <>Set filters and click <strong>Generate Report</strong> to view the report.</>
              : <>Select a port to use this report.</>}
          </p>
        </section>
      ) : reportRows.length === 0 ? (
        <section className="card">
          <p className="text-steel">No vessels match the selected filters or window.</p>
        </section>
      ) : (
        <>
          {reportSummary?.byJetty?.length > 0 && (
            <section className="card at-berth-list-section">
              <h2 className="card__title">Jetty utilization (summary)</h2>
              <p className="text-steel allocation-page__intro" style={{ marginTop: 0 }}>
                Berth hours count time alongside through sailed (or end of the report window if still berthed).
                Utilization % = berth hours ÷ hours in the report window (per jetty; one vessel at a time per jetty).
              </p>
              <div className="table-wrap">
                <table className="data-table allocation-table">
                  <thead>
                    <tr>
                      <th className="allocation-table__th">Jetty</th>
                      <th className="allocation-table__th">Calls</th>
                      <th className="allocation-table__th">Berth hours (in range)</th>
                      <th className="allocation-table__th">Hours in window</th>
                      <th className="allocation-table__th">Utilization %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportSummary.byJetty.map((j) => (
                      <tr key={j.jettyId} className="allocation-table__row">
                        <td>{j.jettyName}</td>
                        <td>{j.calls}</td>
                        <td>{j.berthHoursRounded}</td>
                        <td>{j.hoursInWindow}</td>
                        <td>{j.utilizationPct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card at-berth-list-section">
            <h2 className="card__title">By jetty</h2>
            <div className="jetty-vessel-report__groups">
              {groupedByJetty.map(([jettyLabel, rows]) => {
                const totalCalls = rows.length
                const sumRow = reportSummary?.byJetty?.find(
                  (s) =>
                    s.jettyName === jettyLabel || jettyShortName(s.jettyName) === jettyShortName(jettyLabel)
                )
                const sub =
                  sumRow != null
                    ? `${totalCalls} call(s) · ${sumRow.berthHoursRounded} berth h · ${sumRow.utilizationPct}% utilization`
                    : `${totalCalls} call(s)`
                return (
                  <details key={jettyLabel} className="jetty-vessel-report__details" open>
                    <summary className="jetty-vessel-report__summary">
                      <span className="jetty-vessel-report__summary-title">{jettyLabel}</span>
                      <span className="text-steel jetty-vessel-report__summary-meta">{sub}</span>
                    </summary>
                    <ul className="jetty-vessel-report__list">
                      {rows.map((r) => (
                        <li key={r.rowId} className="jetty-vessel-report__item">
                          <strong>{r.vessel}</strong>
                          {' · '}
                          <span>{r.shippingInstruction}</span>
                          {r.purpose ? ` · ${r.purpose}` : ''}
                          <span className="text-steel">
                            {' — '}
                            TB {formatDateTimeDisplay(r.berthedDateTime)}
                            {' → '}
                            {r.sailedOffDateTime ? formatDateTimeDisplay(r.sailedOffDateTime) : '…'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )
              })}
            </div>
          </section>

          <section className="card at-berth-list-section">
            <h2 className="card__title">Full detail</h2>
            <div className="table-wrap">
              <table className="data-table allocation-table">
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((col) => (
                      <th key={col.key} className="allocation-table__th">
                        <button
                          type="button"
                          className="allocation-table__sort"
                          onClick={() => handleSort(col.key)}
                          title={`Sort by ${col.label}`}
                        >
                          {col.label}
                          <span className="allocation-table__sort-icon">
                            {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                  <tr className="allocation-table__filter-row">
                    {TABLE_COLUMNS.map((col) => (
                      <th key={col.key}>
                        <input
                          type="text"
                          className="allocation-table__filter"
                          placeholder={`Filter ${col.label}`}
                          value={filters[col.key]}
                          onChange={(e) => updateFilter(col.key, e.target.value)}
                          aria-label={`Filter by ${col.label}`}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.rowId} className="allocation-table__row">
                      {TABLE_COLUMNS.map((col) => (
                        <td key={col.key}>{col.getValue(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
