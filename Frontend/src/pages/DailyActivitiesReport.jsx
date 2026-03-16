import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  allocationPlan,
  BERTH_IDS,
  getLoadingOperationCargo,
  getArrivalNor,
  getBerthingEvents,
  getAtBerthOperations,
  vessels,
} from '../data/mockData'
import { buildDailyActivitiesReport } from '../data/reportData'
import { downloadDailyActivitiesReportExcel } from '../data/dailyActivitiesReportExcel'
import { useLoading } from '../context/LoadingContext'
import { useClearance } from '../context/ClearanceContext'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import '../styles/allocation.css'

function formatDateTimeDisplay(value) {
  if (!value || !value.trim()) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

const HEADER_FIELDS = [
  { key: 'jetty', label: 'Jetty' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'commodity', label: 'Commodity' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'stowage', label: 'Stowage' },
  { key: 'loadPort', label: 'Load port' },
  { key: 'dischPort', label: 'Disch port' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'surveyor', label: 'Surveyor' },
  { key: 'agent', label: 'Agent' },
]

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

/** Build vessel options for multi-select (allocation + at-berth, unique by vesselId) */
function getVesselOptions() {
  const loadingOps = getAtBerthOperations('Loading') || []
  const unloadingOps = getAtBerthOperations('Unloading') || []
  const planVessels = (allocationPlan || []).map((p) => ({ vesselId: p.vesselId, vesselName: p.vesselName || p.vesselId }))
  const atBerthVessels = [...loadingOps, ...unloadingOps].map((o) => ({ vesselId: o.vesselId, vesselName: o.vesselName || o.vesselId }))
  const byId = new Map()
  ;[...planVessels, ...atBerthVessels].forEach((v) => {
    if (!byId.has(v.vesselId)) byId.set(v.vesselId, v)
  })
  return Array.from(byId.values()).sort((a, b) => (a.vesselName || '').localeCompare(b.vesselName || ''))
}

const JETTY_OPTIONS = BERTH_IDS

export default function DailyActivitiesReport() {
  const { getSteps, getPreChecking, getPostChecking, getLoadingOperation } = useLoading()
  const { getClearance } = useClearance()
  const defaultRange = useMemo(getDefaultDateRange, [])

  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [selectedVesselIds, setSelectedVesselIds] = useState([])
  const [selectedJettyIds, setSelectedJettyIds] = useState([])

  const [appliedFilters, setAppliedFilters] = useState(null)

  const vesselOptions = useMemo(getVesselOptions, [])
  const jettyOptions = useMemo(
    () => JETTY_OPTIONS.map((id) => ({ value: id, label: id })),
    []
  )
  const vesselSelectOptions = useMemo(
    () => vesselOptions.map(({ vesselId, vesselName }) => ({ value: vesselId, label: vesselName || vesselId })),
    [vesselOptions]
  )

  const report = useMemo(() => {
    const filters = appliedFilters || {
      startDate,
      endDate,
      selectedVesselIds,
      selectedJettyIds,
    }
    const deps = {
      allocationPlan,
      getLoadingOperationCargo,
      getArrivalNor,
      getBerthingEvents,
      getPreChecking,
      getPostChecking,
      getLoadingOperation,
      getClearance,
      getAtBerthOperations,
      getSteps,
      vessels,
    }
    return buildDailyActivitiesReport(filters, deps)
  }, [appliedFilters, startDate, endDate, selectedVesselIds, selectedJettyIds, getPreChecking, getPostChecking, getLoadingOperation, getClearance])

  const reportVessels = report.vessels || []

  const handleGenerateReport = useCallback(() => {
    setAppliedFilters({
      startDate,
      endDate,
      selectedVesselIds: [...selectedVesselIds],
      selectedJettyIds: [...selectedJettyIds],
    })
  }, [startDate, endDate, selectedVesselIds, selectedJettyIds])

  const [exporting, setExporting] = useState(false)
  const handleDownloadExcel = useCallback(async () => {
    if (!appliedFilters || reportVessels.length === 0) return
    setExporting(true)
    try {
      await downloadDailyActivitiesReportExcel(
        reportVessels,
        appliedFilters.startDate,
        appliedFilters.endDate
      )
    } finally {
      setExporting(false)
    }
  }, [appliedFilters, reportVessels])

  return (
    <div className="allocation-page daily-activities-report">
      <h1 className="page-title">Daily Activities Report</h1>
      <p className="allocation-page__intro">
        End-to-end activities from Vessel Arrived (TA) until Vessel Cast Off / Sailed. Filter by date range and optionally by vessel or jetty.
      </p>
      <p className="text-steel">
        <Link to="/reporting" className="link">← Back to Reporting</Link>
      </p>

      <section className="card daily-activities-report__filters">
        <h2 className="card__title">Filters</h2>
        <div className="daily-activities-report__filter-grid">
          <div className="daily-activities-report__field">
            <label htmlFor="report-start-date" className="daily-activities-report__label">Start date</label>
            <input
              id="report-start-date"
              type="date"
              className="daily-activities-report__input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="daily-activities-report__field">
            <label htmlFor="report-end-date" className="daily-activities-report__label">End date</label>
            <input
              id="report-end-date"
              type="date"
              className="daily-activities-report__input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="daily-activities-report__multi-section">
          <DropdownMultiSelect
            id="report-jetty"
            label="Jetty (optional, multi-select)"
            placeholder="Select jetty..."
            options={jettyOptions}
            selectedValues={selectedJettyIds}
            onChange={setSelectedJettyIds}
            className="daily-activities-report__dropdown"
          />
          <DropdownMultiSelect
            id="report-vessel"
            label="Vessel (optional, multi-select)"
            placeholder="Select vessel..."
            options={vesselSelectOptions}
            selectedValues={selectedVesselIds}
            onChange={setSelectedVesselIds}
            className="daily-activities-report__dropdown"
          />
        </div>
        <div className="daily-activities-report__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleGenerateReport}
          >
            Generate Report
          </button>
          <button
            type="button"
            className="btn btn--secondary daily-activities-report__download-btn"
            onClick={handleDownloadExcel}
            disabled={!appliedFilters || reportVessels.length === 0 || exporting}
            title={!appliedFilters || reportVessels.length === 0 ? 'Generate a report first' : 'Download report as Excel'}
          >
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </section>

      {!appliedFilters ? (
        <section className="card">
          <p className="text-steel">Set filters and click <strong>Generate Report</strong> to view the report.</p>
        </section>
      ) : reportVessels.length === 0 ? (
        <section className="card">
          <p className="text-steel">No vessels match the selected filters.</p>
        </section>
      ) : (
        reportVessels.map(({ vesselId, vesselName, header, timelog, progress }) => (
          <section key={vesselId} className="card daily-activities-report__vessel">
            <h2 className="daily-activities-report__vessel-title">{vesselName}</h2>

            <div className="daily-activities-report__header">
              <h3 className="daily-activities-report__section-title">Header</h3>
              <dl className="daily-activities-report__header-dl">
                {HEADER_FIELDS.map(({ key, label }) => (
                  <div key={key} className="daily-activities-report__header-row">
                    <dt>{label}</dt>
                    <dd>{header[key] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="daily-activities-report__timelog">
              <h3 className="daily-activities-report__section-title">Timelog</h3>
              <div className="table-wrap">
                <table className="data-table allocation-table daily-activities-report__table">
                  <thead>
                    <tr>
                      <th className="allocation-table__th">Activity Category</th>
                      <th className="allocation-table__th">Remark</th>
                      <th className="allocation-table__th">Date time</th>
                      <th className="allocation-table__th">End Date time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelog.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-steel">No timelog entries.</td>
                      </tr>
                    ) : (
                      timelog.map((row, idx) => (
                        <tr key={idx} className="allocation-table__row">
                          <td>{row.category || '—'}</td>
                          <td>{row.remark || '—'}</td>
                          <td>{formatDateTimeDisplay(row.dateTime)}</td>
                          <td>{formatDateTimeDisplay(row.endDateTime)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="daily-activities-report__progress">
              <h3 className="daily-activities-report__section-title">Progress Loading / Unloading</h3>
              <dl className="daily-activities-report__header-dl daily-activities-report__progress-dl">
                <div className="daily-activities-report__header-row">
                  <dt>QTY LOAD / DISCHARGE</dt>
                  <dd>{progress.qtyLoadDischarge}</dd>
                </div>
                <div className="daily-activities-report__header-row">
                  <dt>RATE</dt>
                  <dd>{progress.rate}</dd>
                </div>
                <div className="daily-activities-report__header-row">
                  <dt>BALANCE</dt>
                  <dd>{progress.balance}</dd>
                </div>
              </dl>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
