import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { allocationPlan, BERTH_IDS, getLoadingOperationCargo, getBerthingEvents } from '../data/mockData'
import { buildJettyVesselReport } from '../data/jettyVesselReportData'
import { downloadJettyVesselReportExcel } from '../data/jettyVesselReportExcel'
import { useClearance } from '../context/ClearanceContext'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/allocation.css'

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

const JETTY_OPTIONS = BERTH_IDS.map((id) => ({ value: id, label: id }))

const TABLE_COLUMNS = [
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
  { key: 'vessel', label: 'Vessel', getValue: (r) => <strong>{r.vessel || '—'}</strong>, getSortValue: (r) => (r.vessel || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getValue: (r) => formatDateTimeDisplay(r.eta), getSortValue: (r) => (r.eta ? new Date(r.eta).getTime() : 0) },
  { key: 'arrivalDateTime', label: 'Arrival Date Time', getValue: (r) => formatDateTimeDisplay(r.arrivalDateTime), getSortValue: (r) => (r.arrivalDateTime ? new Date(r.arrivalDateTime).getTime() : 0) },
  { key: 'etb', label: 'ETB', getValue: (r) => formatDateTimeDisplay(r.etb), getSortValue: (r) => (r.etb ? new Date(r.etb).getTime() : 0) },
  { key: 'berthedDateTime', label: 'Berthed Date Time', getValue: (r) => formatDateTimeDisplay(r.berthedDateTime), getSortValue: (r) => (r.berthedDateTime ? new Date(r.berthedDateTime).getTime() : 0) },
  { key: 'sailedOffDateTime', label: 'Sailed off Date Time', getValue: (r) => formatDateTimeDisplay(r.sailedOffDateTime), getSortValue: (r) => (r.sailedOffDateTime ? new Date(r.sailedOffDateTime).getTime() : 0) },
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
  const { getClearance } = useClearance()
  const defaultRange = useMemo(getDefaultDateRange, [])

  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [selectedJettyIds, setSelectedJettyIds] = useState([])
  const [appliedFilters, setAppliedFilters] = useState(null)
  const [exporting, setExporting] = useState(false)

  const report = useMemo(() => {
    const filters = appliedFilters || { startDate, endDate, selectedJettyIds }
    const deps = {
      allocationPlan,
      getLoadingOperationCargo,
      getBerthingEvents,
      getClearance,
    }
    return buildJettyVesselReport(filters, deps)
  }, [appliedFilters, startDate, endDate, selectedJettyIds, getClearance])

  const reportRows = report.rows || []

  const filterKeys = TABLE_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vessel', dir: 'asc' })

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

  const handleGenerateReport = useCallback(() => {
    setAppliedFilters({
      startDate,
      endDate,
      selectedJettyIds: [...selectedJettyIds],
    })
  }, [startDate, endDate, selectedJettyIds])

  const handleDownloadExcel = useCallback(async () => {
    if (!appliedFilters || reportRows.length === 0) return
    setExporting(true)
    try {
      await downloadJettyVesselReportExcel(
        reportRows,
        appliedFilters.startDate,
        appliedFilters.endDate
      )
    } finally {
      setExporting(false)
    }
  }, [appliedFilters, reportRows])

  return (
    <div className="allocation-page daily-activities-report">
      <h1 className="page-title">Jetty - Vessel Report</h1>
      <p className="allocation-page__intro">
        List of vessels and their details that have been allocated and berthed into a jetty. Filter by date range and jetty, then generate the report.
      </p>
      <p className="text-steel">
        <Link to="/reporting" className="link">← Back to Reporting</Link>
      </p>

      <section className="card daily-activities-report__filters">
        <h2 className="card__title">Filters</h2>
        <div className="daily-activities-report__filter-grid">
          <div className="daily-activities-report__field">
            <label htmlFor="jv-report-start-date" className="daily-activities-report__label">Start date</label>
            <input
              id="jv-report-start-date"
              type="date"
              className="daily-activities-report__input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
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
            />
          </div>
          <DropdownMultiSelect
            id="jv-report-jetty"
            label="Jetty (optional, multi-select)"
            placeholder="Select jetty..."
            options={JETTY_OPTIONS}
            selectedValues={selectedJettyIds}
            onChange={setSelectedJettyIds}
            className="daily-activities-report__dropdown"
          />
        </div>
        <div className="daily-activities-report__actions">
          <button type="button" className="btn btn--primary" onClick={handleGenerateReport}>
            Generate Report
          </button>
          <button
            type="button"
            className="btn btn--secondary daily-activities-report__download-btn"
            onClick={handleDownloadExcel}
            disabled={!appliedFilters || reportRows.length === 0 || exporting}
            title={!appliedFilters || reportRows.length === 0 ? 'Generate a report first' : 'Download report as Excel'}
          >
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </section>

      {!appliedFilters ? (
        <section className="card">
          <p className="text-steel">Set filters and click <strong>Generate Report</strong> to view the report.</p>
        </section>
      ) : reportRows.length === 0 ? (
        <section className="card">
          <p className="text-steel">No vessels match the selected filters.</p>
        </section>
      ) : (
        <section className="card at-berth-list-section">
          <h2 className="card__title">Report</h2>
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
                  <tr key={r.vesselId} className="allocation-table__row">
                    {TABLE_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getValue(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
