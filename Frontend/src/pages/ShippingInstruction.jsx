import { useState, Fragment, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchShippingInstructions,
  fetchShippingInstruction,
  createShippingInstruction,
} from '../api/shippingInstructions'
import { fetchSiLookups } from '../api/siLookups'
import { updateShippingInstruction } from '../api/shippingInstructions'
import { useActivityLog } from '../context/ActivityLogContext'

function mapSiFromApi(row) {
  return {
    id: row.id,
    siId: row.referenceNumber || `SI-${row.id}`,
    vesselName: row.vesselName,
    vesselId: `v-${row.id}`,
    purpose: row.purpose,
    status: row.status,
    commodity: row.commodity,
    etaDateTime: row.eta,
    etaFrom: row.etaFrom || (row.eta ? String(row.eta).slice(0, 10) : ''),
    etaTo: row.etaTo || (row.eta ? String(row.eta).slice(0, 10) : ''),
    shipper: row.shipperName ?? '—',
    loadingPort: row.loadingPortName ?? '—',
    agent: row.agentName ?? '—',
    surveyor: row.surveyorName ?? '—',
    breakdown: [],
    totalQtyKg: 0,
    receivedAt: row.createdAt,
    term: row.tradeTermCode ?? '—',
    jetty: row.preferredJettyName ?? null,
    note: row.note ?? null,
    documents: [],
  }
}
import '../styles/shipping-instruction.css'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** ETA as single date/time for table display */
function formatEta(n) {
  const raw = n.etaDateTime || n.etaFrom || n.ETA
  if (!raw) return '—'
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** Action icons — outlined style, consistent size (18×18), use currentColor */
const IconRequestApproval = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="si-action-icon si-action-icon--request" aria-hidden focusable="false">
    <path d="M4 2h8v10H4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M5 5h6M5 7h4M5 9h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <circle className="si-action-icon__badge" cx="12" cy="11" r="3.25" stroke="currentColor" strokeWidth="1.25" fill="var(--color-bg-white, #fff)" />
    <path className="si-action-icon__check" d="M11 11l1.5 1.5 2.5-2.5" stroke="var(--color-primary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconView = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <ellipse cx="9" cy="9" rx="5" ry="3" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <circle cx="9" cy="9" r="1.25" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M2 6c2 1.5 4 1.5 6 0M12 6c2 1.5 4 1.5 6 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
)
/** Stamp-of-approval icon (rubber stamp on checkmark) — for Approve SI action */
const IconApprove = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M5 4h6l2 2v2H5V4z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
    <path d="M6 4v4M9 4v4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    <ellipse cx="10" cy="12" rx="3" ry="2" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M8.5 12l1.25 1.25 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Document with magnifying glass — for View SI document action */
const IconViewDocument = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M4 2h7v12H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
    <path d="M5 5h5M5 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <circle cx="11" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M13.5 13.5L15 15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>
)

/** Pencil icon — for Edit (Draft) action */
const IconEdit = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M3 12.75V15h2.25L13.5 6.75 11.25 4.5 3 12.75z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M10.5 5.25l2.25 2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>
)

/** Set to true to show "Create New SI" (e.g. local/mock); false when data is streamed from other apps (staging/production) */
const SHOW_CREATE_NEW = true

const PURPOSE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Loading', label: 'Loading' },
  { value: 'Unloading', label: 'Unloading' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Approved', label: 'Approved' },
]

/** Display status: Unloading = external (Received/Confirmed); Loading = internal (Draft/Submitted/Approved) */
function getDisplayStatus(n) {
  if (!n) return '—'
  if ((n.purpose || '').toLowerCase() === 'unloading') {
    if (n.status === 'Submitted') return 'Received'
    if (n.status === 'Approved') return 'Confirmed'
    return n.status || 'Received'
  }
  return n.status || 'Draft'
}

/** True if this SI uses internal approval (Loading only) */
function isInternalApprovalFlow(n) {
  return (n.purpose || '').toLowerCase() === 'loading'
}

/** View document is applicable for: Approved Loading SI, or Unloading / External SI */
function canViewAsDocument(n) {
  if (!n) return false
  const purpose = (n.purpose || '').toLowerCase()
  const status = (n.status || '').toLowerCase()
  if (purpose === 'unloading') return true
  if (purpose === 'loading' && status === 'approved') return true
  return false
}

/** Sortable table columns for new design (SI ID, Vessel/Agent, Material, Purpose, ETA, Status) */
const SI_TABLE_COLUMNS = [
  { key: 'siId', label: 'SI ID', getSortValue: (n) => (n.siId || '').toLowerCase() },
  { key: 'vessel', label: 'Vessel / Agent', getSortValue: (n) => (n.vesselName || n.vesselId || '').toLowerCase() },
  { key: 'commodity', label: 'Material', getSortValue: (n) => (n.commodity || n.product || '').toLowerCase() },
  { key: 'purpose', label: 'Purpose', getSortValue: (n) => (n.purpose || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getSortValue: (n) => (n.etaDateTime || n.etaFrom || n.ETA || '').toString() },
  { key: 'status', label: 'Status', getSortValue: (n) => (n.status || '').toLowerCase() },
]

function emptyBreakdownRow(lookups) {
  const mt = lookups?.metrics?.find((m) => m.code === 'MT') || lookups?.metrics?.[0]
  const comm = lookups?.commodities?.[0]
  return {
    commodityId: comm?.id != null ? String(comm.id) : '',
    metricId: mt?.id != null ? String(mt.id) : '',
    qty: '',
    contractNo: '',
    poNo: '',
    remarks: '',
  }
}

function nextDocId() {
  return 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

function nextSiId(list) {
  const year = new Date().getFullYear()
  const nums = list.map((n) => { const m = (n.siId || '').match(/SI-\d{4}-(\d+)/); return m ? parseInt(m[1], 10) : 0 })
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `SI-${year}-${String(next).padStart(4, '0')}`
}

export default function ShippingInstruction() {
  const navigate = useNavigate()
  const { logActivity } = useActivityLog()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingSnapshot, setEditingSnapshot] = useState(null)
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [lookupsError, setLookupsError] = useState(null)

  useEffect(() => {
    fetchSiLookups()
      .then((data) => setLookups(data))
      .catch((e) => setLookupsError(e?.message || 'Failed to load form options'))
  }, [])

  const defaultFormFromLookups = (lu) => {
    const base = {
      vesselName: '',
      referenceNumber: '',
      purposeId: '',
      tradeTermId: '',
      preferredJettyId: '',
      shipperId: '',
      loadingPortId: '',
      surveyorId: '',
      agentId: '',
      etaFrom: '',
      etaTo: '',
      breakdown: [emptyBreakdownRow(lu)],
      note: '',
      documents: [],
    }
    if (!lu) return base
    const unload = lu.purposes?.find((p) => p.code === 'Unloading') || lu.purposes?.[0]
    return {
      ...base,
      purposeId: unload?.id != null ? String(unload.id) : '',
      tradeTermId: lu.tradeTerms?.[0]?.id != null ? String(lu.tradeTerms[0].id) : '',
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setListLoading(true)
      setListError(null)
      try {
        const rows = await fetchShippingInstructions()
        if (!cancelled) setList((rows || []).map(mapSiFromApi))
      } catch (e) {
        if (!cancelled) {
          setList([])
          setListError(e?.message || 'Failed to load shipping instructions')
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({ purpose: '', status: '' })
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sortState, setSortState] = useState({ key: 'siId', dir: 'desc' })
  const [expandedId, setExpandedId] = useState(null)
  const [breakdownBySi, setBreakdownBySi] = useState({})
  const [form, setForm] = useState(() => defaultFormFromLookups(null))

  const updateForm = (updates) => setForm((f) => ({ ...f, ...updates }))

  const addBreakdownRow = () => {
    setForm((f) => ({ ...f, breakdown: [...f.breakdown, emptyBreakdownRow(lookups)] }))
  }

  const updateBreakdownRow = (index, field, value) => {
    setForm((f) => {
      const next = [...f.breakdown]
      next[index] = { ...next[index], [field]: value }
      return { ...f, breakdown: next }
    })
  }

  const removeBreakdownRow = (index) => {
    if (form.breakdown.length <= 1) return
    setForm((f) => ({ ...f, breakdown: f.breakdown.filter((_, i) => i !== index) }))
  }

  const addDocuments = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const newDocs = Array.from(files).map((file) => ({ id: nextDocId(), name: file.name }))
    setForm((f) => ({ ...f, documents: [...f.documents, ...newDocs] }))
    e.target.value = ''
  }

  const removeDocument = (id) => {
    setForm((f) => ({ ...f, documents: f.documents.filter((d) => d.id !== id) }))
  }

  const breakdownTotalsByMetric = form.breakdown.reduce((acc, row) => {
    const m = lookups?.metrics?.find((x) => String(x.id) === String(row.metricId))
    const code = m?.code || '?'
    acc[code] = (acc[code] || 0) + (Number(row.qty) || 0)
    return acc
  }, {})

  useEffect(() => {
    if (!expandedId || breakdownBySi[expandedId]) return
    let cancelled = false
    fetchShippingInstruction(expandedId)
      .then((row) => {
        if (!cancelled && row?.breakdown) {
          setBreakdownBySi((m) => ({ ...m, [expandedId]: row.breakdown }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedId, breakdownBySi])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setListError(null)
    if (!lookups) {
      setListError('Form options not loaded yet')
      return
    }
    const pid = parseInt(form.purposeId, 10)
    if (Number.isNaN(pid)) {
      setListError('Select purpose')
      return
    }
    const breakdownPayload = form.breakdown.map((row) => ({
      commodityId: parseInt(row.commodityId, 10),
      metricId: parseInt(row.metricId, 10),
      qty: Number(row.qty) || 0,
      contractNo: row.contractNo?.trim() || null,
      poNo: row.poNo?.trim() || null,
      remarks: row.remarks?.trim() || null,
    }))
    for (let i = 0; i < breakdownPayload.length; i += 1) {
      const r = breakdownPayload[i]
      if (Number.isNaN(r.commodityId) || Number.isNaN(r.metricId) || r.qty < 0) {
        setListError(`Breakdown row ${i + 1}: select commodity & metric, qty ≥ 0`)
        return
      }
    }
    try {
      const etaIso = form.etaFrom ? new Date(`${form.etaFrom}T12:00:00`).toISOString() : null
      const num = (v) => {
        const n = parseInt(v, 10)
        return v !== '' && !Number.isNaN(n) ? n : null
      }
      const payload = {
        vesselName: form.vesselName.trim(),
        purposeId: pid,
        tradeTermId: num(form.tradeTermId),
        preferredJettyId: num(form.preferredJettyId),
        shipperId: num(form.shipperId),
        loadingPortId: num(form.loadingPortId),
        surveyorId: num(form.surveyorId),
        agentId: num(form.agentId),
        referenceNumber: form.referenceNumber?.trim() || null,
        eta: etaIso,
        etaFrom: form.etaFrom || null,
        etaTo: form.etaTo || null,
        status: 'Draft',
        breakdown: breakdownPayload,
        note: form.note?.trim() || null,
      }

      const saved = editingId
        ? await updateShippingInstruction(editingId, payload)
        : await createShippingInstruction(payload)

      setList((prev) => {
        const next = prev.filter((x) => x.id !== saved.id)
        return [mapSiFromApi(saved), ...next]
      })
      const toLabel = (id, list, fallback) => {
        if (!id) return '—'
        const m = (list || []).find((x) => String(x.id) === String(id))
        return m ? (m.label || m.name || m.code || m.label || m.id) : fallback || String(id)
      }
      const summarizeBreakdown = (rows) => {
        const r = Array.isArray(rows) ? rows : []
        if (r.length === 0) return '—'
        const parts = r.map((x) => `${x.qty || 0} ${toLabel(x.metricId, lookups?.metrics, '?')} · ${toLabel(x.commodityId, lookups?.commodities, '?')}`)
        return `${r.length} line(s): ${parts.join(' | ')}`
      }
      const changes = []
      if (editingId && editingSnapshot) {
        const before = editingSnapshot
        const after = {
          vesselName: payload.vesselName,
          referenceNumber: payload.referenceNumber || '',
          purposeId: String(payload.purposeId || ''),
          tradeTermId: String(payload.tradeTermId || ''),
          preferredJettyId: String(payload.preferredJettyId || ''),
          shipperId: String(payload.shipperId || ''),
          loadingPortId: String(payload.loadingPortId || ''),
          surveyorId: String(payload.surveyorId || ''),
          agentId: String(payload.agentId || ''),
          etaFrom: payload.etaFrom || '',
          etaTo: payload.etaTo || '',
          note: payload.note || '',
          breakdown: (form.breakdown || []).map((x) => ({ ...x })), // current UI rows
        }
        const addChange = (field, from, to) => {
          if ((from ?? '') === (to ?? '')) return
          changes.push({ field, from, to })
        }
        addChange('Vessel', before.vesselName, after.vesselName)
        addChange('Reference', before.referenceNumber, after.referenceNumber)
        addChange('Purpose', toLabel(before.purposeId, lookups?.purposes), toLabel(after.purposeId, lookups?.purposes))
        addChange('Term', toLabel(before.tradeTermId, lookups?.tradeTerms), toLabel(after.tradeTermId, lookups?.tradeTerms))
        addChange('Preferred jetty', toLabel(before.preferredJettyId, lookups?.jetties), toLabel(after.preferredJettyId, lookups?.jetties))
        addChange('Shipper', toLabel(before.shipperId, lookups?.shippers), toLabel(after.shipperId, lookups?.shippers))
        addChange('Loading port', toLabel(before.loadingPortId, lookups?.loadingPorts), toLabel(after.loadingPortId, lookups?.loadingPorts))
        addChange('Surveyor', toLabel(before.surveyorId, lookups?.surveyors), toLabel(after.surveyorId, lookups?.surveyors))
        addChange('Agent', toLabel(before.agentId, lookups?.agents), toLabel(after.agentId, lookups?.agents))
        addChange('ETA From', before.etaFrom, after.etaFrom)
        addChange('ETA To', before.etaTo, after.etaTo)
        addChange('Note', before.note, after.note)
        addChange('Breakdown', summarizeBreakdown(before.breakdown), summarizeBreakdown(after.breakdown))
      }

      logActivity({
        pageKey: 'shipping-instruction',
        action: editingId ? 'update' : 'add',
        entityType: 'Shipping Instruction',
        entityLabel: saved.referenceNumber || `SI-${saved.id}`,
        details: editingId
          ? { summary: 'Updated Draft SI', changes: changes.length ? changes : [{ field: 'No changes', from: '—', to: '—' }] }
          : { summary: 'Created Draft SI', changes: [{ field: 'Vessel', from: '—', to: payload.vesselName }, { field: 'Breakdown', from: '—', to: summarizeBreakdown(form.breakdown) }] },
      })
      setForm(defaultFormFromLookups(lookups))
      setIsFormOpen(false)
      setEditingId(null)
      setEditingSnapshot(null)
    } catch (err) {
      setListError(err?.message || (editingId ? 'Update failed' : 'Create failed'))
    }
  }

  const openCreateModal = () => {
    setForm(defaultFormFromLookups(lookups))
    setEditingId(null)
    setIsFormOpen(true)
  }

  const openEditModal = async (id) => {
    if (!lookups) {
      setListError('Form options not loaded yet')
      return
    }
    setListError(null)
    try {
      const row = await fetchShippingInstruction(id)
      const bd =
        Array.isArray(row?.breakdown) && row.breakdown.length
          ? row.breakdown.map((b) => ({
              commodityId: b.commodityId != null ? String(b.commodityId) : '',
              metricId: b.metricId != null ? String(b.metricId) : '',
              qty: b.qty != null ? String(b.qty) : '',
              contractNo: b.contractNo ?? '',
              poNo: b.poNo ?? '',
              remarks: b.remarks ?? '',
            }))
          : [emptyBreakdownRow(lookups)]

      setForm({
        vesselName: row.vesselName ?? '',
        referenceNumber: row.referenceNumber ?? '',
        purposeId: row.purposeId != null ? String(row.purposeId) : '',
        tradeTermId: row.tradeTermId != null ? String(row.tradeTermId) : '',
        preferredJettyId: row.preferredJettyId != null ? String(row.preferredJettyId) : '',
        shipperId: row.shipperId != null ? String(row.shipperId) : '',
        loadingPortId: row.loadingPortId != null ? String(row.loadingPortId) : '',
        surveyorId: row.surveyorId != null ? String(row.surveyorId) : '',
        agentId: row.agentId != null ? String(row.agentId) : '',
        etaFrom: row.eta ? String(row.eta).slice(0, 10) : '',
        etaTo: row.eta ? String(row.eta).slice(0, 10) : '',
        breakdown: bd,
        note: row.note ?? '',
        documents: [],
      })
      setEditingId(id)
      setEditingSnapshot({
        vesselName: row.vesselName ?? '',
        referenceNumber: row.referenceNumber ?? '',
        purposeId: row.purposeId != null ? String(row.purposeId) : '',
        tradeTermId: row.tradeTermId != null ? String(row.tradeTermId) : '',
        preferredJettyId: row.preferredJettyId != null ? String(row.preferredJettyId) : '',
        shipperId: row.shipperId != null ? String(row.shipperId) : '',
        loadingPortId: row.loadingPortId != null ? String(row.loadingPortId) : '',
        surveyorId: row.surveyorId != null ? String(row.surveyorId) : '',
        agentId: row.agentId != null ? String(row.agentId) : '',
        etaFrom: row.etaFrom ?? (row.eta ? String(row.eta).slice(0, 10) : ''),
        etaTo: row.etaTo ?? (row.eta ? String(row.eta).slice(0, 10) : ''),
        breakdown: bd,
        note: row.note ?? '',
      })
      setIsFormOpen(true)
    } catch (e) {
      setListError(e?.message || 'Failed to load shipping instruction')
    }
  }

  const handleCloseModal = () => {
    setIsFormOpen(false)
    setEditingId(null)
    setEditingSnapshot(null)
  }

  useEffect(() => {
    if (!isFormOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleCloseModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFormOpen])

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredList = list.filter((n) => {
    const q = searchQuery.trim().toLowerCase()
    const matchSearch = !q ||
      (n.siId || '').toLowerCase().includes(q) ||
      (n.vesselName || n.vesselId || '').toLowerCase().includes(q) ||
      (n.agent || '').toLowerCase().includes(q)
    const purposeMatch = !filters.purpose || (n.purpose || '') === filters.purpose.trim()
    const statusMatch = !filters.status || (n.status || '') === filters.status.trim()
    return matchSearch && purposeMatch && statusMatch
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = SI_TABLE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const totalSI = list.length
  const pendingApproval = list.filter((n) => isInternalApprovalFlow(n) && n.status === 'Submitted').length
  const now = Date.now()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  const upcomingArrivals = list.filter((n) => {
    const eta = n.etaDateTime || n.etaFrom
    if (!eta) return false
    const t = new Date(eta).getTime()
    return t >= now && t <= now + oneWeek
  }).length
  const approvedThisWeek = list.filter((n) => {
    if (n.status !== 'Approved' || !n.receivedAt) return false
    const t = new Date(n.receivedAt).getTime()
    return t >= now - oneWeek
  }).length

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedList.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(sortedList.map((n) => n.id)))
  }

  const handleRequestApproval = (n, e) => {
    e.stopPropagation()
    setList((prev) => prev.map((r) => (r.id === n.id ? { ...r, status: 'Submitted' } : r)))
    logActivity({
      pageKey: 'shipping-instruction',
      action: 'update',
      entityType: 'Shipping Instruction',
      entityLabel: n.siId || `SI-${n.id}`,
      details: 'Requested approval (UI status change)',
    })
  }

  const handleExport = () => {
    const headers = ['SI ID', 'Vessel', 'Agent', 'Material', 'Purpose', 'ETA', 'Status']
    const rows = sortedList.map((n) => [
      n.siId || '',
      n.vesselName || n.vesselId || '',
      n.agent || '',
      n.commodity || n.product || '',
      n.purpose || '',
      formatEta(n),
      n.status || '',
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shipping-instructions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="shipping-instruction-page">
      <header className="si-page-header">
        <div className="si-page-header__text">
          <h1 className="page-title">Shipping Instructions</h1>
          <p className="si-page-header__subtitle">
            Manage and monitor all submitted vessel shipping instructions for jetty operations.
          </p>
        </div>
        {SHOW_CREATE_NEW && (
          <button
            type="button"
            className="btn btn--primary si-page-header__cta"
            onClick={openCreateModal}
            aria-expanded={isFormOpen}
          >
            + Create New SI
          </button>
        )}
      </header>
      {listError && (
        <p className="si-page-header__subtitle" style={{ color: '#c00' }} role="alert">{listError}</p>
      )}
      {listLoading && <p className="text-steel" style={{ padding: '0 1rem' }}>Loading shipping instructions…</p>}

      <div className="si-summary-cards">
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🚢</span>
          <span className="si-summary-card__value">{totalSI.toLocaleString()}</span>
          <span className="si-summary-card__label">TOTAL SI</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{pendingApproval}</span>
          <span className="si-summary-card__label">PENDING APPROVAL</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{upcomingArrivals}</span>
          <span className="si-summary-card__label">UPCOMING ARRIVALS</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon si-summary-card__icon--check" aria-hidden>✓</span>
          <span className="si-summary-card__value">{approvedThisWeek}</span>
          <span className="si-summary-card__label">APPROVED THIS WEEK</span>
        </div>
      </div>

      <div className="si-toolbar">
        <input
          type="search"
          className="si-toolbar__search"
          placeholder="Search by SI ID, Vessel, or Agent..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search shipping instructions"
        />
        <div className="si-toolbar__actions">
          <button
            type="button"
            className={`btn btn--secondary si-toolbar__btn ${filtersPanelOpen ? 'si-toolbar__btn--active' : ''}`}
            onClick={() => setFiltersPanelOpen((o) => !o)}
            aria-expanded={filtersPanelOpen}
          >
            🔽 Filters
          </button>
          <button type="button" className="btn btn--secondary si-toolbar__btn" onClick={handleExport}>
            ⬇ Export
          </button>
        </div>
      </div>

      {filtersPanelOpen && (
        <div className="si-filters-panel">
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">Purpose</label>
            <select
              className="si-filters-panel__select"
              value={filters.purpose}
              onChange={(e) => updateFilter('purpose', e.target.value)}
            >
              {PURPOSE_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">Status</label>
            <select
              className="si-filters-panel__select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="modal-overlay" onClick={handleCloseModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="si-modal-title"
            aria-modal="true"
          >
            <h2 id="si-modal-title" className="modal__title">
              {editingId ? `Edit Shipping Instruction (Draft) — #${editingId}` : 'Create Vessel Trip / New Shipping Instruction'}
            </h2>
            {lookupsError && <p className="text-steel" style={{ color: '#c00' }}>{lookupsError}</p>}
            {!lookups && !lookupsError && <p className="text-steel">Loading options from API…</p>}
            <form onSubmit={handleSubmit} className="shipping-instruction-form">
              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Vessel & trip</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group">
                    <label htmlFor="vesselName">Vessel Name / Barge ID *</label>
                    <input
                      id="vesselName"
                      value={form.vesselName}
                      onChange={(e) => updateForm({ vesselName: e.target.value })}
                      required
                      placeholder="e.g. TB. ARIA CITRA IV / BG. MULIA VII"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="siRef">Reference number (optional)</label>
                    <input
                      id="siRef"
                      value={form.referenceNumber}
                      onChange={(e) => updateForm({ referenceNumber: e.target.value })}
                      placeholder="e.g. SI/EUP/2026/1/003"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="etaFrom">ETA from *</label>
                    <input id="etaFrom" type="date" value={form.etaFrom} onChange={(e) => updateForm({ etaFrom: e.target.value })} required disabled={!lookups} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="etaTo">ETA to *</label>
                    <input id="etaTo" type="date" value={form.etaTo} onChange={(e) => updateForm({ etaTo: e.target.value })} required disabled={!lookups} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="term">Term</label>
                    <select id="term" value={form.tradeTermId} onChange={(e) => updateForm({ tradeTermId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.tradeTerms || []).map((t) => (
                        <option key={t.id} value={t.id}>{t.code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="purpose">Purpose *</label>
                    <select id="purpose" value={form.purposeId} onChange={(e) => updateForm({ purposeId: e.target.value })} required disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.purposes || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="jetty">Preferred jetty</label>
                    <select id="jetty" value={form.preferredJettyId} onChange={(e) => updateForm({ preferredJettyId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.jetties || []).map((j) => (
                        <option key={j.id} value={j.id}>{j.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    {/* intentionally removed: total qty now comes from breakdown sum if needed */}
                  </div>
                </div>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Party & port</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group">
                    <label htmlFor="shipper">Shipper</label>
                    <select id="shipper" value={form.shipperId} onChange={(e) => updateForm({ shipperId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.shippers || []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="loadingPort">Loading port</label>
                    <select id="loadingPort" value={form.loadingPortId} onChange={(e) => updateForm({ loadingPortId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.loadingPorts || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="surveyor">Surveyor</label>
                    <select id="surveyor" value={form.surveyorId} onChange={(e) => updateForm({ surveyorId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.surveyors || []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="agent">Agent</label>
                    <select id="agent" value={form.agentId} onChange={(e) => updateForm({ agentId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.agents || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Shipment breakdown (Kontrak / PO) — commodity per contract</h3>
                <p className="text-steel" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  Each row is one contract line: its own commodity, qty, and unit (KL / MT).
                </p>
                <div className="table-wrap">
                  <table className="data-table shipping-instruction-breakdown-table">
                    <thead>
                      <tr>
                        <th>Commodity *</th>
                        <th>Qty *</th>
                        <th>Unit *</th>
                        <th>Contract No</th>
                        <th>PO No</th>
                        <th>Remarks</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.breakdown.map((row, i) => (
                        <tr key={i}>
                          <td>
                            <select
                              value={row.commodityId}
                              onChange={(e) => updateBreakdownRow(i, 'commodityId', e.target.value)}
                              required
                              className="shipping-instruction-inline-input"
                              disabled={!lookups}
                            >
                              <option value="">—</option>
                              {(lookups?.commodities || []).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.qty}
                              onChange={(e) => updateBreakdownRow(i, 'qty', e.target.value)}
                              placeholder="0"
                              className="shipping-instruction-inline-input shipping-instruction-inline-input--num"
                            />
                          </td>
                          <td>
                            <select
                              value={row.metricId}
                              onChange={(e) => updateBreakdownRow(i, 'metricId', e.target.value)}
                              disabled={!lookups}
                              className="shipping-instruction-inline-input"
                            >
                              <option value="">—</option>
                              {(lookups?.metrics || []).map((m) => (
                                <option key={m.id} value={m.id}>{m.code} ({m.label})</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={row.contractNo}
                              onChange={(e) => updateBreakdownRow(i, 'contractNo', e.target.value)}
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <input
                              value={row.poNo}
                              onChange={(e) => updateBreakdownRow(i, 'poNo', e.target.value)}
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <input
                              value={row.remarks}
                              onChange={(e) => updateBreakdownRow(i, 'remarks', e.target.value)}
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--secondary shipping-instruction-btn-remove"
                              onClick={() => removeBreakdownRow(i)}
                              disabled={form.breakdown.length <= 1}
                              aria-label="Remove row"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="shipping-instruction-total-label">Totals by unit</td>
                        <td colSpan={5} className="shipping-instruction-total-value">
                          {Object.keys(breakdownTotalsByMetric).length === 0
                            ? '—'
                            : Object.entries(breakdownTotalsByMetric)
                                .map(([code, sum]) => `${sum.toLocaleString()} ${code}`)
                                .join(' · ')}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <button type="button" className="btn btn--secondary" onClick={addBreakdownRow}>
                  + Add row
                </button>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Document upload</h3>
                <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-small)' }}>
                  Add multiple documents. Only file names are stored (no file content).
                </p>
                <input
                  type="file"
                  multiple
                  onChange={addDocuments}
                  style={{ display: 'block', marginBottom: 'var(--spacing-2)' }}
                  aria-label="Add documents"
                />
                {form.documents.length > 0 ? (
                  <ul className="shipping-instruction-docs">
                    {form.documents.map((d) => (
                      <li key={d.id} className="shipping-instruction-docs__item">
                        <span className="shipping-instruction-docs__name">{d.name}</span>
                        <button type="button" className="btn btn--secondary btn--small" onClick={() => removeDocument(d.id)} aria-label={`Remove ${d.name}`}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>No documents added.</p>
                )}
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Note</h3>
                <div className="input-group">
                  <label htmlFor="siNote">Anything important for this SI (quality, handling, remarks, etc.)</label>
                  <textarea
                    id="siNote"
                    className="shipping-instruction-inline-input"
                    style={{ minHeight: 96, resize: 'vertical' }}
                    value={form.note}
                    onChange={(e) => updateForm({ note: e.target.value })}
                    placeholder="Write any notes here…"
                    disabled={!lookups}
                  />
                </div>
              </div>

              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Shipping instructions</h2>
        <div className="table-wrap">
          <table className="data-table shipping-instruction-table">
            <thead>
              <tr>
                <th className="si-table__col-checkbox">
                  <input
                    type="checkbox"
                    checked={sortedList.length > 0 && selectedIds.size === sortedList.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                {SI_TABLE_COLUMNS.map((col) => (
                  <th key={col.key} className="shipping-instruction-table__th">
                    <button
                      type="button"
                      className="shipping-instruction-table__sort"
                      onClick={() => handleSort(col.key)}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <span className="shipping-instruction-table__sort-icon">
                        {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="si-table__col-actions">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {sortedList.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={`shipping-instruction-table__row ${expandedId === n.id ? 'shipping-instruction-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === n.id ? null : n.id))}
                  >
                    <td className="si-table__col-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(n.id)}
                        onChange={() => toggleSelect(n.id)}
                        aria-label={`Select ${n.siId || n.id}`}
                      />
                    </td>
                    <td>{n.siId || '—'}</td>
                    <td>
                      <div className="si-table__vessel-agent">
                        <strong>{n.vesselName || n.vesselId || '—'}</strong>
                        <span className="si-table__agent">{n.agent || '—'}</span>
                      </div>
                    </td>
                    <td>{n.commodity || n.product || '—'}</td>
                    <td>{n.purpose || '—'}</td>
                    <td>{formatEta(n)}</td>
                    <td>
                      <span className={`si-status-badge si-status-badge--${(getDisplayStatus(n) || 'draft').toLowerCase().replace(/\s+/g, '-')}`}>
                        {getDisplayStatus(n)}
                      </span>
                      {(n.purpose || '').toLowerCase() === 'unloading' && (
                        <span className="si-status-badge si-status-badge--external" title="Instruction from external">
                          External
                        </span>
                      )}
                    </td>
                    <td className="si-table__col-actions" onClick={(e) => e.stopPropagation()}>
                      {n.status === 'Draft' && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditModal(n.id)
                          }}
                          title="Edit (Draft only)"
                          aria-label="Edit (Draft only)"
                        >
                          <IconEdit />
                        </button>
                      )}
                      {isInternalApprovalFlow(n) && n.status === 'Draft' && (
                        <button
                          type="button"
                          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
                          onClick={(e) => handleRequestApproval(n, e)}
                          title="Request Approval"
                          aria-label="Request Approval"
                        >
                          <IconRequestApproval />
                        </button>
                      )}
                      {isInternalApprovalFlow(n) && n.status === 'Submitted' && (n.siId || n.id) && (
                        <button
                          type="button"
                          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
                          onClick={(e) => { e.stopPropagation(); navigate(`/shipping-instruction/approval/${n.id}`, { state: { si: n } }) }}
                          title="Approve SI"
                          aria-label="Approve SI"
                        >
                          <IconApprove />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
                        onClick={(e) => { e.stopPropagation(); setExpandedId((id) => (id === n.id ? null : n.id)) }}
                        title="View details"
                        aria-label="View details"
                      >
                        <IconView />
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--view-si"
                        disabled={!canViewAsDocument(n)}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canViewAsDocument(n) && (n.siId || n.id)) {
                            navigate(`/shipping-instruction/view/${n.id}`, { state: { si: n } })
                          }
                        }}
                        title={canViewAsDocument(n) ? 'View SI document' : 'View SI available after approval'}
                        aria-label={canViewAsDocument(n) ? 'View SI document' : 'View SI available after approval'}
                      >
                        <IconViewDocument />
                      </button>
                    </td>
                  </tr>
                  {expandedId === n.id && (
                    <tr key={n.id + '-detail'} className="shipping-instruction-table__detail-row">
                      <td colSpan={SI_TABLE_COLUMNS.length + 2} className="shipping-instruction-table__detail-cell">
                        <div className="shipping-instruction-detail">
                          <h4 className="shipping-instruction-detail__title">Full details</h4>
                          <dl className="shipping-instruction-detail__grid">
                            <dt>SI ID</dt><dd>{n.siId || '—'}</dd>
                            <dt>Status</dt><dd>{getDisplayStatus(n)}</dd>
                            {(n.purpose || '').toLowerCase() === 'unloading' && (
                              <><dt>Source</dt><dd>External</dd></>
                            )}
                            <dt>Vessel</dt><dd>{n.vesselName || n.vesselId || '—'}</dd>
                            <dt>Purpose</dt><dd>{n.purpose || '—'}</dd>
                            <dt>Jetty</dt><dd>{n.jetty || '—'}</dd>
                            <dt>ETA From</dt><dd>{n.etaFrom || (n.etaDateTime ? String(n.etaDateTime).slice(0, 10) : '—')}</dd>
                            <dt>ETA To</dt><dd>{n.etaTo || (n.etaDateTime ? String(n.etaDateTime).slice(0, 10) : '—')}</dd>
                            <dt>Term</dt><dd>{n.term || '—'}</dd>
                            <dt>Shipper</dt><dd>{n.shipper || '—'}</dd>
                            <dt>Loading port</dt><dd>{n.loadingPort || '—'}</dd>
                            <dt>Surveyor</dt><dd>{n.surveyor || '—'}</dd>
                            <dt>Agent</dt><dd>{n.agent || '—'}</dd>
                            <dt>Note</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.note || '—'}</dd>
                            <dt>Received</dt><dd>{formatDate(n.receivedAt)}</dd>
                          </dl>
                          <h5 className="shipping-instruction-detail__title" style={{ marginTop: '1rem' }}>Contract / PO breakdown</h5>
                          {!breakdownBySi[n.id] && <p className="text-steel">Loading…</p>}
                          {breakdownBySi[n.id]?.length > 0 && (
                            <div className="table-wrap">
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>Commodity</th>
                                    <th>Qty</th>
                                    <th>Unit</th>
                                    <th>Contract</th>
                                    <th>PO</th>
                                    <th>Remarks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {breakdownBySi[n.id].map((b) => (
                                    <tr key={b.id}>
                                      <td>{b.commodityName}</td>
                                      <td>{Number(b.qty).toLocaleString()}</td>
                                      <td>{b.metricCode}</td>
                                      <td>{b.contractNo || '—'}</td>
                                      <td>{b.poNo || '—'}</td>
                                      <td>{b.remarks || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {n.documents && n.documents.length > 0 && (
                            <div className="shipping-instruction-detail__docs">
                              <h4 className="shipping-instruction-detail__subtitle">Documents</h4>
                              <ul className="shipping-instruction-detail__docs-list">
                                {n.documents.map((d) => (
                                  <li key={d.id}>{d.name}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {n.breakdown && n.breakdown.length > 0 && (
                            <>
                              <h4 className="shipping-instruction-detail__subtitle">Shipment breakdown</h4>
                              <table className="data-table shipping-instruction-detail__table">
                                <thead>
                                  <tr>
                                    <th>Shipper</th>
                                    <th>Contract No</th>
                                    <th>PO No</th>
                                    <th>Qty (kg)</th>
                                    <th>Remarks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {n.breakdown.map((row, i) => (
                                    <tr key={i}>
                                      <td>{row.shipper || '—'}</td>
                                      <td>{row.contractNo || '—'}</td>
                                      <td>{row.poNo || '—'}</td>
                                      <td>{row.qtyKg != null ? row.qtyKg.toLocaleString() : '—'}</td>
                                      <td>{row.remarks || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
