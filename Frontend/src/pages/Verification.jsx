import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchOperations, fetchPendingSignoffRequests, depart, uploadOperationDocuments, signoff, fetchActivityTimeline } from '../api/operations'
import { departShipmentPlan } from '../api/shipmentPlans'
import { useRbac } from '../context/RbacContext'
import {
  getScheduleEntryTimeZone,
  normalizeForApi,
  nowToNaiveLocalInScheduleZone,
  utcIsoToNaiveLocal,
} from '../utils/scheduleDateTime.js'
import { resolveUploadUrl } from '../api/client'
import FilePreviewLink from '../components/FilePreviewLink'
import SiDetailModal from '../components/SiDetailModal'
import SiDocumentModal from '../components/SiDocumentModal'
import VesselInfoModal, { VesselNameButton } from '../components/VesselInfoModal'
import ColumnSelectFilter from '../components/ColumnSelectFilter'
import { renderCommodityQtyCell } from '../utils/siCargoTableDisplay'
import '../styles/allocation.css'
import '../styles/file-preview.css'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { validateCastOffDepart } from '../utils/validateCastOffDepart'
import {
  countSailedWithinDays,
  isIsoInLocalDateRange,
  isWithinSailedLookback,
  SAILED_LOOKBACK_DAY_OPTIONS,
} from '../utils/clearanceSailedLookback.js'
import {
  PURPOSE_FILTER_OPTIONS,
  commodityShortNamesFromRow,
  rowMatchesCommodityShort,
  uniqueCommodityShortOptions,
  rowMatchesPurpose,
} from '../utils/tableCommodityPurposeFilters.js'
import '../styles/modal.css'
import { isEmbedMode } from '../utils/embedMode'

const CLEARANCE_PAGE_SIZE = 20

const CLEARANCE_COLUMN_LABEL_KEYS = {
  vesselName: 'clearanceColVessel',
  jettyOperationCode: 'clearanceColJettyOperationId',
  si: 'clearanceColSi',
  commodityQty: 'clearanceColCommodityQty',
  purpose: 'clearanceColPurpose',
  status: 'clearanceColStatus',
  castOffAt: 'clearanceCastOff',
  vesselPhoto: 'clearanceColVesselPhoto',
}

function VesselPhotoLink({ url, children }) {
  if (!url) return '—'
  return (
    <FilePreviewLink
      url={resolveUploadUrl(url)}
      name="Vessel photo"
      mimeType="image/jpeg"
      className="file-preview-link"
    >
      {children}
    </FilePreviewLink>
  )
}

const CLEARANCE_COLUMNS = [
  { key: 'vesselName', label: 'Vessel', getValue: (r) => <strong>{r.vesselName || '—'}</strong>, getSortValue: (r) => (r.vesselName || '').toLowerCase() },
  {
    key: 'jettyOperationCode',
    label: 'Jetty Operation ID',
    getValue: (r) => r.jettyOperationCode || '—',
    getSortValue: (r) => (r.jettyOperationCode || '').toLowerCase(),
  },
  {
    key: 'si',
    label: 'SI',
    getValue: (r) => r.si || r.referenceNumber || '—',
    getSortValue: (r) => (r.si || r.referenceNumber || '').toLowerCase(),
  },
  {
    key: 'commodityQty',
    label: 'Commodity Qty',
    filterType: 'select',
    getSelectOptions: uniqueCommodityShortOptions,
    matchesFilter: (r, selected) => rowMatchesCommodityShort(r, selected),
    getValue: (r) => r.totalQtyDisplay || r.totalQty || '—',
    getSortValue: (r) => (r.totalQtyDisplay || r.totalQty || '').toLowerCase(),
  },
  {
    key: 'purpose',
    label: 'Purpose',
    filterType: 'select',
    selectOptions: PURPOSE_FILTER_OPTIONS,
    matchesFilter: (r, selected) => rowMatchesPurpose(r, selected),
    getValue: (r) => (
      <span className="loading-list__badge loading-list__badge--purpose" data-purpose={r.purpose}>{r.purpose}</span>
    ),
    getSortValue: (r) => (r.purpose || '').toLowerCase(),
  },
  { key: 'status', label: 'Status', getValue: (r) => r.status || '—', getSortValue: (r) => (r.status || '').toLowerCase() },
  {
    key: 'castOffAt',
    label: 'Cast Off',
    filterType: 'dateRange',
    getValue: (r) => formatDateTimeDisplay(r.castOffAt),
    getSortValue: (r) => r.castOffAt || '',
  },
  {
    key: 'vesselPhoto',
    label: 'Vessel Photo',
    filterable: false,
    getValue: (r) => (r.vesselPhotoUrl ? 'View' : '—'),
    getSortValue: (r) => (r.vesselPhotoUrl ? '1' : '0'),
  },
]

function emptyClearanceFilterValue(col) {
  return col.filterType === 'dateRange' ? { from: '', to: '' } : ''
}

function initialClearanceFilters() {
  return Object.fromEntries(
    CLEARANCE_COLUMNS.filter((c) => c.filterable !== false).map((c) => [c.key, emptyClearanceFilterValue(c)])
  )
}

/** One clearance row per shipment plan for Ready / Sailed; pending sign-off stays per SI. */
function collapseVerificationRowsByPlan(rows) {
  const byPlan = new Map()
  const singles = []
  for (const r of rows) {
    if (r.shipmentPlanId == null || r.apiStatus === 'PENDING_SIGNOFF') {
      singles.push({ ...r, siblingOperationIds: [r.operationId] })
      continue
    }
    const k = Number(r.shipmentPlanId)
    if (Number.isNaN(k)) {
      singles.push({ ...r, siblingOperationIds: [r.operationId] })
      continue
    }
    if (!byPlan.has(k)) byPlan.set(k, [])
    byPlan.get(k).push(r)
  }
  const merged = []
  for (const grp of byPlan.values()) {
    const primary = grp.reduce((a, b) => (Number(a.operationId) < Number(b.operationId) ? a : b))
    const refs = [...new Set(grp.map((g) => g.referenceNumber).filter(Boolean))]
    const totalQtyValues = [...new Set(grp.map((g) => g.totalQtyDisplay || g.totalQty).filter(Boolean))]
    const qtyJoined =
      totalQtyValues.length > 1
        ? totalQtyValues.join('\n')
        : totalQtyValues[0] || primary.totalQtyDisplay || primary.totalQty || '—'
    const shorts = [...new Set(grp.flatMap((g) => commodityShortNamesFromRow(g)))]
    const breakdown = grp.flatMap((g) => (Array.isArray(g.cargoBreakdownSummary) ? g.cargoBreakdownSummary : []))
    merged.push({
      ...primary,
      operationId: primary.operationId,
      siblingOperationIds: grp.map((g) => g.operationId),
      si: refs.length > 1 ? `${refs.length} SIs: ${refs.join(' · ')}` : primary.referenceNumber || primary.si || '—',
      totalQty: qtyJoined,
      totalQtyDisplay: qtyJoined,
      commodityQty: qtyJoined,
      commodityShortDisplay: shorts.join(' · ') || primary.commodityShortDisplay,
      cargoBreakdownSummary: breakdown,
    })
  }
  return [...singles, ...merged]
}

function mapClearanceOperation(o, extras) {
  return {
    operationId: o.id,
    shipmentPlanId: o.shipmentPlanId ?? null,
    jettyOperationCode: o.jettyOperationCode,
    shippingInstructionId: o.shippingInstructionId ?? null,
    vesselName: o.vesselName,
    purpose: o.purpose,
    si: o.referenceNumber ?? '—',
    referenceNumber: o.referenceNumber,
    commodity: o.commodityDisplay || o.commodity || '—',
    commodityDisplay: o.commodityDisplay || o.commodity || '—',
    commodityShortDisplay: o.commodityShortDisplay || o.commodityDisplay || o.commodity || '—',
    cargoBreakdownSummary: Array.isArray(o.cargoBreakdownSummary) ? o.cargoBreakdownSummary : [],
    totalQty: o.totalQtyDisplay || '—',
    totalQtyDisplay: o.totalQtyDisplay || '—',
    commodityQty: o.totalQtyDisplay || '—',
    jettyName: o.jettyName,
    castOffAt: o.castOffAt,
    sailedAt: o.sailedAt,
    tbAt: o.tbAt,
    clearanceDocumentUrl: o.clearanceDocumentUrl,
    vesselPhotoUrl: o.vesselPhotoUrl,
    ...extras,
  }
}

function parseFocusOperationId(searchParams) {
  const raw = String(searchParams.get('operationId') || '').trim()
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

function statusFilterFromSearch(searchParams) {
  const filter = String(searchParams.get('filter') || '').trim().toLowerCase()
  if (filter === 'pending') return 'PENDING'
  if (filter === 'ready') return 'READY'
  if (filter === 'sailed') return 'SAILED'
  if (parseFocusOperationId(searchParams) != null) return 'PENDING'
  return null
}

function rowMatchesFocusStatus(row, focusStatus) {
  if (focusStatus === 'READY') return row?.apiStatus === 'SIGNOFF_APPROVED'
  if (focusStatus === 'SAILED') return row?.apiStatus === 'SAILED'
  if (focusStatus === 'PENDING') return row?.apiStatus === 'PENDING_SIGNOFF'
  return true
}

function rowMatchesOperationId(row, operationId) {
  const id = Number(operationId)
  if (!Number.isFinite(id)) return false
  if (Number(row?.operationId) === id) return true
  const siblings = Array.isArray(row?.siblingOperationIds) ? row.siblingOperationIds : []
  return siblings.some((siblingId) => Number(siblingId) === id)
}

function latestTimelineInstant(events) {
  const arr = Array.isArray(events) ? events : []
  let latest = null
  for (const ev of arr) {
    const candidates = [ev?.startAt, ev?.endAt, ev?.occurredAt, ev?.sortAt, ev?.markedAt]
    for (const c of candidates) {
      if (!c) continue
      const d = new Date(c)
      if (Number.isNaN(d.getTime())) continue
      if (!latest || d.getTime() > latest.getTime()) latest = d
    }
  }
  return latest
}

export default function Verification() {
  const [searchParams] = useSearchParams()
  const scheduleEntryTz = getScheduleEntryTimeZone()
  const toLocalDatetimeValue = useCallback(
    (iso) => utcIsoToNaiveLocal(iso, scheduleEntryTz),
    [scheduleEntryTz]
  )
  const parseLocalTime = useCallback(
    (local) => {
      if (!local || !local.trim()) return null
      try {
        const iso = normalizeForApi(local.trim(), scheduleEntryTz)
        const d = new Date(iso)
        return Number.isNaN(d.getTime()) ? null : d
      } catch {
        return null
      }
    },
    [scheduleEntryTz]
  )
  const { t } = useTranslation('pages')
  const { canApprove } = useRbac()
  const canApproveLoading = canApprove('loading')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [submitErr, setSubmitErr] = useState(null)
  const [modalOpId, setModalOpId] = useState(null)
  const [formCastOff, setFormCastOff] = useState('')
  const [formDocuments, setFormDocuments] = useState([])
  const [formVesselPhotos, setFormVesselPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [signoffBusyId, setSignoffBusyId] = useState(null)
  const [timelineMaxAtByKey, setTimelineMaxAtByKey] = useState({})
  const [siDetailId, setSiDetailId] = useState(null)
  const [vesselInfoPlanId, setVesselInfoPlanId] = useState(null)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)

  const openSiDocumentModal = useCallback((id) => {
    setSiDetailId(null)
    setSiDocumentModalId(id)
  }, [])
  const openSiDetailModal = useCallback((id) => {
    setSiDocumentModalId(null)
    setSiDetailId(id)
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const pendingPromise = fetchPendingSignoffRequests().catch(() => [])
      const [signedOff, sailed, pendingRaw] = await Promise.all([
        fetchOperations({ status: 'SIGNOFF_APPROVED' }),
        fetchOperations({ status: 'SAILED' }),
        pendingPromise,
      ])
      const pending = (pendingRaw || []).map((o) => mapClearanceOperation(o, {
        status: 'Pending sign-off',
        apiStatus: 'PENDING_SIGNOFF',
        signoffRequestedAt: o.signoffRequestedAt,
        signoffRequestRemark: o.signoffRequestRemark,
        signoffRequestedByUsername: o.signoffRequestedByUsername,
      }))
      const ready = (signedOff || []).map((o) => mapClearanceOperation(o, {
        status: 'Ready to Sail',
        apiStatus: o.status,
      }))
      const done = (sailed || []).map((o) => mapClearanceOperation(o, {
        status: 'Sailed',
        apiStatus: o.status,
      }))
      const pendingWithSiblings = pending.map((r) => ({ ...r, siblingOperationIds: [r.operationId] }))
      setRows([...pendingWithSiblings, ...collapseVerificationRowsByPlan(ready), ...collapseVerificationRowsByPlan(done)])
    } catch (e) {
      setErr(e?.message || 'Failed to load clearance data')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = window.setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(t)
  }, [toast])

  const [filters, setFilters] = useState(initialClearanceFilters)
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })
  const initialFocusOperationId = parseFocusOperationId(searchParams)
  const [statusFilter, setStatusFilter] = useState(() => statusFilterFromSearch(searchParams) || 'ALL')
  const [pinnedOperationId, setPinnedOperationId] = useState(initialFocusOperationId)
  const [sailedLookbackDays, setSailedLookbackDays] = useState(null)
  const [listPage, setListPage] = useState(1)
  const [expandedRows, setExpandedRows] = useState({})
  const [expandedMobileRows, setExpandedMobileRows] = useState({})
  const pinnedCodeRef = useRef(null)
  const focusHydratedRef = useRef(false)
  const appliedFocusKeyRef = useRef(null)
  const focusRowRef = useRef(null)
  const focusCardRef = useRef(null)
  const didScrollToFocusRef = useRef(false)
  const queryFocusKey = `${searchParams.get('filter') || ''}:${searchParams.get('operationId') || ''}`

  const releaseOperationFocus = useCallback((opts) => {
    const clearPinnedCode = opts?.clearPinnedCode !== false
    setPinnedOperationId(null)
    didScrollToFocusRef.current = false
    if (!clearPinnedCode) {
      pinnedCodeRef.current = null
      return
    }
    const code = pinnedCodeRef.current
    pinnedCodeRef.current = null
    if (!code) return
    setFilters((f) => (f.jettyOperationCode === code ? { ...f, jettyOperationCode: '' } : f))
  }, [])

  useEffect(() => {
    if (appliedFocusKeyRef.current === queryFocusKey) return
    appliedFocusKeyRef.current = queryFocusKey
    const nextId = parseFocusOperationId(searchParams)
    const nextStatus = statusFilterFromSearch(searchParams)
    if (nextStatus) {
      setStatusFilter(nextStatus)
      setListPage(1)
    }
    setPinnedOperationId(nextId)
    didScrollToFocusRef.current = false
    if (nextId == null) {
      pinnedCodeRef.current = null
      return
    }
    focusHydratedRef.current = false
  }, [queryFocusKey, searchParams])

  useEffect(() => {
    if (loading || focusHydratedRef.current) return
    if (pinnedOperationId == null) {
      if (parseFocusOperationId(searchParams) != null) return
      focusHydratedRef.current = true
      return
    }
    focusHydratedRef.current = true
    const focusStatus = statusFilterFromSearch(searchParams) || 'PENDING'
    const match = rows.find(
      (r) => rowMatchesFocusStatus(r, focusStatus) && rowMatchesOperationId(r, pinnedOperationId)
    )
    if (!match) return
    const code = String(match.jettyOperationCode || '').trim()
    if (code) {
      pinnedCodeRef.current = code
      setFilters((f) => ({ ...f, jettyOperationCode: code }))
    }
    setExpandedRows((prev) => ({ ...prev, [match.operationId]: true }))
    setExpandedMobileRows((prev) => ({ ...prev, [match.operationId]: true }))
  }, [loading, rows, pinnedOperationId, searchParams])

  const readyCount = rows.filter((r) => r.apiStatus === 'SIGNOFF_APPROVED').length
  const departedCount = rows.filter((r) => r.apiStatus === 'SAILED').length
  const pendingSignoffCount = rows.filter((r) => r.apiStatus === 'PENDING_SIGNOFF').length
  const sailedLookbackCounts = {
    all: countSailedWithinDays(rows, null),
    ...Object.fromEntries(SAILED_LOOKBACK_DAY_OPTIONS.map((days) => [days, countSailedWithinDays(rows, days)])),
  }

  const updateFilter = (key, value) => {
    releaseOperationFocus({ clearPinnedCode: key !== 'jettyOperationCode' })
    setFilters((f) => ({ ...f, [key]: value }))
    setListPage(1)
  }
  const updateDateRangeFilter = (key, bound, value) => {
    releaseOperationFocus()
    setFilters((f) => {
      const prev = f[key] && typeof f[key] === 'object' ? f[key] : { from: '', to: '' }
      return { ...f, [key]: { ...prev, [bound]: value } }
    })
    setListPage(1)
  }
  const handleSort = (key) => {
    setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
    setListPage(1)
  }

  const rowsAfterStatusFilter = rows.filter((r) => {
    if (statusFilter === 'READY') return r.apiStatus === 'SIGNOFF_APPROVED'
    if (statusFilter === 'SAILED') {
      if (r.apiStatus !== 'SAILED') return false
      return isWithinSailedLookback(r, sailedLookbackDays)
    }
    if (statusFilter === 'PENDING') return r.apiStatus === 'PENDING_SIGNOFF'
    return true
  })

  const rowsAfterFocus =
    pinnedOperationId == null
      ? rowsAfterStatusFilter
      : rowsAfterStatusFilter.filter((r) => rowMatchesOperationId(r, pinnedOperationId))

  const filteredVessels = rowsAfterFocus.filter((r) => {
    return CLEARANCE_COLUMNS.every((col) => {
      if (col.filterable === false) return true
      if (col.filterType === 'dateRange') {
        const range = filters[col.key] && typeof filters[col.key] === 'object' ? filters[col.key] : {}
        return isIsoInLocalDateRange(r[col.key], range.from, range.to)
      }
      if (col.filterType === 'select') {
        const selected = String(filters[col.key] || '').trim()
        if (!selected) return true
        if (col.matchesFilter) return col.matchesFilter(r, selected)
        return String(r[col.key] ?? '') === selected
      }
      const f = String(filters[col.key] || '').trim().toLowerCase()
      if (!f) return true
      const val = col.getFilterValue ? col.getFilterValue(r) : r[col.key]
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = CLEARANCE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    return sortState.dir === 'asc'
      ? String(va).localeCompare(String(vb), undefined, { numeric: true })
      : String(vb).localeCompare(String(va), undefined, { numeric: true })
  })

  useEffect(() => {
    setListPage(1)
  }, [statusFilter, sailedLookbackDays, filters, sortState.key, sortState.dir])

  const listTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedVessels.length / CLEARANCE_PAGE_SIZE)),
    [sortedVessels.length]
  )

  useEffect(() => {
    setListPage((p) => Math.min(p, listTotalPages))
  }, [listTotalPages])

  const pagedVessels = useMemo(() => {
    const start = (listPage - 1) * CLEARANCE_PAGE_SIZE
    return sortedVessels.slice(start, start + CLEARANCE_PAGE_SIZE)
  }, [sortedVessels, listPage])

  useEffect(() => {
    if (didScrollToFocusRef.current || pinnedOperationId == null || loading) return
    const row = focusRowRef.current
    const card = focusCardRef.current
    const visible = (el) => Boolean(el && el.getClientRects().length > 0)
    const target = visible(row) ? row : visible(card) ? card : null
    if (!target) return
    didScrollToFocusRef.current = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [pinnedOperationId, loading, pagedVessels])

  const listPaginationRange = useMemo(() => {
    const total = sortedVessels.length
    if (total === 0) return { from: 0, to: 0 }
    const from = (listPage - 1) * CLEARANCE_PAGE_SIZE + 1
    const to = Math.min(listPage * CLEARANCE_PAGE_SIZE, total)
    return { from, to }
  }, [sortedVessels.length, listPage])

  const paginationBar = sortedVessels.length > 0 ? (
    <div className="clearance-pagination" role="navigation" aria-label={t('clearancePaginationAria')}>
      <p className="text-steel clearance-pagination__summary">
        {t('clearancePaginationShowing', {
          from: listPaginationRange.from,
          to: listPaginationRange.to,
          total: sortedVessels.length,
        })}
      </p>
      <div className="clearance-pagination__controls">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          disabled={listPage <= 1}
          onClick={() => setListPage((p) => Math.max(1, p - 1))}
        >
          {t('clearancePaginationPrev')}
        </button>
        <span className="text-steel clearance-pagination__page">
          {t('clearancePaginationPageOf', { page: listPage, totalPages: listTotalPages })}
        </span>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          disabled={listPage >= listTotalPages}
          onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
        >
          {t('clearancePaginationNext')}
        </button>
      </div>
    </div>
  ) : null

  const openModal = useCallback(
    (op) => {
      setSubmitErr(null)
      setModalOpId(op.operationId)
      if (op.apiStatus === 'SAILED') {
        setFormCastOff(toLocalDatetimeValue(op.castOffAt))
      } else {
        setFormCastOff(nowToNaiveLocalInScheduleZone(scheduleEntryTz))
      }
      setFormDocuments([])
      setFormVesselPhotos([])
    },
    [scheduleEntryTz, toLocalDatetimeValue]
  )

  const closeModal = useCallback(() => {
    setModalOpId(null)
    setSubmitErr(null)
  }, [])

  const clearFilters = () => {
    setPinnedOperationId(null)
    pinnedCodeRef.current = null
    didScrollToFocusRef.current = false
    setFilters(initialClearanceFilters())
    setStatusFilter('ALL')
    setSailedLookbackDays(null)
    setListPage(1)
  }

  const selectStatus = (next) => {
    releaseOperationFocus()
    setStatusFilter(next)
    setListPage(1)
  }

  const hubPathForRow = (r) => {
    const purpose = r.purpose === 'Unloading' ? 'unloading' : 'loading'
    return `/${purpose}/op-${r.operationId}/post-checking`
  }

  const handleApproveSignoff = async (r) => {
    if (!r?.operationId) return
    if (!window.confirm(`Sign off operation for ${r.vesselName || 'this vessel'}? It will move to Ready to Sail.`)) return
    setSignoffBusyId(r.operationId)
    setSubmitErr(null)
    try {
      await signoff(r.operationId)
      await load()
      setToast({ message: `Operation signed off — ${r.vesselName || 'Vessel'} is Ready to Sail.`, variant: 'success' })
    } catch (e) {
      const msg = (e?.body && typeof e.body === 'object' && e.body.error) || e?.message || 'Sign-off failed'
      setToast({ message: msg, variant: 'error' })
    } finally {
      setSignoffBusyId(null)
    }
  }

  const toggleExpanded = (operationId) => {
    setExpandedRows((prev) => ({ ...prev, [operationId]: !prev[operationId] }))
  }

  const toggleExpandedMobile = (operationId) => {
    setExpandedMobileRows((prev) => ({ ...prev, [operationId]: !prev[operationId] }))
  }

  const addDocumentFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, file: f }))
    setFormDocuments((prev) => [...prev, ...newOnes])
  }

  const addVesselPhotoFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, file: f }))
    setFormVesselPhotos((prev) => [...prev, ...newOnes])
  }

  const toIso = useCallback(
    (local) => {
      if (!local || !local.trim()) return new Date().toISOString()
      try {
        return normalizeForApi(local.trim(), scheduleEntryTz)
      } catch {
        return new Date().toISOString()
      }
    },
    [scheduleEntryTz]
  )

  useEffect(() => {
    let cancelled = false
    if (!modalOpId) return () => { cancelled = true }
    const op = rows.find((r) => r.operationId === modalOpId)
    const cacheKey = op?.shipmentPlanId != null ? `sp:${op.shipmentPlanId}` : `op:${modalOpId}`
    if (timelineMaxAtByKey[cacheKey] !== undefined) return () => { cancelled = true }
    const opIds = Array.isArray(op?.siblingOperationIds) && op.siblingOperationIds.length > 0 ? op.siblingOperationIds : [modalOpId]
    Promise.all(opIds.map((id) => fetchActivityTimeline(id).catch(() => ({ events: [] }))))
      .then((results) => {
        if (cancelled) return
        let latest = null
        for (const res of results) {
          const cand = latestTimelineInstant(res?.events)
          if (cand && (!latest || cand.getTime() > latest.getTime())) latest = cand
        }
        setTimelineMaxAtByKey((prev) => ({ ...prev, [cacheKey]: latest ? latest.toISOString() : null }))
      })
      .catch(() => {
        if (cancelled) return
        setTimelineMaxAtByKey((prev) => ({ ...prev, [cacheKey]: null }))
      })
    return () => {
      cancelled = true
    }
  }, [modalOpId, rows, timelineMaxAtByKey])

  const validateDepartForm = useCallback(() => {
    const cast = parseLocalTime(formCastOff)
    if (!cast) return 'Cast Off time is required and must be valid.'
    if (modalOpId) {
      const op = rows.find((r) => r.operationId === modalOpId)
      const cacheKey = op?.shipmentPlanId != null ? `sp:${op.shipmentPlanId}` : `op:${modalOpId}`
      const latestIso = timelineMaxAtByKey[cacheKey]
      return validateCastOffDepart(cast, {
        tbAt: op?.tbAt ?? null,
        latestExecutionAt: latestIso ?? null,
      })
    }
    return validateCastOffDepart(cast, {})
  }, [formCastOff, modalOpId, rows, timelineMaxAtByKey, parseLocalTime])

  const handleSubmit = async () => {
    if (!modalOpId) return
    const op = rows.find((r) => r.operationId === modalOpId)
    if (op?.apiStatus === 'SAILED') {
      closeModal()
      return
    }
    setSubmitErr(null)
    const validationError = validateDepartForm()
    if (validationError) {
      setSubmitErr(validationError)
      return
    }
    setSubmitting(true)
    try {
      let clearanceUrl = null
      let photoUrl = null

      const clearanceFiles = formDocuments.map((d) => d.file).filter(Boolean)
      if (clearanceFiles.length > 0) {
        const uploaded = await uploadOperationDocuments(modalOpId, 'CLEARANCE', clearanceFiles)
        clearanceUrl = uploaded?.items?.[0]?.url || null
      }

      const vesselPhotoFiles = formVesselPhotos.map((d) => d.file).filter(Boolean)
      if (vesselPhotoFiles.length > 0) {
        const uploaded = await uploadOperationDocuments(modalOpId, 'VESSEL_PHOTO', vesselPhotoFiles)
        photoUrl = uploaded?.items?.[0]?.url || null
      }

      const castOffIso = toIso(formCastOff)
      if (op?.shipmentPlanId != null) {
        await departShipmentPlan(op.shipmentPlanId, castOffIso, clearanceUrl, photoUrl)
      } else {
        await depart(modalOpId, castOffIso, clearanceUrl, photoUrl)
      }
      await load()
      setToast({ message: `Departure recorded for ${op?.vesselName || 'vessel'}.`, variant: 'success' })
      closeModal()
    } catch (e) {
      setSubmitErr(e?.message || 'Depart failed')
    } finally {
      setSubmitting(false)
    }
  }

  const modalRow = modalOpId ? rows.find((r) => r.operationId === modalOpId) : null
  const isSailed = modalRow?.apiStatus === 'SAILED'
  const formValidationError = isSailed ? null : validateDepartForm()
  const modalTimelineCacheKey =
    modalRow?.shipmentPlanId != null ? `sp:${modalRow.shipmentPlanId}` : modalOpId != null ? `op:${modalOpId}` : null
  const modalTimelineMaxAt = modalTimelineCacheKey ? timelineMaxAtByKey[modalTimelineCacheKey] : null
  const isEmbed = isEmbedMode(searchParams)

  return (
    <div className={`allocation-page clearance-page${isEmbed ? ' clearance-page--embed' : ''}`}>
      {isEmbed ? null : <h1 className="page-title">{t('clearance')}</h1>}
      {toast?.message && (
        <div className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`} role="status" aria-live="polite" aria-atomic="true">
          <span className="toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {err && <p style={{ color: '#c00' }}>{err}</p>}

      <section className="at-berth-summary" aria-label={t('clearanceSummary')}>
        <div className="at-berth-summary__grid at-berth-summary__grid--2">
          <div className="at-berth-card at-berth-card--clearance-ready">
            <h3 className="at-berth-card__title">⚓ {t('clearanceReadyToSail')}</h3>
            <p className="at-berth-card__count">{readyCount}</p>
          </div>
          <div className="at-berth-card at-berth-card--clearance-departed">
            <h3 className="at-berth-card__title">🚀 {t('clearanceSailed')}</h3>
            <p className="at-berth-card__count">{departedCount}</p>
          </div>
        </div>
      </section>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">{t('clearanceOperations')}</h2>
          <div className="clearance-status-filter" role="group" aria-label={t('clearanceFilterByStatus')}>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'ALL' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => selectStatus('ALL')}
            >
              {t('clearanceAll')} ({rows.length})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'READY' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => selectStatus('READY')}
            >
              {t('clearanceReadyToSail')} ({readyCount})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'SAILED' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => selectStatus('SAILED')}
            >
              {t('clearanceSailed')} ({departedCount})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'PENDING' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => selectStatus('PENDING')}
            >
              {t('clearancePendingSignoff')} ({pendingSignoffCount})
            </button>
            <button type="button" className="btn btn--small btn--soft" onClick={clearFilters}>
              {t('clearanceClearFilters')}
            </button>
          </div>
        </div>
        {statusFilter === 'SAILED' ? (
          <div className="clearance-sailed-lookback" role="group" aria-label={t('clearanceSailedLookbackAria')}>
            <button
              type="button"
              className={`btn btn--small ${sailedLookbackDays == null ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setSailedLookbackDays(null)
                setListPage(1)
              }}
            >
              {t('clearanceSailedLookbackAll')} ({sailedLookbackCounts.all})
            </button>
            {SAILED_LOOKBACK_DAY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={`btn btn--small ${sailedLookbackDays === days ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => {
                  setSailedLookbackDays(days)
                  setListPage(1)
                }}
              >
                {t('clearanceSailedLookbackDays', { days })} ({sailedLookbackCounts[days]})
              </button>
            ))}
          </div>
        ) : null}
        {loading ? (
          <p className="text-steel">{t('clearanceFetchingLatest')}</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">{t('clearanceNoOperations')}</p>
        ) : (
          <>
          <div className="table-wrap allocation-table-desktop">
            <table className="data-table allocation-table clearance-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label="Expand row details" />
                  {CLEARANCE_COLUMNS.map((col) => (
                    <th key={col.key} className="allocation-table__th">
                      <button type="button" className="allocation-table__sort" onClick={() => handleSort(col.key)}>
                        {t(CLEARANCE_COLUMN_LABEL_KEYS[col.key] || col.label)}
                        <span className="allocation-table__sort-icon">
                          {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="allocation-table__action-col">{t('clearanceColAction')}</th>
                </tr>
                <tr className="allocation-table__filter-row">
                  <th className="allocation-table__expand-col" />
                  {CLEARANCE_COLUMNS.map((col) => (
                    <th key={col.key}>
                      {col.filterable === false ? null : col.filterType === 'dateRange' ? (
                        <div className="clearance-date-range-filter">
                          <input
                            type="date"
                            className="allocation-table__filter clearance-date-range-filter__input"
                            value={filters[col.key]?.from || ''}
                            onChange={(e) => updateDateRangeFilter(col.key, 'from', e.target.value)}
                            aria-label={t('clearanceDateRangeFromAria', {
                              column: t(CLEARANCE_COLUMN_LABEL_KEYS[col.key] || col.label),
                            })}
                          />
                          <input
                            type="date"
                            className="allocation-table__filter clearance-date-range-filter__input"
                            value={filters[col.key]?.to || ''}
                            onChange={(e) => updateDateRangeFilter(col.key, 'to', e.target.value)}
                            aria-label={t('clearanceDateRangeToAria', {
                              column: t(CLEARANCE_COLUMN_LABEL_KEYS[col.key] || col.label),
                            })}
                          />
                        </div>
                      ) : col.filterType === 'select' ? (
                        <ColumnSelectFilter
                          value={filters[col.key] || ''}
                          onChange={(value) => updateFilter(col.key, value)}
                          options={col.getSelectOptions ? col.getSelectOptions(rows) : col.selectOptions || []}
                          allLabel={t('clearanceAll')}
                          ariaLabel={t('clearanceFilterSelectAria', {
                            column: t(CLEARANCE_COLUMN_LABEL_KEYS[col.key] || col.label),
                          })}
                        />
                      ) : (
                        <input
                          type="text"
                          className="allocation-table__filter"
                          value={filters[col.key] || ''}
                          onChange={(e) => updateFilter(col.key, e.target.value)}
                          aria-label={t(CLEARANCE_COLUMN_LABEL_KEYS[col.key] || col.label)}
                        />
                      )}
                    </th>
                  ))}
                  <th className="allocation-table__action-col" />
                </tr>
              </thead>
              <tbody>
                {pagedVessels.length === 0 ? (
                  <tr>
                    <td className="text-steel clearance-table__empty" colSpan={CLEARANCE_COLUMNS.length + 2}>
                      {t('clearanceNoRowsMatch')}
                    </td>
                  </tr>
                ) : (
                  pagedVessels.flatMap((v) => {
                  const expanded = Boolean(expandedRows[v.operationId])
                  const focused = pinnedOperationId != null && rowMatchesOperationId(v, pinnedOperationId)
                  const mainRow = (
                    <tr
                      key={v.operationId}
                      ref={focused ? focusRowRef : undefined}
                      className={`allocation-table__row${expanded ? ' allocation-table__row--expanded' : ''}${focused ? ' allocation-table__row--focus' : ''}`}
                    >
                      <td className="allocation-table__expand-col">
                        <button
                          type="button"
                          className="allocation-table__sort"
                          onClick={() => toggleExpanded(v.operationId)}
                          aria-label={expanded ? 'Collapse vessel details' : 'Expand vessel details'}
                        >
                          <span className="allocation-table__expand-icon">{expanded ? '▼' : '▶'}</span>
                        </button>
                      </td>
                      {CLEARANCE_COLUMNS.map((col) => (
                        <td key={col.key}>
                          {col.key === 'jettyOperationCode' ? (
                            v.shippingInstructionId ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  openSiDetailModal(v.shippingInstructionId)
                                }}
                                aria-label={t('openSiDetailFromJettyOp')}
                              >
                                {v.jettyOperationCode || '—'}
                              </a>
                            ) : (
                              v.jettyOperationCode || '—'
                            )
                          ) : col.key === 'si' ? (
                            v.shippingInstructionId ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  openSiDocumentModal(v.shippingInstructionId)
                                }}
                                aria-label={t('openSiDocument')}
                              >
                                {v.si || '—'}
                              </a>
                            ) : (
                              v.si || '—'
                            )
                          ) : col.key === 'commodityQty' ? (
                            renderCommodityQtyCell(v)
                          ) : col.key === 'vesselName' && v.shipmentPlanId != null ? (
                            <VesselNameButton
                              name={v.vesselName || '—'}
                              onClick={() => setVesselInfoPlanId(v.shipmentPlanId)}
                              strong
                            />
                          ) : col.key === 'vesselPhoto' ? (
                            <VesselPhotoLink url={v.vesselPhotoUrl}>{t('clearanceView')}</VesselPhotoLink>
                          ) : (
                            col.getValue(v)
                          )}
                        </td>
                      ))}
                      <td className="allocation-table__action-col">
                        <div className="allocation-table__action-btns">
                          {v.apiStatus === 'PENDING_SIGNOFF' ? (
                            <>
                              <Link to={hubPathForRow(v)} className="btn btn--small btn--ghost">
                                {t('clearanceOpenOperation')}
                              </Link>
                              {canApproveLoading ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--primary"
                                  disabled={signoffBusyId === v.operationId}
                                  onClick={() => handleApproveSignoff(v)}
                                >
                                  {signoffBusyId === v.operationId ? t('clearanceSigningOff') : t('clearanceSignOff')}
                                </button>
                              ) : null}
                            </>
                          ) : v.apiStatus === 'SIGNOFF_APPROVED' ? (
                            <button type="button" className="btn btn--small btn--primary" onClick={() => openModal(v)}>
                              {t('clearanceRecordDepart')}
                            </button>
                          ) : (
                            <button type="button" className="btn btn--small btn--ghost" onClick={() => openModal(v)}>
                              {t('clearanceView')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                  if (!expanded) return [mainRow]
                  const detailRow = (
                    <tr className="allocation-table__detail-row" key={`detail-${v.operationId}`}>
                      <td className="allocation-table__detail-cell" colSpan={CLEARANCE_COLUMNS.length + 2}>
                        <div className="allocation-detail">
                          <h3 className="allocation-detail__title">Vessel details</h3>
                          <dl className="allocation-detail__grid">
                            <dt>Vessel Name</dt>
                            <dd>{v.vesselName || '—'}</dd>
                            <dt>{t('clearanceColJettyOperationId')}</dt>
                            <dd>
                              {v.shippingInstructionId ? (
                                <a
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    openSiDetailModal(v.shippingInstructionId)
                                  }}
                                  aria-label={t('openSiDetailFromJettyOp')}
                                >
                                  {v.jettyOperationCode || '—'}
                                </a>
                              ) : (
                                v.jettyOperationCode || '—'
                              )}
                            </dd>
                            <dt>Shipping Instruction</dt>
                            <dd>{v.referenceNumber || '—'}</dd>
                            <dt>Commodity</dt>
                            <dd>{v.commodity || '—'}</dd>
                            <dt>Purpose</dt>
                            <dd>{v.purpose || '—'}</dd>
                            <dt>Jetty</dt>
                            <dd>{v.jettyName || '—'}</dd>
                            <dt>Status</dt>
                            <dd>{v.status || '—'}</dd>
                            {v.apiStatus === 'PENDING_SIGNOFF' ? (
                              <>
                                <dt>Sign-off requested</dt>
                                <dd>{formatDateTimeDisplay(v.signoffRequestedAt)}</dd>
                                {v.signoffRequestedByUsername ? (
                                  <>
                                    <dt>Requested by</dt>
                                    <dd>{v.signoffRequestedByUsername}</dd>
                                  </>
                                ) : null}
                                {v.signoffRequestRemark ? (
                                  <>
                                    <dt>Request remark</dt>
                                    <dd>{v.signoffRequestRemark}</dd>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )
                  return [mainRow, detailRow]
                })
                )}
              </tbody>
            </table>
          </div>
          <div className="allocation-mobile-cards" aria-label={t('clearanceOperationCardsAria')}>
            {pagedVessels.length === 0 ? (
              <p className="text-steel">{t('clearanceNoRowsMatch')}</p>
            ) : (
              pagedVessels.map((v) => {
              const focused = pinnedOperationId != null && rowMatchesOperationId(v, pinnedOperationId)
              return (
              <article
                key={`clearance-mobile-${v.operationId}`}
                ref={focused ? focusCardRef : undefined}
                className={`allocation-mobile-card${focused ? ' allocation-mobile-card--focus' : ''}`}
              >
                <header className="allocation-mobile-card__header">
                  <strong>{v.vesselName || '—'}</strong>
                  <span className="text-steel">{v.status || '—'}</span>
                </header>
                <dl className="allocation-mobile-card__grid">
                  <dt>{t('clearanceColJettyOperationId')}</dt>
                  <dd>
                    {v.shippingInstructionId ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          openSiDetailModal(v.shippingInstructionId)
                        }}
                        aria-label={t('openSiDetailFromJettyOp')}
                      >
                        {v.jettyOperationCode || '—'}
                      </a>
                    ) : (
                      v.jettyOperationCode || '—'
                    )}
                  </dd>
                  <dt>{t('clearanceColSi')}</dt>
                  <dd>
                    {v.shippingInstructionId ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          openSiDocumentModal(v.shippingInstructionId)
                        }}
                        aria-label={t('openSiDocument')}
                      >
                        {v.si || '—'}
                      </a>
                    ) : (
                      v.si || '—'
                    )}
                  </dd>
                  <dt>{t('clearanceColCommodityQty')}</dt>
                  <dd className="si-cargo-qty-cell">{v.totalQtyDisplay || v.totalQty || '—'}</dd>
                  <dt>{t('clearanceColPurpose')}</dt>
                  <dd>{v.purpose || '—'}</dd>
                  <dt>{t('clearanceColStatus')}</dt>
                  <dd>{v.status || '—'}</dd>
                  <dt>{t('clearanceCastOff')}</dt>
                  <dd>{formatDateTimeDisplay(v.castOffAt)}</dd>
                  <dt>{t('clearanceColVesselPhoto')}</dt>
                  <dd>
                    <VesselPhotoLink url={v.vesselPhotoUrl}>{t('clearanceView')}</VesselPhotoLink>
                  </dd>
                </dl>
                <div className="allocation-mobile-card__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => toggleExpandedMobile(v.operationId)}
                  >
                    {expandedMobileRows[v.operationId] ? t('clearanceHideDetail') : t('clearanceFullDetail')}
                  </button>
                  {v.apiStatus === 'PENDING_SIGNOFF' ? (
                    <>
                      <Link to={hubPathForRow(v)} className="btn btn--small btn--ghost">
                        {t('clearanceOpenOperation')}
                      </Link>
                      {canApproveLoading ? (
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          disabled={signoffBusyId === v.operationId}
                          onClick={() => handleApproveSignoff(v)}
                        >
                          {signoffBusyId === v.operationId ? t('clearanceSigningOff') : t('clearanceSignOff')}
                        </button>
                      ) : null}
                    </>
                  ) : v.apiStatus === 'SIGNOFF_APPROVED' ? (
                    <button type="button" className="btn btn--small btn--primary" onClick={() => openModal(v)}>
                      {t('clearanceRecordDepart')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => openModal(v)}>
                      {t('clearanceView')}
                    </button>
                  )}
                </div>
                {expandedMobileRows[v.operationId] ? (
                  <div className="allocation-mobile-card__detail">
                    <div className="allocation-detail">
                      <h3 className="allocation-detail__title">Vessel details</h3>
                      <dl className="allocation-detail__grid">
                        <dt>Vessel Name</dt>
                        <dd>{v.vesselName || '—'}</dd>
                        <dt>{t('clearanceColJettyOperationId')}</dt>
                        <dd>
                          {v.shippingInstructionId ? (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault()
                                openSiDetailModal(v.shippingInstructionId)
                              }}
                              aria-label={t('openSiDetailFromJettyOp')}
                            >
                              {v.jettyOperationCode || '—'}
                            </a>
                          ) : (
                            v.jettyOperationCode || '—'
                          )}
                        </dd>
                        <dt>Shipping Instruction</dt>
                        <dd>{v.referenceNumber || '—'}</dd>
                        <dt>Commodity</dt>
                        <dd>{v.commodity || '—'}</dd>
                        <dt>Purpose</dt>
                        <dd>{v.purpose || '—'}</dd>
                        <dt>Jetty</dt>
                        <dd>{v.jettyName || '—'}</dd>
                        <dt>Status</dt>
                        <dd>{v.status || '—'}</dd>
                        {v.apiStatus === 'PENDING_SIGNOFF' ? (
                          <>
                            <dt>Sign-off requested</dt>
                            <dd>{formatDateTimeDisplay(v.signoffRequestedAt)}</dd>
                            {v.signoffRequestedByUsername ? (
                              <>
                                <dt>Requested by</dt>
                                <dd>{v.signoffRequestedByUsername}</dd>
                              </>
                            ) : null}
                            {v.signoffRequestRemark ? (
                              <>
                                <dt>Request remark</dt>
                                <dd>{v.signoffRequestRemark}</dd>
                              </>
                            ) : null}
                          </>
                            ) : null}
                          </dl>
                        </div>
                      </div>
                    ) : null}
              </article>
              )
              })
            )}
          </div>
          {paginationBar}
          </>
        )}
      </section>

      {modalOpId && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="clearance-modal-title"
            aria-modal="true"
          >
            <h2 id="clearance-modal-title" className="modal__title">
              Clearance — {modalRow?.vesselName ?? 'Vessel'} {isSailed ? '(Sailed)' : ''}
            </h2>

            {isSailed && (
              <p className="text-steel">This operation has already sailed. Departure times and evidence are read-only.</p>
            )}

            <div className="modal__section">
              <label htmlFor="clearance-cast-off" className="modal__label">Cast Off</label>
              {isSailed ? (
                <input
                  id="clearance-cast-off"
                  type="text"
                  className="modal__input"
                  value={formatDateTimeDisplay(modalRow?.castOffAt)}
                  readOnly
                  disabled
                  aria-readonly="true"
                />
              ) : (
                <input
                  id="clearance-cast-off"
                  type="datetime-local"
                  className="modal__input"
                  value={formCastOff}
                  onChange={(e) => setFormCastOff(e.target.value)}
                />
              )}
              {modalTimelineMaxAt ? (
                <p className="text-steel" style={{ marginTop: 6, fontSize: 'var(--font-size-small)' }}>
                  Must be on/after latest execution log time: <strong>{formatDateTimeDisplay(modalTimelineMaxAt)}</strong>
                </p>
              ) : null}
            </div>

            {!isSailed && (
              <>
                <div className="modal__section">
                  <label className="modal__label">Document (optional)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formDocuments.length > 0 ? `${formDocuments.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addDocumentFiles} className="berthing-modal__file-input" />
                  </label>
                  {formDocuments.length > 0 ? (
                    <ul className="loading-step-card__file-list">
                      {formDocuments.map((f, idx) => (
                        <li key={`${f.name}-${idx}`}>{f.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="modal__section">
                  <label className="modal__label">Vessel photo (optional)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formVesselPhotos.length > 0 ? `${formVesselPhotos.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addVesselPhotoFiles} className="berthing-modal__file-input" />
                  </label>
                  {formVesselPhotos.length > 0 ? (
                    <ul className="loading-step-card__file-list">
                      {formVesselPhotos.map((f, idx) => (
                        <li key={`${f.name}-${idx}`}>{f.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            )}

            {isSailed ? (
              <div className="modal__section">
                <h3 className="modal__label">Recorded departure</h3>
                <ul className="loading-step-card__file-list">
                  <li>
                    Clearance document:{' '}
                    {modalRow?.clearanceDocumentUrl ? (
                      <FilePreviewLink
                        url={resolveUploadUrl(modalRow.clearanceDocumentUrl)}
                        name="Clearance document"
                        className="file-preview-link"
                      />
                    ) : (
                      '—'
                    )}
                  </li>
                  <li>
                    Vessel photo:{' '}
                    {modalRow?.vesselPhotoUrl ? (
                      <FilePreviewLink
                        url={resolveUploadUrl(modalRow.vesselPhotoUrl)}
                        name="Vessel photo"
                        mimeType="image/jpeg"
                        className="file-preview-link"
                      />
                    ) : (
                      '—'
                    )}
                  </li>
                </ul>
              </div>
            ) : null}

            {submitErr && <p style={{ color: '#c00' }}>{submitErr}</p>}
            {!isSailed && formValidationError ? (
              <p className="operational-form-error" role="alert">
                {formValidationError}
              </p>
            ) : null}

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>{t('clearanceClose')}</button>
              {!isSailed && (
                <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={submitting || Boolean(formValidationError)}>
                  {submitting ? t('clearanceSubmitting') : t('clearanceSubmitDepart')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <SiDetailModal
        isOpen={Boolean(siDetailId)}
        siId={siDetailId}
        onClose={() => setSiDetailId(null)}
      />
      <SiDocumentModal
        isOpen={Boolean(siDocumentModalId)}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
      />
      <VesselInfoModal
        planId={vesselInfoPlanId}
        isOpen={vesselInfoPlanId != null}
        onClose={() => setVesselInfoPlanId(null)}
        onSaved={() => load().catch(() => {})}
      />
    </div>
  )
}
