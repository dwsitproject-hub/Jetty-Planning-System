import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchOperations, fetchOperationalProgress } from '../api/operations'
import { fetchShipmentPlans } from '../api/shipmentPlans'
import HourlyCargoProgressTable from '../components/HourlyCargoProgressTable'
import { usePortScope } from '../context/PortScopeContext'
import {
  buildCargoMovementBlock,
  buildPlanRefByShipmentPlanId,
  CARGO_MOVEMENT_HEADER_FIELDS,
  CARGO_MOVEMENT_PROGRESS_CONCURRENCY,
  filterOperationsForCargoMovement,
  mapWithConcurrency,
  sortCargoMovementBlocksNewestFirst,
} from '../data/cargoMovementReportFromApi'
import { downloadCargoMovementReportExcel } from '../data/cargoMovementReportExcel'
import '../styles/allocation.css'

export default function CargoMovementReport() {
  const { t } = useTranslation('pages')
  const {
    selectedPortId,
    requiresSelection,
    noPortAssigned,
    noPortMessage,
  } = usePortScope()

  const [lookup, setLookup] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [appliedFilters, setAppliedFilters] = useState(null)
  const [reportBlocks, setReportBlocks] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setAppliedFilters(null)
    setReportBlocks([])
    setReportError(null)
    setLookup('')
    setStartDate('')
    setEndDate('')
  }, [selectedPortId])

  const canRunReport = selectedPortId != null && !requiresSelection && !noPortAssigned
  const lookupReady = Boolean(lookup.trim())

  const handleGenerateReport = useCallback(async () => {
    if (!canRunReport || !lookup.trim()) return
    setReportLoading(true)
    setReportError(null)
    try {
      const [operations, plans] = await Promise.all([
        fetchOperations({ portId: selectedPortId }),
        fetchShipmentPlans(),
      ])
      const planRefByShipmentPlanId = buildPlanRefByShipmentPlanId(plans)
      const matches = filterOperationsForCargoMovement(operations, {
        lookup,
        startDate,
        endDate,
        planRefByShipmentPlanId,
      })

      const blocks = await mapWithConcurrency(matches, CARGO_MOVEMENT_PROGRESS_CONCURRENCY, async (op) => {
        let progress = null
        try {
          progress = await fetchOperationalProgress(op.id)
        } catch {
          progress = null
        }
        return buildCargoMovementBlock(op, progress, planRefByShipmentPlanId)
      })

      setReportBlocks(sortCargoMovementBlocksNewestFirst(blocks))
      setAppliedFilters({
        lookup: lookup.trim(),
        startDate,
        endDate,
      })
    } catch (e) {
      setReportError(e?.message || t('cargoMovementFailed'))
      setReportBlocks([])
      setAppliedFilters(null)
    } finally {
      setReportLoading(false)
    }
  }, [canRunReport, selectedPortId, lookup, startDate, endDate, t])

  const handleDownloadExcel = useCallback(async () => {
    if (!appliedFilters || reportBlocks.length === 0) return
    setExporting(true)
    try {
      await downloadCargoMovementReportExcel(reportBlocks, {
        lookup: appliedFilters.lookup,
        startDate: appliedFilters.startDate,
        endDate: appliedFilters.endDate,
        t,
      })
    } finally {
      setExporting(false)
    }
  }, [appliedFilters, reportBlocks, t])

  return (
    <div className="allocation-page daily-activities-report">
      <h1 className="page-title">{t('cargoMovementReport')}</h1>
      <p className="allocation-page__intro">{t('cargoMovementIntro')}</p>
      <p className="text-steel">
        <Link to="/reporting" className="link">{t('cargoMovementBack')}</Link>
      </p>

      {noPortAssigned && (
        <section className="card">
          <p className="text-steel">{noPortMessage}</p>
        </section>
      )}
      {requiresSelection && (
        <section className="card">
          <p className="text-steel">{t('cargoMovementSelectPort')}</p>
        </section>
      )}

      <section className="card daily-activities-report__filters cargo-movement-report__filters">
        <h2 className="card__title">{t('cargoMovementFilters')}</h2>
        <form
          className="cargo-movement-report__form"
          onSubmit={(e) => {
            e.preventDefault()
            handleGenerateReport()
          }}
        >
          <div className="daily-activities-report__field cargo-movement-report__lookup">
            <label htmlFor="cargo-movement-lookup" className="daily-activities-report__label">
              {t('cargoMovementLookupLabel')}
            </label>
            <input
              id="cargo-movement-lookup"
              type="text"
              className="daily-activities-report__input cargo-movement-report__lookup-input"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder={t('cargoMovementLookupPlaceholder')}
              disabled={!canRunReport}
              autoComplete="off"
            />
            <p className="cargo-movement-report__hint">{t('cargoMovementLookupHint')}</p>
          </div>

          <div className="cargo-movement-report__dates">
            <div className="daily-activities-report__field">
              <label htmlFor="cargo-movement-start-date" className="daily-activities-report__label">
                {t('cargoMovementStartDate')}
              </label>
              <input
                id="cargo-movement-start-date"
                type="date"
                className="daily-activities-report__input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={!canRunReport}
              />
            </div>
            <div className="daily-activities-report__field">
              <label htmlFor="cargo-movement-end-date" className="daily-activities-report__label">
                {t('cargoMovementEndDate')}
              </label>
              <input
                id="cargo-movement-end-date"
                type="date"
                className="daily-activities-report__input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={!canRunReport}
              />
            </div>
            <p className="cargo-movement-report__hint cargo-movement-report__dates-hint">
              {t('cargoMovementDateHint')}
            </p>
          </div>

          <div className="daily-activities-report__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!canRunReport || !lookupReady || reportLoading}
            >
              {reportLoading ? t('cargoMovementGenerating') : t('cargoMovementGenerate')}
            </button>
            <button
              type="button"
              className="btn btn--secondary daily-activities-report__download-btn"
              onClick={handleDownloadExcel}
              disabled={!appliedFilters || reportBlocks.length === 0 || exporting}
              title={
                !appliedFilters || reportBlocks.length === 0
                  ? t('cargoMovementNeedGenerate')
                  : t('cargoMovementDownloadExcel')
              }
            >
              {exporting ? t('cargoMovementPreparing') : t('cargoMovementDownloadExcel')}
            </button>
          </div>
        </form>
        {reportError && <p className="text-steel" role="alert">{reportError}</p>}
      </section>

      {!appliedFilters ? (
        <section className="card">
          <p className="text-steel">
            {canRunReport ? t('cargoMovementNeedLookup') : t('cargoMovementNeedPort')}
          </p>
        </section>
      ) : reportBlocks.length === 0 ? (
        <section className="card">
          <p className="text-steel">{t('cargoMovementNoMatches')}</p>
        </section>
      ) : (
        reportBlocks.map((block) => (
          <section key={block.vesselId} className="card daily-activities-report__vessel">
            <h2 className="daily-activities-report__vessel-title">{block.vesselName}</h2>

            <div className="daily-activities-report__header">
              <h3 className="daily-activities-report__section-title">{t('cargoMovementHeaderTitle')}</h3>
              <dl className="daily-activities-report__header-dl">
                {CARGO_MOVEMENT_HEADER_FIELDS.map(({ key, labelKey, label }) => (
                  <div key={key} className="daily-activities-report__header-row">
                    <dt>{t(labelKey, { defaultValue: label })}</dt>
                    <dd>{block.header?.[key] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="daily-activities-report__timelog">
              {block.hourlyBuckets.length === 0 ? (
                <p className="text-steel">{t('cargoMovementEmptyHourly')}</p>
              ) : (
                <HourlyCargoProgressTable
                  hourlyBuckets={block.hourlyBuckets}
                  unit={block.unit}
                  purpose={block.purpose}
                  showTankColumn
                  defaultExpanded
                  exportable={false}
                  vesselName={block.vesselName}
                />
              )}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
