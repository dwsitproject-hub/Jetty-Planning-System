import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SortableFilterableTableHead from '../SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../../hooks/useSortableFilterableRows.js'
import { formatWhen } from '../../utils/adminOpsDisplay'
import { postAtgCargoGapResync } from '../../api/adminOps'

function formatGapRange(gap, t) {
  const start = formatWhen(gap.startAt)
  const end = formatWhen(gap.endAt)
  const mins = gap.durationMinutes ?? '—'
  return t('adminOpsAtgGapRange', { start, end, minutes: mins })
}

function ResyncModal({ open, operation, onClose, onComplete, t }) {
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  if (!open || !operation) return null

  const gaps = operation.gaps ?? []

  async function runResync() {
    setError(null)
    setBusy(true)
    try {
      const res = await postAtgCargoGapResync(operation.operationId, {
        confirm: true,
        acknowledgedAt: new Date().toISOString(),
      })
      setResult(res)
      onComplete(res)
    } catch (e) {
      setError(e?.message || t('adminOpsAtgResyncFailed'))
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    if (busy) return
    setConfirmed(false)
    setError(null)
    setResult(null)
    onClose()
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={handleClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atg-resync-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <h2 id="atg-resync-title" className="modal__title">
          {t('adminOpsAtgResyncTitle')}
        </h2>
        <p className="text-steel">{operation.operationLabel || operation.vesselName}</p>
        <ul style={{ margin: '0.75rem 0', paddingLeft: '1.25rem' }}>
          {gaps.map((g) => (
            <li key={g.gapKey}>{formatGapRange(g, t)}</li>
          ))}
        </ul>
        <p className="text-steel" style={{ fontSize: '0.9rem' }}>
          {t('adminOpsAtgResyncBody')}
        </p>
        <p className="text-steel" style={{ fontSize: '0.9rem' }}>
          {t('adminOpsAtgResyncQtyWarning')}
        </p>
        {busy ? <p className="text-steel">{t('adminOpsAtgResyncInProgress')}</p> : null}
        {error ? <p className="admin-ops-error">{error}</p> : null}
        {result?.archiveErrors?.length ? (
          <ul className="admin-ops-error" style={{ fontSize: '0.85rem' }}>
            {result.archiveErrors.map((err, i) => (
              <li key={i}>
                {err.tankCode || '—'} @ {err.sourceBaseUrl}: {err.message}
              </li>
            ))}
          </ul>
        ) : null}
        {!result ? (
          <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>{t('adminOpsAtgResyncConfirmCheckbox')}</span>
          </label>
        ) : null}
        <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {!result ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={handleClose} disabled={busy}>
                {t('adminOpsAtgResyncCancel')}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!confirmed || busy}
                onClick={runResync}
              >
                {busy ? t('adminOpsAtgResyncRunning') : t('adminOpsAtgResyncRun')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={handleClose}>
              {t('adminOpsAtgResyncClose')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AtgCargoGapsDetail({ details, t, canResync, onResyncComplete }) {
  const operations = details?.operations ?? []
  const [modalOp, setModalOp] = useState(null)
  const [resyncBusyId, setResyncBusyId] = useState(null)

  const rows = useMemo(
    () =>
      operations.map((op) => ({
        key: String(op.operationId),
        vessel: op.vesselName || '—',
        planRef: op.planRef || '—',
        atBerth: op.atBerth ? t('adminOpsYes') : t('adminOpsNo'),
        atBerthSort: op.atBerth ? 1 : 0,
        longestGap: op.longestGapMinutes != null ? `${op.longestGapMinutes} min` : '—',
        longestGapSort: Number(op.longestGapMinutes) || 0,
        segments: String(op.segmentCountWithGaps ?? 0),
        segmentsSort: Number(op.segmentCountWithGaps) || 0,
        operationId: op.operationId,
        raw: op,
      })),
    [operations, t]
  )

  const tableColumns = useMemo(() => {
    const cols = [
      { key: 'vessel', label: t('adminOpsAtgGapVessel') },
      { key: 'planRef', label: t('adminOpsAtgGapPlanRef') },
      {
        key: 'atBerth',
        label: t('adminOpsAtgGapAtBerth'),
        getSortValue: (row) => row.atBerthSort,
        getFilterValue: (row) => row.atBerth,
      },
      {
        key: 'longestGap',
        label: t('adminOpsAtgGapLongest'),
        className: 'admin-ops-detail-table__num',
        getSortValue: (row) => row.longestGapSort,
      },
      {
        key: 'segments',
        label: t('adminOpsAtgGapSegments'),
        className: 'admin-ops-detail-table__num',
        getSortValue: (row) => row.segmentsSort,
      },
    ]
    if (canResync) {
      cols.push({
        key: 'actions',
        label: t('adminOpsAtgGapActions'),
        getSortValue: () => '',
        getFilterValue: () => '',
      })
    }
    return cols
  }, [t, canResync])

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    rows,
    tableColumns,
    { key: 'longestGap', dir: 'desc' }
  )

  if (!operations.length) {
    return <p className="text-steel admin-ops-detail__empty">{t('adminOpsAtgGapNone')}</p>
  }

  function handleResyncComplete(res) {
    setModalOp(null)
    setResyncBusyId(null)
    onResyncComplete?.(res)
  }

  const colSpan = tableColumns.length

  return (
    <>
      <div className="admin-ops-detail-table-wrap">
        <table className="admin-ops-detail-table data-table allocation-table">
          <thead>
            <SortableFilterableTableHead
              columns={tableColumns}
              sortState={sortState}
              onSort={handleSort}
              filters={filters}
              onFilterChange={updateFilter}
            />
          </thead>
          <tbody>
            {displayRows.map((row) => (
              <Fragment key={row.key}>
                <tr>
                  <td>{row.vessel}</td>
                  <td>{row.planRef}</td>
                  <td>{row.atBerth}</td>
                  <td className="admin-ops-detail-table__num">{row.longestGap}</td>
                  <td className="admin-ops-detail-table__num">{row.segments}</td>
                  {canResync ? (
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={resyncBusyId != null}
                          onClick={() => {
                            setModalOp(row.raw)
                            setResyncBusyId(row.operationId)
                          }}
                        >
                          {t('adminOpsAtgResync')}
                        </button>
                        <Link to={`/loading/operation/${row.operationId}`} className="link">
                          {t('adminOpsAtgOpenOperation')}
                        </Link>
                      </div>
                    </td>
                  ) : null}
                </tr>
                <tr className="admin-ops-atg-gap-detail-row">
                  <td colSpan={colSpan}>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem' }} className="text-steel">
                      {(row.raw.gaps ?? []).map((g) => (
                        <li key={g.gapKey}>{formatGapRange(g, t)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {details?.truncated ? (
        <p className="text-steel admin-ops-detail__empty">{t('adminOpsAtgGapTruncated')}</p>
      ) : null}
      <ResyncModal
        open={Boolean(modalOp)}
        operation={modalOp}
        onClose={() => {
          setModalOp(null)
          setResyncBusyId(null)
        }}
        onComplete={handleResyncComplete}
        t={t}
      />
    </>
  )
}
