import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations, fetchActivityTimeline } from '../api/operations'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchShippingInstruction } from '../api/shippingInstructions'
import { fetchJetties } from '../api/jetties'
import {
  operationIsBerthedForReport,
  buildSingleOperationReportBlock,
} from '../data/dailyActivitiesReportFromApi'
import { downloadDailyActivitiesReportExcel } from '../data/dailyActivitiesReportExcel'
import { usePortScope } from '../context/PortScopeContext'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/allocation.css'

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
  { key: 'demurrageLiabilityFrom', label: 'Demurrage liability from' },
  { key: 'operationStatus', label: 'Operation status' },
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

export default function DailyActivitiesReport() {
  const {
    selectedPortId,
    requiresSelection,
    noPortAssigned,
    noPortMessage,
  } = usePortScope()
  const defaultRange = useMemo(getDefaultDateRange, [])

  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [selectedOperationIds, setSelectedOperationIds] = useState([])
  const [selectedJettyIds, setSelectedJettyIds] = useState([])

  const [jetties, setJetties] = useState([])
  const [berthedOps, setBerthedOps] = useState([])
  const [filterDataLoading, setFilterDataLoading] = useState(false)
  const [filterLoadError, setFilterLoadError] = useState(null)

  const [appliedFilters, setAppliedFilters] = useState(null)
  const [reportVessels, setReportVessels] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)

  useEffect(() => {
    if (selectedPortId == null) {
      setJetties([])
      setBerthedOps([])
      setFilterLoadError(null)
      return
    }
    let cancelled = false
    setFilterDataLoading(true)
    setFilterLoadError(null)
    ;(async () => {
      try {
        const [jetList, ops] = await Promise.all([
          fetchJetties(selectedPortId),
          fetchOperations({ portId: selectedPortId }),
        ])
        if (cancelled) return
        setJetties(Array.isArray(jetList) ? jetList : [])
        const berthed = (Array.isArray(ops) ? ops : []).filter(operationIsBerthedForReport)
        setBerthedOps(berthed)
      } catch (e) {
        if (!cancelled) {
          setFilterLoadError(e?.message || 'Failed to load filters')
          setJetties([])
          setBerthedOps([])
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
    setReportVessels([])
    setReportError(null)
    setSelectedOperationIds([])
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

  const vesselSelectOptions = useMemo(() => {
    return [...berthedOps]
      .sort((a, b) => {
        const na = `${a.vesselName || ''} ${a.referenceNumber || ''}`.toLowerCase()
        const nb = `${b.vesselName || ''} ${b.referenceNumber || ''}`.toLowerCase()
        return na.localeCompare(nb)
      })
      .map((op) => ({
        value: String(op.id),
        label: [op.vesselName || '—', op.referenceNumber].filter(Boolean).join(' · '),
      }))
  }, [berthedOps])

  const canRunReport = selectedPortId != null && !requiresSelection && !noPortAssigned

  const handleGenerateReport = useCallback(async () => {
    if (!canRunReport) return
    setReportLoading(true)
    setReportError(null)
    try {
      const [operations, overview] = await Promise.all([
        fetchOperations({ portId: selectedPortId }),
        fetchAllocationOverview(),
      ])
      const overviewByOpId = new Map()
      for (const row of overview?.queue || []) {
        if (row.operationId != null) overviewByOpId.set(Number(row.operationId), row)
      }

      let ops = (Array.isArray(operations) ? operations : []).filter(operationIsBerthedForReport)

      if (selectedJettyIds.length > 0) {
        const want = new Set(selectedJettyIds.map((id) => Number(id)))
        ops = ops.filter((o) => o.jettyId != null && want.has(Number(o.jettyId)))
      }
      if (selectedOperationIds.length > 0) {
        const want = new Set(selectedOperationIds.map(String))
        ops = ops.filter((o) => want.has(String(o.id)))
      }

      const siIds = [...new Set(ops.map((o) => o.shippingInstructionId).filter(Boolean))]
      const siMap = new Map()
      await Promise.all(
        siIds.map(async (id) => {
          try {
            const si = await fetchShippingInstruction(id)
            siMap.set(id, si)
          } catch {
            siMap.set(id, null)
          }
        })
      )

      const blocks = []
      await Promise.all(
        ops.map(async (op) => {
          try {
            const tl = await fetchActivityTimeline(op.id)
            const events = Array.isArray(tl?.events) ? tl.events : []
            const block = buildSingleOperationReportBlock(
              op,
              siMap.get(op.shippingInstructionId) ?? null,
              overviewByOpId.get(Number(op.id)),
              events,
              startDate,
              endDate
            )
            if (block) blocks.push(block)
          } catch {
            /* skip operation if timeline fails */
          }
        })
      )

      blocks.sort((a, b) => (a.vesselName || '').localeCompare(b.vesselName || ''))
      setReportVessels(blocks)
      setAppliedFilters({
        startDate,
        endDate,
        selectedOperationIds: [...selectedOperationIds],
        selectedJettyIds: [...selectedJettyIds],
      })
    } catch (e) {
      setReportError(e?.message || 'Failed to build report')
      setReportVessels([])
      setAppliedFilters(null)
    } finally {
      setReportLoading(false)
    }
  }, [
    canRunReport,
    selectedPortId,
    selectedJettyIds,
    selectedOperationIds,
    startDate,
    endDate,
  ])

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

  function renderHeaderValue(key, raw) {
    if (key === 'demurrageLiabilityFrom') {
      return formatDateTimeDisplay(raw)
    }
    return raw ?? '—'
  }

  return (
    <div className="allocation-page daily-activities-report">
      <h1 className="page-title">Daily Activities Report</h1>
      <p className="allocation-page__intro">
        At-berth operations for the selected port (including sailed), with activity timeline from Pre / Operational / Post.
        Vessels not yet alongside (no TB / docking) are excluded. Filter by date range and optionally by jetty or operation.
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
        {filterDataLoading && canRunReport && <p className="text-steel">Loading jetties and operations…</p>}
        <div className="daily-activities-report__filter-grid">
          <div className="daily-activities-report__field">
            <label htmlFor="report-start-date" className="daily-activities-report__label">Start date</label>
            <input
              id="report-start-date"
              type="date"
              className="daily-activities-report__input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canRunReport}
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
              disabled={!canRunReport}
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
            disabled={!canRunReport || jettyOptions.length === 0}
          />
          <DropdownMultiSelect
            id="report-vessel"
            label="Operation / vessel (optional, multi-select)"
            placeholder="Select operation..."
            options={vesselSelectOptions}
            selectedValues={selectedOperationIds}
            onChange={setSelectedOperationIds}
            className="daily-activities-report__dropdown"
            disabled={!canRunReport || vesselSelectOptions.length === 0}
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
            disabled={!appliedFilters || reportVessels.length === 0 || exporting}
            title={!appliedFilters || reportVessels.length === 0 ? 'Generate a report first' : 'Download report as Excel'}
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
      ) : reportVessels.length === 0 ? (
        <section className="card">
          <p className="text-steel">No operations match the selected filters or date range (timelog has no rows in range).</p>
        </section>
      ) : (
        reportVessels.map(({ vesselId, vesselName, header, timelog }) => (
          <section key={vesselId} className="card daily-activities-report__vessel">
            <h2 className="daily-activities-report__vessel-title">{vesselName}</h2>

            <div className="daily-activities-report__header">
              <h3 className="daily-activities-report__section-title">Header</h3>
              <dl className="daily-activities-report__header-dl">
                {HEADER_FIELDS.map(({ key, label }) => (
                  <div key={key} className="daily-activities-report__header-row">
                    <dt>{label}</dt>
                    <dd>{renderHeaderValue(key, header[key])}</dd>
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
                      <th className="allocation-table__th">Status</th>
                      <th className="allocation-table__th">Date time</th>
                      <th className="allocation-table__th">End Date time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timelog.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-steel">No timelog entries.</td>
                      </tr>
                    ) : (
                      timelog.map((row, idx) => (
                        <tr key={idx} className="allocation-table__row">
                          <td>{row.category || '—'}</td>
                          <td>{row.remark || '—'}</td>
                          <td>{row.status || '—'}</td>
                          <td>{formatDateTimeDisplay(row.dateTime)}</td>
                          <td>{formatDateTimeDisplay(row.endDateTime)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
