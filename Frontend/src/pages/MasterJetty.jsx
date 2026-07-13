import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchPorts } from '../api/ports'
import { fetchSiLookups } from '../api/siLookups'
import { fetchJetties, createJetty, updateJettyApi, updateJettyStatus } from '../api/jetties'
import { ApiError } from '../api/client'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/shipping-instruction.css'
import {
  MAX_MASTER_DESCRIPTION_CHARS,
  MAX_MASTER_JETTY_NAME_CHARS,
  MAX_RTSP_LINK_CHARS,
} from '../constants/inputLimits'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'

const JETTY_STATUS_OPTIONS = ['Available', 'Out of Service']

function jettyPortLabel(j, portNameFn) {
  return j.portName || portNameFn(j.portId)
}

function commodityDisplayLabel(c) {
  return c?.shortName ? `${c.shortName} - ${c.name}` : c?.name || ''
}

function commodityNamesList(commodities) {
  return Array.isArray(commodities) ? commodities.map((c) => commodityDisplayLabel(c)).join(', ') : ''
}

function JettyCommodityMultiSelect({
  idPrefix,
  label,
  search,
  onSearchChange,
  selectedIds,
  onSelectedIdsChange,
  commodityMaster,
  emptyHint,
}) {
  const filtered = commodityMaster.filter((c) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (c.name || '').toLowerCase().includes(term) || (c.shortName || '').toLowerCase().includes(term)
  })
  const selectedNames = commodityMaster
    .filter((c) => selectedIds.includes(c.id))
    .map((c) => commodityDisplayLabel(c))

  return (
    <div className="modal__section">
      <label className="modal__label" htmlFor={`${idPrefix}-search`}>{label}</label>
      <input
        id={`${idPrefix}-search`}
        className="modal__input"
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search commodity…"
        autoComplete="off"
      />
      <div
        style={{
          maxHeight: 150,
          overflowY: 'auto',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          marginTop: 6,
          padding: '4px 8px',
        }}
      >
        {filtered.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: '0.875rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedIds.map(String).includes(String(c.id))}
              onChange={(e) =>
                onSelectedIdsChange(
                  e.target.checked ? [...selectedIds, c.id] : selectedIds.filter((x) => x !== c.id)
                )
              }
            />
            {commodityDisplayLabel(c)}
          </label>
        ))}
        {commodityMaster.length === 0 ? <p className="text-steel">No commodities in Master – Commodity.</p> : null}
      </div>
      <p className="text-steel" style={{ marginTop: '0.25rem' }}>
        {selectedNames.length ? `Selected: ${selectedNames.join(', ')}` : emptyHint}
      </p>
    </div>
  )
}

export default function MasterJetty() {
  const { t } = useTranslation('pages')
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState([])
  const [jetties, setJetties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formPortId, setFormPortId] = useState('')
  const [formOrderNo, setFormOrderNo] = useState('')
  const [formJettyName, setFormJettyName] = useState('')
  const [formCapacity, setFormCapacity] = useState('1')
  const [formLengthM, setFormLengthM] = useState('')
  const [formDraft, setFormDraft] = useState('')
  const [formDwt, setFormDwt] = useState('')
  const [formUnloadingCommodityIds, setFormUnloadingCommodityIds] = useState([])
  const [formLoadingCommodityIds, setFormLoadingCommodityIds] = useState([])
  const [unloadingCommoditySearch, setUnloadingCommoditySearch] = useState('')
  const [loadingCommoditySearch, setLoadingCommoditySearch] = useState('')
  const [commodityMaster, setCommodityMaster] = useState([])
  const [formDescription, setFormDescription] = useState('')
  const [formRtspLink, setFormRtspLink] = useState('')
  const [formStatus, setFormStatus] = useState('Available')
  const [statusWhenOpened, setStatusWhenOpened] = useState('Available')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(t)
  }, [toast])

  const loadAll = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [p, j, lk] = await Promise.all([fetchPorts(), fetchJetties(), fetchSiLookups().catch(() => null)])
      setPorts(Array.isArray(p) ? p : [])
      setJetties(Array.isArray(j) ? j : [])
      setCommodityMaster(Array.isArray(lk?.commodities) ? lk.commodities : [])
    } catch (e) {
      setError(e?.message || 'Failed to load')
      setPorts([])
      setJetties([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const portName = (portId) => ports.find((p) => p.id === portId)?.name ?? portId ?? '—'

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormPortId(ports[0]?.id != null ? String(ports[0].id) : '')
    setFormOrderNo('')
    setFormJettyName('')
    setFormCapacity('1')
    setFormLengthM('')
    setFormDraft('')
    setFormDwt('')
    setFormUnloadingCommodityIds([])
    setFormLoadingCommodityIds([])
    setUnloadingCommoditySearch('')
    setLoadingCommoditySearch('')
    setFormDescription('')
    setFormRtspLink('')
    setFormStatus('Available')
    setStatusWhenOpened('Available')
    setModalOpen(true)
  }, [ports])

  const openEdit = useCallback((jetty) => {
    setEditingId(jetty.id)
    setFormPortId(String(jetty.portId ?? ''))
    setFormOrderNo(String(jetty.orderNo ?? ''))
    setFormJettyName(jetty.name || '')
    setFormCapacity(String(jetty.capacity ?? 1))
    setFormLengthM(jetty.jettyLengthM != null ? String(jetty.jettyLengthM) : '')
    setFormDraft(jetty.jettyDraft != null ? String(jetty.jettyDraft) : '')
    setFormDwt(jetty.jettyDwt != null ? String(jetty.jettyDwt) : '')
    setFormUnloadingCommodityIds(Array.isArray(jetty.unloadingCommodities) ? jetty.unloadingCommodities.map((c) => String(c.id)) : [])
    setFormLoadingCommodityIds(Array.isArray(jetty.loadingCommodities) ? jetty.loadingCommodities.map((c) => String(c.id)) : [])
    setUnloadingCommoditySearch('')
    setLoadingCommoditySearch('')
    setFormDescription(jetty.description ?? '')
    setFormRtspLink(jetty.rtspLink ?? '')
    const st = jetty.status && JETTY_STATUS_OPTIONS.includes(jetty.status) ? jetty.status : 'Available'
    setFormStatus(st)
    setStatusWhenOpened(st)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
  }, [])

  const handleSubmit = useCallback(async () => {
    const portId = parseInt(formPortId, 10)
    const jettyName = (formJettyName || '').trim()
    if (Number.isNaN(portId) || !jettyName) return
    const orderNo = Math.max(0, Math.min(32767, parseInt(formOrderNo, 10) || 0))
    const capacity = Math.max(1, Math.min(20, parseInt(formCapacity, 10) || 1))
    const specs = [
      ['Jetty Length (m)', formLengthM],
      ['Draft Jetty', formDraft],
      ['DWT Jetty', formDwt],
    ]
    for (const [label, raw] of specs) {
      const n = Number(raw)
      if (raw == null || String(raw).trim() === '' || !Number.isFinite(n) || n <= 0) {
        setToast({ message: `${label} is required and must be a number greater than 0.`, variant: 'error' })
        return
      }
    }
    const jettyLengthM = Number(formLengthM)
    const jettyDraft = Number(formDraft)
    const jettyDwt = Number(formDwt)
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updateJettyApi(editingId, {
          portId,
          orderNo,
          capacity,
          name: jettyName,
          description: (formDescription || '').trim() || null,
          rtspLink: (formRtspLink || '').trim() || null,
          jettyLengthM,
          jettyDraft,
          jettyDwt,
          unloadingCommodityIds: formUnloadingCommodityIds,
          loadingCommodityIds: formLoadingCommodityIds,
        })
        if (formStatus !== statusWhenOpened) {
          await updateJettyStatus(editingId, formStatus)
        }
        logActivity({
          pageKey: 'master-jetty',
          action: 'update',
          entityType: 'Jetty',
          entityLabel: jettyName,
          details: portName(portId),
        })
        setToast({ message: `Jetty saved: ${jettyName}.`, variant: 'success' })
      } else {
        const created = await createJetty({
          portId,
          orderNo,
          capacity,
          name: jettyName,
          description: (formDescription || '').trim() || null,
          rtspLink: (formRtspLink || '').trim() || null,
          jettyLengthM,
          jettyDraft,
          jettyDwt,
          unloadingCommodityIds: formUnloadingCommodityIds,
          loadingCommodityIds: formLoadingCommodityIds,
        })
        const newId = created?.id
        if (newId != null && formStatus !== 'Available') {
          await updateJettyStatus(newId, formStatus)
        }
        logActivity({
          pageKey: 'master-jetty',
          action: 'add',
          entityType: 'Jetty',
          entityLabel: jettyName,
          details: portName(portId),
        })
        setToast({ message: `Jetty added: ${jettyName}.`, variant: 'success' })
      }
      await loadAll()
      closeModal()
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? e.message ||
            'Cannot change status: active operations still use this jetty. Reassign them on Allocation & Berthing first.'
          : e?.message || 'Save failed'
      setError(msg)
      setToast({ message: msg, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }, [
    editingId,
    formPortId,
    formOrderNo,
    formJettyName,
    formCapacity,
    formLengthM,
    formDraft,
    formDwt,
    formUnloadingCommodityIds,
    formLoadingCommodityIds,
    formDescription,
    formRtspLink,
    formStatus,
    statusWhenOpened,
    loadAll,
    closeModal,
    logActivity,
  ])

  const jettyColumns = useMemo(
    () => [
      {
        key: 'port',
        label: 'Port',
        getSortValue: (j) => jettyPortLabel(j, portName).toLowerCase(),
        getFilterValue: (j) => jettyPortLabel(j, portName),
      },
      {
        key: 'orderNo',
        label: 'Order',
        getSortValue: (j) => (j.orderNo != null ? Number(j.orderNo) : Number.POSITIVE_INFINITY),
        getFilterValue: (j) => `${j.orderNo ?? ''}`,
      },
      {
        key: 'name',
        label: 'Jetty name',
        getSortValue: (j) => (j.name || '').toLowerCase(),
      },
      {
        key: 'capacity',
        label: 'Capacity',
        getSortValue: (j) => Number(j.capacity ?? 1),
        getFilterValue: (j) => `${j.capacity ?? 1}`,
      },
      {
        key: 'jettyLengthM',
        label: 'Length (m)',
        getSortValue: (j) => (j.jettyLengthM != null ? Number(j.jettyLengthM) : Number.POSITIVE_INFINITY),
        getFilterValue: (j) => `${j.jettyLengthM ?? ''}`,
      },
      {
        key: 'jettyDraft',
        label: 'Draft',
        getSortValue: (j) => (j.jettyDraft != null ? Number(j.jettyDraft) : Number.POSITIVE_INFINITY),
        getFilterValue: (j) => `${j.jettyDraft ?? ''}`,
      },
      {
        key: 'jettyDwt',
        label: 'DWT',
        getSortValue: (j) => (j.jettyDwt != null ? Number(j.jettyDwt) : Number.POSITIVE_INFINITY),
        getFilterValue: (j) => `${j.jettyDwt ?? ''}`,
      },
      {
        key: 'unloadingCommodities',
        label: 'Unloading commodities',
        getSortValue: (j) => commodityNamesList(j.unloadingCommodities).toLowerCase(),
        getFilterValue: (j) => commodityNamesList(j.unloadingCommodities),
      },
      {
        key: 'loadingCommodities',
        label: 'Loading commodities',
        getSortValue: (j) => commodityNamesList(j.loadingCommodities).toLowerCase(),
        getFilterValue: (j) => commodityNamesList(j.loadingCommodities),
      },
      {
        key: 'status',
        label: 'Status',
        getSortValue: (j) => (j.status || '').toLowerCase(),
      },
      {
        key: 'description',
        label: 'Description',
        getSortValue: (j) => (j.description || '').toLowerCase(),
        getFilterValue: (j) => j.description || '',
      },
    ],
    [ports]
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    jetties,
    jettyColumns,
    { key: 'port', dir: 'asc' }
  )

  return (
    <div className="allocation-page">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : '✓'}
          </span>
          <p className="si-toast__message">{toast.message}</p>
          <button
            type="button"
            className="si-toast__close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      <h1 className="page-title">{t('masterJetty')}</h1>
      <p className="allocation-page__intro">{t('masterJettyIntro')}</p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>
      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Jetties</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn--secondary btn--small" onClick={loadAll} disabled={loading}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openAdd}
              disabled={ports.length === 0}
              title={ports.length === 0 ? 'Add a port first' : ''}
            >
              Add Jetty
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : ports.length === 0 ? (
          <p className="text-steel">No ports. Add a port in Master – Port first.</p>
        ) : jetties.length === 0 ? (
          <p className="text-steel">No jetties. Click Add Jetty.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <SortableFilterableTableHead
                  columns={jettyColumns}
                  sortState={sortState}
                  onSort={handleSort}
                  filters={filters}
                  onFilterChange={updateFilter}
                  trailingBlankCols={1}
                />
              </thead>
              <tbody>
                {displayRows.map((j) => (
                  <tr key={j.id}>
                    <td>{jettyPortLabel(j, portName)}</td>
                    <td>{j.orderNo ?? '—'}</td>
                    <td><strong>{j.name || '—'}</strong></td>
                    <td>{j.capacity ?? 1}</td>
                    <td>{j.jettyLengthM != null ? j.jettyLengthM.toLocaleString('en-US') : '—'}</td>
                    <td>{j.jettyDraft != null ? j.jettyDraft.toLocaleString('en-US') : '—'}</td>
                    <td>{j.jettyDwt != null ? j.jettyDwt.toLocaleString('en-US') : '—'}</td>
                    <td>{commodityNamesList(j.unloadingCommodities) || '—'}</td>
                    <td>{commodityNamesList(j.loadingCommodities) || '—'}</td>
                    <td>{j.status || '—'}</td>
                    <td>{j.description ? (j.description.length > 40 ? `${j.description.slice(0, 40)}…` : j.description) : '—'}</td>
                    <td>
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(j)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayRows.length === 0 && (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-3)' }}>
                No entries match the current filters.
              </p>
            )}
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal__title">{editingId != null ? 'Edit Jetty' : 'Add Jetty'}</h2>
            <div className="modal__section">
              <label className="modal__label">Port</label>
              <select
                className="modal__input"
                value={formPortId}
                onChange={(e) => setFormPortId(e.target.value)}
              >
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label className="modal__label">Order #</label>
              <input
                type="number"
                className="modal__input"
                value={formOrderNo}
                onChange={(e) => setFormOrderNo(e.target.value)}
                min={0}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label">Capacity (vessels)</label>
              <input
                type="number"
                className="modal__input"
                value={formCapacity}
                onChange={(e) => setFormCapacity(e.target.value)}
                min={1}
                max={20}
              />
              <p className="text-steel" style={{ marginTop: '0.25rem' }}>
                Default is 1. Set 2+ to allow double-bank / multi-bank on this jetty.
              </p>
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="master-jetty-length">Jetty Length (m) (required)</label>
              <input
                id="master-jetty-length"
                type="number"
                className="modal__input"
                value={formLengthM}
                onChange={(e) => setFormLengthM(e.target.value)}
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="e.g. 200"
                required
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="master-jetty-draft">Draft Jetty (required)</label>
              <input
                id="master-jetty-draft"
                type="number"
                className="modal__input"
                value={formDraft}
                onChange={(e) => setFormDraft(e.target.value)}
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="e.g. 12"
                required
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="master-jetty-dwt">DWT Jetty (required)</label>
              <input
                id="master-jetty-dwt"
                type="number"
                className="modal__input"
                value={formDwt}
                onChange={(e) => setFormDwt(e.target.value)}
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="e.g. 15000"
                required
              />
              <p className="text-steel" style={{ marginTop: '0.25rem' }}>
                Maximum vessel DWT this jetty accepts. Used for jetty suggestions on shipment plans.
              </p>
            </div>
            <JettyCommodityMultiSelect
              idPrefix="master-jetty-unloading-commodity"
              label="Allowed for Unloading"
              search={unloadingCommoditySearch}
              onSearchChange={setUnloadingCommoditySearch}
              selectedIds={formUnloadingCommodityIds}
              onSelectedIdsChange={setFormUnloadingCommodityIds}
              commodityMaster={commodityMaster}
              emptyHint="Optional. Empty = jetty accepts any commodity for unloading. Used for jetty suggestions on shipment plans."
            />
            <JettyCommodityMultiSelect
              idPrefix="master-jetty-loading-commodity"
              label="Allowed for Loading"
              search={loadingCommoditySearch}
              onSearchChange={setLoadingCommoditySearch}
              selectedIds={formLoadingCommodityIds}
              onSelectedIdsChange={setFormLoadingCommodityIds}
              commodityMaster={commodityMaster}
              emptyHint="Optional. Empty = jetty accepts any commodity for loading. Used for jetty suggestions on shipment plans."
            />
            <div className="modal__section">
              <label className="modal__label" htmlFor="master-jetty-status">
                Operational status
              </label>
              <select
                id="master-jetty-status"
                className="modal__input"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
              >
                {JETTY_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="text-steel" style={{ marginTop: '0.25rem' }}>
                Out of service cannot be saved while an active operation still uses this jetty — reassign on
                Allocation &amp; Berthing first.
              </p>
            </div>
            <div className="modal__section">
              <label className="modal__label">Jetty name</label>
              <input
                className="modal__input"
                value={formJettyName}
                onChange={(e) => setFormJettyName(e.target.value)}
                maxLength={MAX_MASTER_JETTY_NAME_CHARS}
                placeholder="e.g. 1A"
              />
            </div>
            <div className="modal__section">
              <label className="modal__label">Description</label>
              <textarea
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                maxLength={MAX_MASTER_DESCRIPTION_CHARS}
                rows={3}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="master-jetty-rtsp">
                RTSP link (CCTV)
              </label>
              <input
                id="master-jetty-rtsp"
                className="modal__input"
                type="text"
                value={formRtspLink}
                onChange={(e) => setFormRtspLink(e.target.value)}
                maxLength={MAX_RTSP_LINK_CHARS}
                placeholder="rtsp://testing:KPN00000eup@172.16.247.222:554/Stream1"
                autoComplete="off"
              />
              <p className="text-steel" style={{ marginTop: '0.25rem' }}>
                Optional. Used by Jetty Live CCTV from the allocation schematic.
              </p>
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : editingId != null ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
