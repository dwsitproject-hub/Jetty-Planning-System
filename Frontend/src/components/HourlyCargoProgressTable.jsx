import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadHourlyTransferRatesExcel } from '../data/hourlyTransferRatesExcel'
import { expandHourlyBucketsForDisplay, formatDisplayCargoQty } from '../utils/hourlyCargoDisplay'

function formatRate(n, unit = 'MT') {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
}

function movementBadge(status, t) {
  if (status === 'direction_mismatch') {
    return (
      <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--reverse">
        {t('cargoHourlyReverseMovement')}
      </span>
    )
  }
  if (status === 'flat_movement') {
    return (
      <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--flat">
        {t('cargoHourlyFlatMovement')}
      </span>
    )
  }
  if (status === 'incomplete') {
    return (
      <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--incomplete">
        {t('cargoHourlyIncomplete')}
      </span>
    )
  }
  return (
    <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--active">
      {t('cargoHourlyActive')}
    </span>
  )
}

function sourceBadge(source, t) {
  if (source === 'manual') {
    return (
      <span className="hourly-cargo-progress__source hourly-cargo-progress__source--manual">
        {t('cargoHourlySourceManual')}
      </span>
    )
  }
  if (source === 'hybrid') {
    return <span className="hourly-cargo-progress__source">{String(source).toUpperCase()}</span>
  }
  if (source === 'atg') {
    return <span className="hourly-cargo-progress__source">ATG</span>
  }
  return source ? <span className="hourly-cargo-progress__source">{String(source).toUpperCase()}</span> : null
}

/**
 * Clock-hour cargo transfer rate table (ATG / manual).
 */
export default function HourlyCargoProgressTable({
  hourlyBuckets = [],
  unit = 'MT',
  purpose = null,
  compact = false,
  showTankColumn = true,
  currentHourLine = null,
  collapsible = false,
  collapsedRowLimit = 6,
  defaultExpanded = false,
  segmentStartLabel = null,
  jettyName = null,
  vesselName = null,
  exportable = false,
}) {
  const { t } = useTranslation('pages')
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const bucketsForDisplay = useMemo(() => {
    if (!Array.isArray(hourlyBuckets) || hourlyBuckets.length === 0) return []
    if (!collapsible || expanded || hourlyBuckets.length <= collapsedRowLimit) {
      return hourlyBuckets
    }
    return hourlyBuckets.slice(-collapsedRowLimit)
  }, [hourlyBuckets, collapsible, expanded, collapsedRowLimit])

  const visibleRows = useMemo(
    () => expandHourlyBucketsForDisplay(bucketsForDisplay, purpose),
    [bucketsForDisplay, purpose]
  )

  if (!hourlyBuckets?.length && !currentHourLine) return null

  const totalCount = hourlyBuckets?.length ?? 0
  const showToggle = collapsible && totalCount > collapsedRowLimit
  const canExport =
    exportable &&
    Array.isArray(hourlyBuckets) &&
    hourlyBuckets.length > 0 &&
    expandHourlyBucketsForDisplay(hourlyBuckets, purpose).length > 0

  const handleExportExcel = async () => {
    setExportError('')
    setExporting(true)
    try {
      await downloadHourlyTransferRatesExcel({
        jettyName,
        vesselName,
        hourlyBuckets,
        purpose,
        unit,
        t,
      })
    } catch (e) {
      setExportError(e?.message || t('cargoHourlyExportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`hourly-cargo-progress${compact ? ' hourly-cargo-progress--compact' : ''}`}>
      {!compact ? (
        <div className="hourly-cargo-progress__header">
          <h4 className="hourly-cargo-progress__title">{t('cargoHourlyTableTitle')}</h4>
          {canExport ? (
            <button
              type="button"
              className="btn btn--small btn--soft hourly-cargo-progress__export"
              onClick={handleExportExcel}
              disabled={exporting}
              title={t('cargoHourlyExportHint')}
            >
              {exporting ? t('cargoHourlyExporting') : t('cargoHourlyExportExcel')}
            </button>
          ) : null}
        </div>
      ) : null}
      {exportError ? <p className="hourly-cargo-progress__export-error">{exportError}</p> : null}
      {currentHourLine ? (
        <p className="hourly-cargo-progress__current-hour text-steel">{currentHourLine}</p>
      ) : null}
      {showToggle && !expanded ? (
        <p className="hourly-cargo-progress__range-hint text-steel">
          {t('cargoHourlyShowingRecent', {
            shown: collapsedRowLimit,
            total: totalCount,
            start: segmentStartLabel || '—',
          })}
        </p>
      ) : null}
      {visibleRows?.length ? (
        <>
          <div
            className={`hourly-cargo-progress__table-wrap${expanded && showToggle ? ' hourly-cargo-progress__table-wrap--scroll' : ''}`}
          >
            <table className="hourly-cargo-progress__table">
              <thead>
                <tr>
                  <th>{t('cargoHourlyColTime')}</th>
                  {showTankColumn ? <th>{t('cargoHourlyColTank')}</th> : null}
                  <th title={t('cargoHourlyMovedSignHint')}>{t('cargoHourlyColQty')}</th>
                  <th>{t('cargoHourlyColRate')}</th>
                  <th>{t('cargoHourlyColStatus')}</th>
                  {!compact ? <th>{t('cargoHourlyColSource')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.rowKey}
                    className={`hourly-cargo-progress__row hourly-cargo-progress__row--${row.movementStatus || 'active'}`}
                  >
                    <td>{row.hourLabelLocal || row.hourStart}</td>
                    {showTankColumn ? <td>{row.tankCode}</td> : null}
                    <td>{formatDisplayCargoQty(row.tankDisplayQtyMoved, unit)}</td>
                    <td>{formatRate(row.rateTph, unit)}</td>
                    <td>{movementBadge(row.movementStatus, t)}</td>
                    {!compact ? <td>{sourceBadge(row.source, t)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showToggle ? (
            <button
              type="button"
              className="btn btn--small btn--soft hourly-cargo-progress__toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? t('cargoHourlyShowLess') : t('cargoHourlyShowAll', { count: totalCount })}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
