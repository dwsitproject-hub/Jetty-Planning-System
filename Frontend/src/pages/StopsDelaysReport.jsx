import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchNoFlowReport } from '../api/noFlowReport'
import StopsReasonBars from '../components/stopsreport/StopsReasonBars'
import StopsSummaryTiles from '../components/stopsreport/StopsSummaryTiles'
import { StopsList, VesselReasonMatrix } from '../components/stopsreport/StopsReportTables'
import { usePortScope } from '../context/PortScopeContext'
import { downloadNoFlowReportExcel } from '../data/noFlowReportExcel'
import { dateInputsToRange, toDateInput } from '../utils/noFlowReportView'
import '../styles/allocation.css'
import '../styles/stops-report.css'

const DAY_MS = 86400000

/** Initial period: query params from the dashboard link, else the last 30 days. */
function initialFilters(params) {
  const today = Date.now()
  const from = params.get('from')
  const to = params.get('to')
  const purpose = params.get('purpose')
  return {
    from: from ? toDateInput(new Date(from).getTime()) : toDateInput(today - 29 * DAY_MS),
    to: to ? toDateInput(new Date(to).getTime() - 1) : toDateInput(today),
    purpose: purpose === 'Loading' || purpose === 'Unloading' ? purpose : '',
  }
}

export default function StopsDelaysReport() {
  const { t, i18n } = useTranslation('pages')
  const [params] = useSearchParams()
  const { selectedPortId, requiresSelection, noPortAssigned, noPortMessage } = usePortScope()
  const [filters, setFilters] = useState(() => initialFilters(params))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canRun = selectedPortId != null && !requiresSelection && !noPortAssigned
  const datesValid = Boolean(filters.from && filters.to && filters.from <= filters.to)

  const run = useCallback(async () => {
    if (!canRun || !datesValid) return
    setLoading(true)
    setError('')
    try {
      setReport(await fetchNoFlowReport({ ...dateInputsToRange(filters.from, filters.to), purpose: filters.purpose || null }))
    } catch (e) {
      setReport(null)
      setError(e?.status === 404 ? t('stopsReportUnavailable') : e?.message || t('stopsReportLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [canRun, datesValid, filters, t])

  useEffect(() => {
    setReport(null)
    if (canRun) run()
    // Reload when the port changes; filter edits wait for the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortId, canRun])

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const empty = useMemo(() => report && report.stops.length === 0, [report])

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('stopsReportTitle')}</h1>
      <p className="allocation-page__intro">{t('stopsReportIntro')}</p>
      <p className="text-steel"><Link to="/reporting" className="link">{t('stopsReportBack')}</Link></p>

      {noPortAssigned ? <section className="card"><p className="text-steel">{noPortMessage}</p></section> : null}
      {requiresSelection ? <section className="card"><p className="text-steel">{t('cargoMovementSelectPort')}</p></section> : null}

      <section className="card">
        <form className="stops-report__filters" onSubmit={(e) => { e.preventDefault(); run() }}>
          <div className="daily-activities-report__field">
            <label htmlFor="stops-from" className="daily-activities-report__label">{t('stopsReportFrom')}</label>
            <input id="stops-from" type="date" className="daily-activities-report__input" value={filters.from} max={filters.to} onChange={(e) => set({ from: e.target.value })} disabled={!canRun} />
          </div>
          <div className="daily-activities-report__field">
            <label htmlFor="stops-to" className="daily-activities-report__label">{t('stopsReportTo')}</label>
            <input id="stops-to" type="date" className="daily-activities-report__input" value={filters.to} min={filters.from} onChange={(e) => set({ to: e.target.value })} disabled={!canRun} />
          </div>
          <div className="daily-activities-report__field">
            <label htmlFor="stops-purpose" className="daily-activities-report__label">{t('stopsReportPurpose')}</label>
            <select id="stops-purpose" className="daily-activities-report__input" value={filters.purpose} onChange={(e) => set({ purpose: e.target.value })} disabled={!canRun}>
              <option value="">{t('stopsReportPurposeAll')}</option>
              <option value="Unloading">{t('stopsReportPurposeUnloading')}</option>
              <option value="Loading">{t('stopsReportPurposeLoading')}</option>
            </select>
          </div>
          <div className="daily-activities-report__actions">
            <button type="submit" className="btn btn--primary" disabled={!canRun || !datesValid || loading}>
              {loading ? t('stopsReportLoading') : t('stopsReportGenerate')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={!report || empty}
              onClick={() => downloadNoFlowReportExcel(report, { language: i18n.language, purpose: filters.purpose || null })}
            >
              {t('stopsReportExcel')}
            </button>
          </div>
        </form>
      </section>

      {error ? <p className="no-flow__error">{error}</p> : null}

      {report ? (
        <>
          <section className="card">
            <StopsSummaryTiles report={report} />
            {empty ? (
              <p className="text-steel stops-report__empty">{t('stopsReportEmpty')}</p>
            ) : (
              <>
                <h2 className="card__title">{t('stopsReportByReason')}</h2>
                <StopsReasonBars reasons={report.byReason} limit={12} />
              </>
            )}
          </section>
          {empty ? null : (
            <>
              <section className="card">
                <h2 className="card__title">{t('stopsReportMatrix')}</h2>
                <VesselReasonMatrix report={report} />
              </section>
              <section className="card">
                <h2 className="card__title">{t('stopsReportAllStops')}</h2>
                <StopsList stops={report.stops} />
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
