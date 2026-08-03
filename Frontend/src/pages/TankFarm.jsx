import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchPorts } from '../api/ports'
import { fetchTankGaugingLatest } from '../api/tankGauging'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import '../styles/allocation.css'

const PAGE_KEY = 'tank-farm'
const STALE_MS = 5 * 60 * 1000
const AUTO_REFRESH_MS = 30_000

function formatNum(v, digits = 3) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatVolumeLiters(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  // NXA PARAM 717 is m³; Tankvision UI displays liters (×1000).
  const liters = n < 100000 ? n * 1000 : n
  return liters.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatFetched(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

const COLUMNS = [
  {
    key: 'sourceBaseUrl',
    label: 'ATG source',
    getSortValue: (r) => (r.sourceBaseUrl || '').toLowerCase(),
    getFilterValue: (r) => `${r.sourceBaseUrl || ''} ${r.sourceUnitName || ''}`,
  },
  {
    key: 'code',
    label: 'Code',
    getSortValue: (r) => (r.code || '').toLowerCase(),
    getFilterValue: (r) => r.code || '',
  },
  {
    key: 'name',
    label: 'Name',
    getSortValue: (r) => (r.name || '').toLowerCase(),
    getFilterValue: (r) => r.name || '',
  },
  {
    key: 'productName',
    label: 'Product',
    getSortValue: (r) => (r.productName || '').toLowerCase(),
    getFilterValue: (r) => r.productName || '',
  },
  {
    key: 'tankComment',
    label: 'Comment',
    getSortValue: (r) => (r.tankComment || '').toLowerCase(),
    getFilterValue: (r) => r.tankComment || '',
  },
  {
    key: 'levelMm',
    label: 'Level (mm)',
    getSortValue: (r) => (r.levelMm == null ? null : Number(r.levelMm)),
  },
  {
    key: 'temperatureC',
    label: 'Temp (°C)',
    getSortValue: (r) => (r.temperatureC == null ? null : Number(r.temperatureC)),
  },
  {
    key: 'observedDensityKgM3',
    label: 'Density (kg/m³)',
    getSortValue: (r) => (r.observedDensityKgM3 == null ? null : Number(r.observedDensityKgM3)),
  },
  {
    key: 'totalObservedVolume',
    label: 'Volume (L)',
    getSortValue: (r) => (r.totalObservedVolume == null ? null : Number(r.totalObservedVolume)),
  },
  {
    key: 'totalMass',
    label: 'Mass',
    getSortValue: (r) => (r.totalMass == null ? null : Number(r.totalMass)),
  },
  {
    key: 'flowRateTph',
    label: 'Flow (tph)',
    getSortValue: (r) => (r.flowRateTph == null ? null : Number(r.flowRateTph)),
  },
  {
    key: 'statusText',
    label: 'Status',
    getSortValue: (r) => (r.statusText || '').toLowerCase(),
    getFilterValue: (r) => r.statusText || '',
  },
  {
    key: 'fetchedAt',
    label: 'Fetched',
    getSortValue: (r) => (r.fetchedAt ? new Date(r.fetchedAt).getTime() : 0),
  },
]

export default function TankFarm() {
  const { t } = useTranslation('pages')
  const [ports, setPorts] = useState([])
  const [portId, setPortId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)

  const loadPorts = useCallback(async () => {
    try {
      const list = await fetchPorts()
      const arr = Array.isArray(list) ? list : []
      setPorts(arr)
      setPortId((prev) => {
        if (prev && arr.some((p) => String(p.id) === String(prev))) return prev
        return arr[0] ? String(arr[0].id) : ''
      })
    } catch (e) {
      setPorts([])
      setError(e?.message || 'Failed to load ports')
    }
  }, [])

  const loadReadings = useCallback(async () => {
    if (!portId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await fetchTankGaugingLatest(portId)
      setRows(Array.isArray(list) ? list : [])
      setRefreshedAt(new Date())
    } catch (e) {
      setRows([])
      setError(e?.message || 'Failed to load tank gauging')
    } finally {
      setLoading(false)
    }
  }, [portId])

  useEffect(() => {
    loadPorts()
  }, [loadPorts])

  useEffect(() => {
    loadReadings()
  }, [loadReadings])

  useEffect(() => {
    if (!portId) return undefined
    const id = setInterval(() => {
      loadReadings()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [portId, loadReadings])

  const newestFetchedMs = useMemo(() => {
    let max = 0
    for (const r of rows) {
      if (!r.fetchedAt) continue
      const tMs = new Date(r.fetchedAt).getTime()
      if (Number.isFinite(tMs) && tMs > max) max = tMs
    }
    return max || null
  }, [rows])

  const isStale = newestFetchedMs != null && Date.now() - newestFetchedMs > STALE_MS

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    rows,
    COLUMNS,
    { key: 'sourceBaseUrl', dir: 'asc' }
  )

  const portOptions = useMemo(
    () => ports.map((p) => ({ value: String(p.id), label: p.name || `Port #${p.id}` })),
    [ports]
  )

  return (
    <div className="allocation-page" data-page-key={PAGE_KEY}>
      <h1 className="page-title">{t('tankFarmTitle')}</h1>
      <p className="allocation-page__intro">{t('tankFarmDesc')}</p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="card__title">{t('tankFarmTableTitle')}</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="text-steel" htmlFor="tank-farm-port" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {t('tankFarmPortLabel')}
              <select
                id="tank-farm-port"
                className="berthing-modal__input"
                value={portId}
                onChange={(e) => setPortId(e.target.value)}
                style={{ minWidth: 180 }}
              >
                {portOptions.length === 0 ? <option value="">{t('tankFarmNoPorts')}</option> : null}
                {portOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <span className="text-steel" style={{ fontSize: '0.9rem' }}>
              {t('tankFarmLastRefreshed')}:{' '}
              {refreshedAt ? refreshedAt.toLocaleTimeString() : '—'}
              {isStale ? (
                <span style={{ marginLeft: 8, color: 'var(--color-warning, #b8860b)' }}>
                  {t('tankFarmStaleHint')}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => loadReadings()}
              disabled={loading || !portId}
            >
              {t('tankFarmRefresh')}
            </button>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <p className="text-steel">{t('tankFarmLoading')}</p>
        ) : displayRows.length === 0 ? (
          <p className="text-steel">{t('tankFarmEmpty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <SortableFilterableTableHead
                columns={COLUMNS}
                sortState={sortState}
                onSort={handleSort}
                filters={filters}
                onFilterChange={updateFilter}
              />
              <tbody>
                {displayRows.map((r) => (
                  <tr key={r.tankId}>
                    <td>
                      <div>{r.sourceBaseUrl || '—'}</div>
                      {r.sourceUnitName ? (
                        <div className="text-steel" style={{ fontSize: '0.85em' }}>{r.sourceUnitName}</div>
                      ) : null}
                    </td>
                    <td>{r.code}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.productName || '—'}</td>
                    <td>{r.tankComment || '—'}</td>
                    <td>{formatNum(r.levelMm, 1)}</td>
                    <td>{formatNum(r.temperatureC, 1)}</td>
                    <td>{formatNum(r.observedDensityKgM3, 1)}</td>
                    <td>{formatVolumeLiters(r.totalObservedVolume)}</td>
                    <td>{formatNum(r.totalMass, 3)}</td>
                    <td>{formatNum(r.flowRateTph, 3)}</td>
                    <td>{r.statusText || '—'}</td>
                    <td>{formatFetched(r.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-steel" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
        {t('tankFarmFooter')}
      </p>
    </div>
  )
}
