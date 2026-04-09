import { useState, Fragment, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchShippingInstructions,
  fetchShippingInstruction,
  createShippingInstruction,
  updateShippingInstruction,
  deleteShippingInstruction,
  fetchSiNpwpMaster,
} from '../api/shippingInstructions'
import { fetchSiLookups } from '../api/siLookups'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import PurposeBadge from '../components/PurposeBadge'
import { formatSiCalendarDateOnly } from '../utils/siFormPlaceDate'

/** `YYYY-MM-DD` for `<input type="date" />` — API may return full ISO timestamps (e.g. from Postgres DATE via JSON). */
function toDateInputValue(v) {
  if (v == null || v === '') return ''
  return String(v).slice(0, 10)
}

function mapSiFromApi(row) {
  return {
    id: row.id,
    siId: row.referenceNumber || `SI-${row.id}`,
    referenceNumber: row.referenceNumber ?? null,
    vesselName: row.vesselName,
    voyageNo: row.voyageNo ?? null,
    vesselId: `v-${row.id}`,
    purpose: row.purpose,
    purposeId: row.purposeId ?? null,
    status: row.status,
    commodity: row.commodity,
    etaDateTime: row.eta,
    etaFrom: toDateInputValue(row.etaFrom) || toDateInputValue(row.eta),
    etaTo: toDateInputValue(row.etaTo) || toDateInputValue(row.eta),
    shipper: row.shipperName ?? '—',
    loadingPort: row.loadingPortName ?? '—',
    agent: row.agentName ?? '—',
    surveyor: row.surveyorName ?? '—',
    destinationText: row.destinationText ?? null,
    freightTerms: row.freightTerms ?? null,
    billOfLadingClause: row.billOfLadingClause ?? null,
    blSplitText: row.blSplitText ?? null,
    consigneeText: row.consigneeText ?? null,
    notifyPartyText: row.notifyPartyText ?? null,
    blIndicated: row.blIndicated ?? null,
    documentDate: row.documentDate ?? null,
    tradeTermId: row.tradeTermId ?? null,
    approvalId: row.approvalId ?? null,
    approvedAt: row.approvedAt ?? null,
    approverNameSnapshot: row.approverNameSnapshot ?? null,
    approverTitleSnapshot: row.approverTitleSnapshot ?? null,
    approverDisplayName: row.approverDisplayName ?? null,
    breakdown: [],
    totalQtyKg: 0,
    receivedAt: row.createdAt,
    term: row.tradeTermCode ?? '—',
    jetty: row.preferredJettyName ?? null,
    note: row.note ?? null,
    documents: [],
    resolvedPortId: row.resolvedPortId ?? null,
  }
}
import '../styles/shipping-instruction.css'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** YYYY-MM-DD from row documentDate for range compare */
function siDocumentYmd(n) {
  if (n?.documentDate == null || n.documentDate === '') return ''
  const s = String(n.documentDate).trim()
  return s.length >= 10 ? s.slice(0, 10) : ''
}

/** Inclusive document date range on calendar day; empty from/to = open bound; rows with no date fail if either bound set. */
function matchesDocumentDateRange(n, from, to) {
  let fromS = (from || '').trim()
  let toS = (to || '').trim()
  if (fromS && toS && fromS > toS) {
    const swap = fromS
    fromS = toS
    toS = swap
  }
  if (!fromS && !toS) return true
  const ymd = siDocumentYmd(n)
  if (!ymd) return false
  if (fromS && ymd < fromS) return false
  if (toS && ymd > toS) return false
  return true
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

/** Trash icon — delete Draft / Submitted SI */
const IconDelete = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M4 5.5h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M6.5 5.5V4.25A1.25 1.25 0 017.75 3h2.5A1.25 1.25 0 0111.5 4.25V5.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M6 5.5l.65 9.1a1 1 0 001 0.9h3.7a1 1 0 001-.9L12 5.5" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M7.5 8.5v5M10.5 8.5v5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
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

/** Default panel filters: Purpose/Status = All, document range cleared */
const INITIAL_PANEL_FILTERS = {
  purpose: '',
  status: '',
  documentDateFrom: '',
  documentDateTo: '',
}

const FREIGHT_TERM_OPTIONS = [
  { value: '', label: '—' },
  { value: 'PREPAID', label: 'PREPAID' },
  { value: 'COLLECT', label: 'COLLECT' },
  { value: 'AS_PER_CHARTER_PARTY', label: 'AS PER CHARTER PARTY' },
  { value: 'OTHER', label: 'OTHER' },
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

/** Loading and Unloading both use submit → approval sign-off → Approved (same API flow). */
function usesShippingInstructionApprovalFlow(n) {
  const p = (n.purpose || '').toLowerCase()
  return p === 'loading' || p === 'unloading'
}

/** Formal SI document view after sign-off (Approved in DB; Unloading list label: Confirmed). */
function canViewAsDocument(n) {
  if (!n) return false
  return (n.status || '').toLowerCase() === 'approved'
}

function siEditDisabledReason(n) {
  if (n.status === 'Draft') return null
  return 'Disabled: only Draft instructions can be edited.'
}

function siSubmitDisabledReason(n) {
  if (usesShippingInstructionApprovalFlow(n) && n.status === 'Draft') return null
  if (!usesShippingInstructionApprovalFlow(n)) {
    return 'Disabled: submit for approval applies to Loading and Unloading instructions only.'
  }
  return 'Disabled: submit is only available while status is Draft.'
}

function siApproveDisabledReason(n, canApproveSi) {
  if (
    usesShippingInstructionApprovalFlow(n) &&
    n.status === 'Submitted' &&
    Boolean(n.siId || n.id) &&
    canApproveSi
  ) {
    return null
  }
  if (!usesShippingInstructionApprovalFlow(n)) {
    return 'Disabled: approval applies to Loading and Unloading instructions only.'
  }
  if (!canApproveSi) return 'Disabled: your role cannot approve shipping instructions.'
  if (!(n.siId || n.id)) return 'Disabled: instruction has no reference yet.'
  if (n.status !== 'Submitted') {
    return 'Disabled: open approval only after the instruction is submitted for review (Received / Submitted).'
  }
  return 'Disabled: cannot open approval for this instruction.'
}

function siViewDocDisabledReason(n) {
  if (canViewAsDocument(n)) return null
  return 'Disabled: open the SI document after the instruction is approved (sign-off complete).'
}

function siDeleteDisabledReason(n, canDeleteSi) {
  if (!canDeleteSi) return 'Disabled: your role cannot delete shipping instructions.'
  const s = n.status || ''
  if (s === 'Approved') return 'Disabled: approved instructions cannot be deleted.'
  if (s !== 'Draft' && s !== 'Submitted') {
    return 'Disabled: only Draft or Submitted instructions can be deleted.'
  }
  return null
}

/** Sortable columns + cell render for main SI table */
const SI_TABLE_COLUMNS = [
  {
    key: 'documentDate',
    label: 'Document date',
    getSortValue: (n) => (n.documentDate ? String(n.documentDate).slice(0, 10) : ''),
    getFilterValue: (n) => (n.documentDate ? formatSiCalendarDateOnly(n.documentDate) : ''),
    getCell: (n) => formatSiCalendarDateOnly(n.documentDate),
  },
  {
    key: 'siNo',
    label: 'SI No',
    getSortValue: (n) => (n.siId || '').toLowerCase(),
    getFilterValue: (n) => n.siId || '',
    getCell: (n) => n.siId || '—',
  },
  {
    key: 'vessel',
    label: 'Vessel',
    getSortValue: (n) => (n.vesselName || n.vesselId || '').toLowerCase(),
    getFilterValue: (n) => n.vesselName || n.vesselId || '',
    getCell: (n) => n.vesselName || n.vesselId || '—',
  },
  {
    key: 'agent',
    label: 'Agent',
    getSortValue: (n) => ((n.agent && n.agent !== '—' ? n.agent : '') || '').toLowerCase(),
    getFilterValue: (n) => (n.agent && n.agent !== '—' ? n.agent : ''),
    getCell: (n) => (n.agent && n.agent !== '—' ? n.agent : '—'),
  },
  {
    key: 'commodity',
    label: 'Material',
    getSortValue: (n) => (n.commodity || n.product || '').toLowerCase(),
    getFilterValue: (n) => n.commodity || n.product || '',
    getCell: (n) => n.commodity || n.product || '—',
  },
  {
    key: 'shipper',
    label: 'Shipper',
    getSortValue: (n) => ((n.shipper && n.shipper !== '—' ? n.shipper : '') || '').toLowerCase(),
    getFilterValue: (n) => (n.shipper && n.shipper !== '—' ? n.shipper : ''),
    getCell: (n) => (n.shipper && n.shipper !== '—' ? n.shipper : '—'),
  },
  {
    key: 'surveyor',
    label: 'Surveyor',
    getSortValue: (n) => ((n.surveyor && n.surveyor !== '—' ? n.surveyor : '') || '').toLowerCase(),
    getFilterValue: (n) => (n.surveyor && n.surveyor !== '—' ? n.surveyor : ''),
    getCell: (n) => (n.surveyor && n.surveyor !== '—' ? n.surveyor : '—'),
  },
  {
    key: 'purpose',
    label: 'Purpose',
    getSortValue: (n) => (n.purpose || '').toLowerCase(),
    getFilterValue: (n) => n.purpose || '',
    getCell: (n) => <PurposeBadge purpose={n.purpose} />,
  },
  {
    key: 'eta',
    label: 'ETA',
    getSortValue: (n) => (n.etaDateTime || n.etaFrom || n.ETA || '').toString(),
    getFilterValue: (n) => formatEta(n),
    getCell: (n) => formatEta(n),
  },
  {
    key: 'status',
    label: 'Status',
    getSortValue: (n) => (getDisplayStatus(n) || '').toLowerCase(),
    getFilterValue: (n) => getDisplayStatus(n) || '',
    getCell: (n) => (
      <Fragment>
        <span className={`si-status-badge si-status-badge--${(getDisplayStatus(n) || 'draft').toLowerCase().replace(/\s+/g, '-')}`}>
          {getDisplayStatus(n)}
        </span>
        {(n.purpose || '').toLowerCase() === 'unloading' && (
          <span className="si-status-badge si-status-badge--external" title="Instruction from external">
            External
          </span>
        )}
      </Fragment>
    ),
  },
  {
    key: 'approver',
    label: 'Approver',
    getSortValue: (n) => ((n.approverNameSnapshot || n.approverDisplayName || '') || '').toLowerCase(),
    getFilterValue: (n) => n.approverNameSnapshot || n.approverDisplayName || '',
    getCell: (n) => n.approverNameSnapshot || n.approverDisplayName || '—',
  },
  {
    key: 'approvalDate',
    label: 'Approval date',
    getSortValue: (n) => (n.approvedAt ? new Date(n.approvedAt).getTime() : 0),
    getFilterValue: (n) => (n.approvedAt ? formatDate(n.approvedAt) : ''),
    getCell: (n) => (n.approvedAt ? formatDate(n.approvedAt) : '—'),
  },
]

/** Actions column: Edit | Submit | Approve | View SI | Delete — same button sizing; disabled + tooltip when not applicable. */
function SiRowActions({ row: n, canApproveSi, canDeleteSi, onEdit, onRequestApproval, onOpenApprove, onViewDocument, onDelete }) {
  const editReason = siEditDisabledReason(n)
  const submitReason = siSubmitDisabledReason(n)
  const approveReason = siApproveDisabledReason(n, canApproveSi)
  const viewReason = siViewDocDisabledReason(n)
  const deleteReason = siDeleteDisabledReason(n, canDeleteSi)

  return (
    <div className="si-table__action-slots">
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(editReason)}
          title={editReason || 'Edit this draft instruction'}
          aria-label={editReason || 'Edit this draft instruction'}
          onClick={onEdit}
        >
          <IconEdit />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(submitReason)}
          title={submitReason || 'Submit for approval'}
          aria-label={submitReason || 'Submit for approval'}
          onClick={onRequestApproval}
        >
          <IconRequestApproval />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(approveReason)}
          title={approveReason || 'Open approval / sign-off'}
          aria-label={approveReason || 'Open approval sign-off'}
          onClick={onOpenApprove}
        >
          <IconApprove />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--view-si"
          disabled={Boolean(viewReason)}
          title={viewReason || 'View SI document'}
          aria-label={viewReason || 'View SI document'}
          onClick={onViewDocument}
        >
          <IconViewDocument />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--delete-si"
          disabled={Boolean(deleteReason)}
          title={deleteReason || 'Delete this instruction (Draft or Submitted only)'}
          aria-label={deleteReason || 'Delete shipping instruction'}
          onClick={onDelete}
        >
          <IconDelete />
        </button>
      </div>
    </div>
  )
}

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
  const { canApprove, canDelete } = useRbac()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingSnapshot, setEditingSnapshot] = useState(null)
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [lookups, setLookups] = useState(null)
  const [lookupsError, setLookupsError] = useState(null)
  /** Fixed toast notifications (success / error) for create, edit, delete, submit — auto-dismiss */
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    fetchSiLookups()
      .then((data) => setLookups(data))
      .catch((e) => setLookupsError(e?.message || 'Failed to load form options'))
  }, [])

  const defaultFormFromLookups = (lu) => {
    const base = {
      vesselName: '',
      referenceNumber: '',
      voyageNo: '',
      purposeId: '',
      tradeTermId: '',
      preferredJettyId: '',
      shipperId: '',
      loadingPortId: '',
      surveyorId: '',
      agentId: '',
      etaFrom: '',
      etaTo: '',
      documentDate: '',
      destinationText: '',
      freightTerms: '',
      billOfLadingClause: '',
      blSplitText: '',
      consigneeText: '',
      notifyPartyText: '',
      blIndicated: '',
      breakdown: [emptyBreakdownRow(lu)],
      note: '',
      documents: [],
    }
    if (!lu) return base
    return {
      ...base,
      tradeTermId: lu.tradeTerms?.[0]?.id != null ? String(lu.tradeTerms[0].id) : '',
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setListLoading(true)
      try {
        const rows = await fetchShippingInstructions()
        if (!cancelled) setList((rows || []).map(mapSiFromApi))
      } catch (e) {
        if (!cancelled) {
          setList([])
          const msg = e?.message || 'Failed to load shipping instructions'
          setToast({ message: msg, variant: 'error' })
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const [panelFilters, setPanelFilters] = useState(() => ({ ...INITIAL_PANEL_FILTERS }))
  const [columnFilters, setColumnFilters] = useState(() =>
    Object.fromEntries(SI_TABLE_COLUMNS.map((c) => [c.key, '']))
  )
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false)
  const [sortState, setSortState] = useState({ key: 'siNo', dir: 'desc' })
  const [expandedId, setExpandedId] = useState(null)
  const [breakdownBySi, setBreakdownBySi] = useState({})
  const [form, setForm] = useState(() => defaultFormFromLookups(null))
  const [npwpMaster, setNpwpMaster] = useState(null)

  const selectedPurpose = useMemo(
    () => (lookups?.purposes || []).find((p) => String(p.id) === String(form.purposeId)) || null,
    [lookups?.purposes, form.purposeId]
  )
  const purposeCode = selectedPurpose?.code || null
  const purposeChosen = !!form.purposeId
  const isLoadingPurpose = purposeCode === 'Loading'
  const isUnloadingPurpose = purposeCode === 'Unloading'
  const formEnabled = !!lookups && purposeChosen

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
        if (!cancelled) {
          const bd = Array.isArray(row?.breakdown) ? row.breakdown : []
          setBreakdownBySi((m) => ({ ...m, [expandedId]: bd }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedId, breakdownBySi])

  useEffect(() => {
    if (!isFormOpen) return
    if (!isLoadingPurpose) {
      setNpwpMaster(null)
      return
    }
    let cancelled = false
    fetchSiNpwpMaster()
      .then((r) => {
        if (!cancelled) setNpwpMaster(r?.npwp ?? null)
      })
      .catch((e) => {
        if (!cancelled) setNpwpMaster(null)
        const msg = e?.message || 'Failed to load NPWP master'
        setToast({ message: `Failed to load NPWP master: ${msg}`, variant: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [isFormOpen, isLoadingPurpose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!lookups) {
      setToast({ message: 'Form options not loaded yet.', variant: 'error' })
      return
    }
    const pid = parseInt(form.purposeId, 10)
    if (Number.isNaN(pid)) {
      setToast({ message: 'Select purpose.', variant: 'error' })
      return
    }
    const pRow = (lookups?.purposes || []).find((p) => Number(p.id) === pid) || null
    const pCode = pRow?.code || null
    const isLoading = pCode === 'Loading'
    const isUnloading = pCode === 'Unloading'
    if (!form.referenceNumber?.trim()) {
      setToast({ message: 'Shipping Instructions No. is required.', variant: 'error' })
      return
    }
    if (!form.etaFrom?.trim() || !form.etaTo?.trim()) {
      setToast({ message: 'ETA from and ETA to are required.', variant: 'error' })
      return
    }
    if (!form.documentDate?.trim()) {
      setToast({ message: 'Document date is required.', variant: 'error' })
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
        setToast({
          message: `Breakdown row ${i + 1}: select commodity and metric; quantity must be zero or greater.`,
          variant: 'error',
        })
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
        tradeTermId: isUnloading ? num(form.tradeTermId) : null,
        preferredJettyId: num(form.preferredJettyId),
        shipperId: num(form.shipperId),
        loadingPortId: num(form.loadingPortId),
        surveyorId: null,
        agentId: null,
        referenceNumber: form.referenceNumber.trim(),
        voyageNo: form.voyageNo?.trim() || null,
        eta: etaIso,
        etaFrom: form.etaFrom || null,
        etaTo: form.etaTo || null,
        documentDate: form.documentDate.trim(),
        destinationText: isLoading ? (form.destinationText?.trim() || null) : null,
        freightTerms: isLoading ? (form.freightTerms?.trim() || null) : null,
        billOfLadingClause: isLoading ? (form.billOfLadingClause?.trim() || null) : null,
        blSplitText: isLoading ? (form.blSplitText?.trim() || null) : null,
        consigneeText: isLoading ? (form.consigneeText?.trim() || null) : null,
        notifyPartyText: isLoading ? (form.notifyPartyText?.trim() || null) : null,
        blIndicated: isLoading ? (form.blIndicated?.trim() || null) : null,
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
          voyageNo: payload.voyageNo || '',
          purposeId: String(payload.purposeId || ''),
          tradeTermId: String(payload.tradeTermId || ''),
          preferredJettyId: String(payload.preferredJettyId || ''),
          shipperId: String(payload.shipperId || ''),
          loadingPortId: String(payload.loadingPortId || ''),
          surveyorId: String(payload.surveyorId || ''),
          agentId: String(payload.agentId || ''),
          etaFrom: payload.etaFrom || '',
          etaTo: payload.etaTo || '',
          documentDate: payload.documentDate || '',
          destinationText: payload.destinationText || '',
          freightTerms: payload.freightTerms || '',
          billOfLadingClause: payload.billOfLadingClause || '',
          blSplitText: payload.blSplitText || '',
          consigneeText: payload.consigneeText || '',
          notifyPartyText: payload.notifyPartyText || '',
          blIndicated: payload.blIndicated || '',
          note: payload.note || '',
          breakdown: (form.breakdown || []).map((x) => ({ ...x })), // current UI rows
        }
        const addChange = (field, from, to) => {
          if ((from ?? '') === (to ?? '')) return
          changes.push({ field, from, to })
        }
        addChange('Vessel', before.vesselName, after.vesselName)
        addChange('Shipping Instructions No.', before.referenceNumber, after.referenceNumber)
        addChange('Purpose', toLabel(before.purposeId, lookups?.purposes), toLabel(after.purposeId, lookups?.purposes))
        addChange('Term', toLabel(before.tradeTermId, lookups?.tradeTerms), toLabel(after.tradeTermId, lookups?.tradeTerms))
        addChange('Preferred jetty', toLabel(before.preferredJettyId, lookups?.jetties), toLabel(after.preferredJettyId, lookups?.jetties))
        addChange('Shipper', toLabel(before.shipperId, lookups?.shippers), toLabel(after.shipperId, lookups?.shippers))
        addChange('Loading port', toLabel(before.loadingPortId, lookups?.loadingPorts), toLabel(after.loadingPortId, lookups?.loadingPorts))
        addChange('Surveyor', toLabel(before.surveyorId, lookups?.surveyors), toLabel(after.surveyorId, lookups?.surveyors))
        addChange('Agent', toLabel(before.agentId, lookups?.agents), toLabel(after.agentId, lookups?.agents))
        addChange('ETA From', before.etaFrom, after.etaFrom)
        addChange('ETA To', before.etaTo, after.etaTo)
        addChange('Document date', before.documentDate, after.documentDate)
        addChange('Voyage', before.voyageNo, after.voyageNo)
        addChange('Destination', before.destinationText, after.destinationText)
        addChange('Freight terms', before.freightTerms, after.freightTerms)
        addChange('B/L clause', before.billOfLadingClause, after.billOfLadingClause)
        addChange('B/L split', before.blSplitText, after.blSplitText)
        addChange('Consignee', before.consigneeText, after.consigneeText)
        addChange('Notify', before.notifyPartyText, after.notifyPartyText)
        addChange('BL indicated', before.blIndicated, after.blIndicated)
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
      const savedLabel = saved.referenceNumber || `SI-${saved.id}`
      setToast({
        message: editingId
          ? `Shipping instruction updated: ${savedLabel}.`
          : `Shipping instruction created: ${savedLabel}.`,
        variant: 'success',
      })
    } catch (err) {
      const msg = err?.message || (editingId ? 'Update failed' : 'Create failed')
      setToast({ message: msg, variant: 'error' })
    }
  }

  const openCreateModal = () => {
    setForm(defaultFormFromLookups(lookups))
    setEditingId(null)
    setEditingSnapshot(null)
    setNpwpMaster(null)
    setIsFormOpen(true)
  }

  const openEditModal = async (id) => {
    if (!lookups) {
      setToast({ message: 'Form options not loaded yet. Try again in a moment.', variant: 'error' })
      return
    }
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
        voyageNo: row.voyageNo ?? '',
        purposeId: row.purposeId != null ? String(row.purposeId) : '',
        tradeTermId: row.tradeTermId != null ? String(row.tradeTermId) : '',
        preferredJettyId: row.preferredJettyId != null ? String(row.preferredJettyId) : '',
        shipperId: row.shipperId != null ? String(row.shipperId) : '',
        loadingPortId: row.loadingPortId != null ? String(row.loadingPortId) : '',
        surveyorId: row.surveyorId != null ? String(row.surveyorId) : '',
        agentId: row.agentId != null ? String(row.agentId) : '',
        etaFrom: toDateInputValue(row.etaFrom) || toDateInputValue(row.eta),
        etaTo: toDateInputValue(row.etaTo) || toDateInputValue(row.eta),
        documentDate: toDateInputValue(row.documentDate),
        destinationText: row.destinationText ?? '',
        freightTerms: row.freightTerms ?? '',
        billOfLadingClause: row.billOfLadingClause ?? '',
        blSplitText: row.blSplitText ?? '',
        consigneeText: row.consigneeText ?? '',
        notifyPartyText: row.notifyPartyText ?? '',
        blIndicated: row.blIndicated ?? '',
        breakdown: bd,
        note: row.note ?? '',
        documents: [],
      })
      setEditingId(id)
      setEditingSnapshot({
        vesselName: row.vesselName ?? '',
        referenceNumber: row.referenceNumber ?? '',
        voyageNo: row.voyageNo ?? '',
        purposeId: row.purposeId != null ? String(row.purposeId) : '',
        tradeTermId: row.tradeTermId != null ? String(row.tradeTermId) : '',
        preferredJettyId: row.preferredJettyId != null ? String(row.preferredJettyId) : '',
        shipperId: row.shipperId != null ? String(row.shipperId) : '',
        loadingPortId: row.loadingPortId != null ? String(row.loadingPortId) : '',
        surveyorId: row.surveyorId != null ? String(row.surveyorId) : '',
        agentId: row.agentId != null ? String(row.agentId) : '',
        etaFrom: toDateInputValue(row.etaFrom) || toDateInputValue(row.eta),
        etaTo: toDateInputValue(row.etaTo) || toDateInputValue(row.eta),
        documentDate: toDateInputValue(row.documentDate),
        destinationText: row.destinationText ?? '',
        freightTerms: row.freightTerms ?? '',
        billOfLadingClause: row.billOfLadingClause ?? '',
        blSplitText: row.blSplitText ?? '',
        consigneeText: row.consigneeText ?? '',
        notifyPartyText: row.notifyPartyText ?? '',
        blIndicated: row.blIndicated ?? '',
        breakdown: bd,
        note: row.note ?? '',
      })
      setIsFormOpen(true)
    } catch (e) {
      const msg = e?.message || 'Failed to load shipping instruction'
      setToast({ message: msg, variant: 'error' })
    }
  }

  const handleCloseModal = () => {
    setIsFormOpen(false)
    setEditingId(null)
    setEditingSnapshot(null)
    setNpwpMaster(null)
  }

  useEffect(() => {
    if (!isFormOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleCloseModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFormOpen])

  const updatePanelFilter = (key, value) => setPanelFilters((f) => ({ ...f, [key]: value }))
  const resetPanelFilters = () => {
    setPanelFilters({ ...INITIAL_PANEL_FILTERS })
  }
  const updateColumnFilter = (key, value) => setColumnFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredList = list.filter((n) => {
    const purposeMatch = !panelFilters.purpose || (n.purpose || '') === panelFilters.purpose.trim()
    const statusMatch = !panelFilters.status || (n.status || '') === panelFilters.status.trim()
    const docRangeMatch = matchesDocumentDateRange(n, panelFilters.documentDateFrom, panelFilters.documentDateTo)
    const columnMatch = SI_TABLE_COLUMNS.every((col) => {
      const f = (columnFilters[col.key] || '').trim().toLowerCase()
      if (!f) return true
      const hay = String(col.getFilterValue(n) ?? '').toLowerCase()
      return hay.includes(f)
    })
    return purposeMatch && statusMatch && docRangeMatch && columnMatch
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = SI_TABLE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const totalSI = filteredList.length
  const pendingApproval = filteredList.filter((n) => usesShippingInstructionApprovalFlow(n) && n.status === 'Submitted').length
  const now = Date.now()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  const upcomingArrivals = filteredList.filter((n) => {
    const eta = n.etaDateTime || n.etaFrom
    if (!eta) return false
    const t = new Date(eta).getTime()
    return t >= now && t <= now + oneWeek
  }).length
  const approvedThisWeek = filteredList.filter((n) => {
    if (n.status !== 'Approved' || !n.receivedAt) return false
    const t = new Date(n.receivedAt).getTime()
    return t >= now - oneWeek
  }).length

  const handleRequestApproval = async (n, e) => {
    e.stopPropagation()
    try {
      const row = await fetchShippingInstruction(n.id)
      const saved = await updateShippingInstruction(n.id, {
        vesselName: row.vesselName,
        status: 'Submitted',
      })
      setList((prev) => prev.map((r) => (r.id === n.id ? mapSiFromApi(saved) : r)))
      logActivity({
        pageKey: 'shipping-instruction',
        action: 'update',
        entityType: 'Shipping Instruction',
        entityLabel: n.siId || `SI-${n.id}`,
        details: { summary: 'Submitted SI for approval', status: 'Submitted' },
      })
      const lbl = n.referenceNumber || n.siId || `SI-${n.id}`
      setToast({ message: `Submitted for approval: ${lbl}.`, variant: 'success' })
    } catch (err) {
      setToast({ message: err?.message || 'Request approval failed', variant: 'error' })
    }
  }

  const handleDeleteSi = async (n, e) => {
    e.stopPropagation()
    if (siDeleteDisabledReason(n, canDelete('shipping-instruction'))) return
    const label = n.referenceNumber || n.siId || `SI-${n.id}`
    if (
      !window.confirm(
        `Delete shipping instruction "${label}"?\n\nDraft and Submitted instructions can be removed. This cannot be restored from the list.`
      )
    ) {
      return
    }
    try {
      await deleteShippingInstruction(n.id)
      setList((prev) => prev.filter((x) => x.id !== n.id))
      setExpandedId((id) => (id === n.id ? null : id))
      setBreakdownBySi((m) => {
        if (!(n.id in m)) return m
        const next = { ...m }
        delete next[n.id]
        return next
      })
      logActivity({
        pageKey: 'shipping-instruction',
        action: 'delete',
        entityType: 'Shipping Instruction',
        entityLabel: label,
        details: { summary: 'Deleted shipping instruction' },
      })
      setToast({ message: `Shipping instruction deleted: ${label}.`, variant: 'success' })
    } catch (err) {
      setToast({ message: err?.message || 'Delete failed', variant: 'error' })
    }
  }

  const handleExport = () => {
    const headers = [
      'Document date',
      'SI No',
      'Vessel',
      'Agent',
      'Material',
      'Shipper',
      'Surveyor',
      'Purpose',
      'ETA',
      'Status',
      'Approver',
      'Approval date',
    ]
    const rows = sortedList.map((n) => {
      const docLabel = formatSiCalendarDateOnly(n.documentDate)
      return [
      docLabel === '—' ? '' : docLabel,
      n.siId || '',
      n.vesselName || n.vesselId || '',
      n.agent && n.agent !== '—' ? n.agent : '',
      n.commodity || n.product || '',
      n.shipper && n.shipper !== '—' ? n.shipper : '',
      n.surveyor && n.surveyor !== '—' ? n.surveyor : '',
      n.purpose || '',
      formatEta(n),
      getDisplayStatus(n),
      n.approverNameSnapshot || n.approverDisplayName || '',
      n.approvedAt ? formatDate(n.approvedAt) : '',
    ]
    })
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

      <div className="si-toolbar si-toolbar--actions-only">
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
              value={panelFilters.purpose}
              onChange={(e) => updatePanelFilter('purpose', e.target.value)}
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
              value={panelFilters.status}
              onChange={(e) => updatePanelFilter('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="si-filters-panel__row si-filters-panel__row--document-date">
            <span className="si-filters-panel__label">Document Date</span>
            <div className="si-filters-panel__date-range">
              <input
                type="date"
                className="si-filters-panel__date-input"
                value={panelFilters.documentDateFrom}
                onChange={(e) => updatePanelFilter('documentDateFrom', e.target.value)}
                aria-label="Document date from"
              />
              <span className="si-filters-panel__date-range-sep">to</span>
              <input
                type="date"
                className="si-filters-panel__date-input"
                value={panelFilters.documentDateTo}
                onChange={(e) => updatePanelFilter('documentDateTo', e.target.value)}
                aria-label="Document date to"
              />
            </div>
          </div>
          <div className="si-filters-panel__row si-filters-panel__row--reset">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={resetPanelFilters}
              aria-label="Reset Purpose, Status, and Document Date filters to show all"
            >
              Reset
            </button>
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
                <h3 className="shipping-instruction-form__section-title">Purpose</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="purpose">Purpose *</label>
                    <select
                      id="purpose"
                      value={form.purposeId}
                      onChange={(e) => updateForm({ purposeId: e.target.value })}
                      required
                      disabled={!lookups}
                    >
                      <option value="">—</option>
                      {(lookups?.purposes || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    {!purposeChosen && (
                      <div className="text-steel" style={{ marginTop: 6, fontSize: '0.875rem' }}>
                        Select <strong>Loading</strong> or <strong>Unloading</strong> to continue.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <fieldset disabled={!formEnabled} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Vessel & trip</h3>
                <div className="shipping-instruction-form__grid shipping-instruction-form__grid--vessel-trip">
                  <div className="input-group shipping-instruction-form__vessel">
                    <label htmlFor="vesselName">Vessel Name *</label>
                    <input
                      id="vesselName"
                      value={form.vesselName}
                      onChange={(e) => updateForm({ vesselName: e.target.value })}
                      required
                      placeholder="e.g. TB. ARIA CITRA IV / BG. MULIA VII"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group shipping-instruction-form__ref">
                    <label htmlFor="siRef">Shipping Instructions No. *</label>
                    <input
                      id="siRef"
                      value={form.referenceNumber}
                      onChange={(e) => updateForm({ referenceNumber: e.target.value })}
                      required
                      placeholder="e.g. SI/EUP/2026/1/003"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group shipping-instruction-form__docdate">
                    <label htmlFor="documentDate">Document date *</label>
                    <input
                      id="documentDate"
                      type="date"
                      value={form.documentDate}
                      onChange={(e) => updateForm({ documentDate: e.target.value })}
                      required
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group shipping-instruction-form__eta-from">
                    <label htmlFor="etaFrom">ETA from *</label>
                    <input id="etaFrom" type="date" value={form.etaFrom} onChange={(e) => updateForm({ etaFrom: e.target.value })} required disabled={!lookups} />
                  </div>
                  <div className="input-group shipping-instruction-form__eta-to">
                    <label htmlFor="etaTo">ETA to *</label>
                    <input id="etaTo" type="date" value={form.etaTo} onChange={(e) => updateForm({ etaTo: e.target.value })} required disabled={!lookups} />
                  </div>
                  <div className="input-group shipping-instruction-form__jetty">
                    <label htmlFor="jetty">Preferred jetty</label>
                    <select id="jetty" value={form.preferredJettyId} onChange={(e) => updateForm({ preferredJettyId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.jetties || []).map((j) => (
                        <option key={j.id} value={j.id}>{j.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group shipping-instruction-form__voyage">
                    <label htmlFor="voyageNo">Voyage no. (optional)</label>
                    <input
                      id="voyageNo"
                      value={form.voyageNo}
                      onChange={(e) => updateForm({ voyageNo: e.target.value })}
                      placeholder="e.g. V.2601"
                      disabled={!lookups}
                    />
                  </div>
                </div>
              </div>

              {isLoadingPurpose && (
                <div className="shipping-instruction-form__section">
                  <h3 className="shipping-instruction-form__section-title">Route & freight</h3>
                  <div className="shipping-instruction-form__grid">
                    <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                      <label htmlFor="destinationText">Destination</label>
                      <input
                        id="destinationText"
                        value={form.destinationText}
                        onChange={(e) => updateForm({ destinationText: e.target.value })}
                        placeholder="e.g. NANSHA, CHINA"
                        disabled={!lookups}
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="freightTerms">Freight terms</label>
                      <select
                        id="freightTerms"
                        value={form.freightTerms}
                        onChange={(e) => updateForm({ freightTerms: e.target.value })}
                        disabled={!lookups}
                      >
                        {FREIGHT_TERM_OPTIONS.map((o) => (
                          <option key={o.value || 'none'} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

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
                    <label htmlFor="loadingPort">Loading Port / Shipment From</label>
                    <select id="loadingPort" value={form.loadingPortId} onChange={(e) => updateForm({ loadingPortId: e.target.value })} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.loadingPorts || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  {isUnloadingPurpose && (
                    <div className="input-group">
                      <label htmlFor="term">Term</label>
                      <select id="term" value={form.tradeTermId} onChange={(e) => updateForm({ tradeTermId: e.target.value })} disabled={!lookups}>
                        <option value="">—</option>
                        {(lookups?.tradeTerms || []).map((t) => (
                          <option key={t.id} value={t.id}>{t.code}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {isLoadingPurpose && (
                    <div className="input-group">
                      <label htmlFor="npwpMaster">NPWP</label>
                      <input id="npwpMaster" value={npwpMaster || '—'} readOnly disabled={!lookups} />
                    </div>
                  )}
                </div>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Shipment breakdown (Contract / PO)</h3>
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
                              required
                              className="shipping-instruction-inline-input shipping-instruction-inline-input--num"
                            />
                          </td>
                          <td>
                            <select
                              value={row.metricId}
                              onChange={(e) => updateBreakdownRow(i, 'metricId', e.target.value)}
                              required
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

              {isLoadingPurpose && (
                <div className="shipping-instruction-form__section">
                  <h3 className="shipping-instruction-form__section-title">B/L & consignee</h3>
                  <div className="shipping-instruction-form__grid">
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="blSplitText">B/L Split</label>
                    <textarea
                      id="blSplitText"
                      className="shipping-instruction-inline-input"
                      style={{ minHeight: 56, resize: 'vertical' }}
                      value={form.blSplitText}
                      onChange={(e) => updateForm({ blSplitText: e.target.value })}
                      placeholder="e.g  1 X 1,430 MTS ..."
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="billOfLadingClause">Bill of lading clause</label>
                    <textarea
                      id="billOfLadingClause"
                      className="shipping-instruction-inline-input"
                      style={{ minHeight: 72, resize: 'vertical' }}
                      value={form.billOfLadingClause}
                      onChange={(e) => updateForm({ billOfLadingClause: e.target.value })}
                      placeholder="e.g. 3 ORIGINAL and 3 NON-NEGOTIABLE…"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="consigneeText">Consignee</label>
                    <textarea
                      id="consigneeText"
                      className="shipping-instruction-inline-input"
                      style={{ minHeight: 56, resize: 'vertical' }}
                      value={form.consigneeText}
                      onChange={(e) => updateForm({ consigneeText: e.target.value })}
                      placeholder="e.g. TO ORDER"
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="notifyPartyText">Notify party</label>
                    <textarea
                      id="notifyPartyText"
                      className="shipping-instruction-inline-input"
                      style={{ minHeight: 72, resize: 'vertical' }}
                      value={form.notifyPartyText}
                      onChange={(e) => updateForm({ notifyPartyText: e.target.value })}
                      disabled={!lookups}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="blIndicated">BL indicated</label>
                    <textarea
                      id="blIndicated"
                      className="shipping-instruction-inline-input"
                      style={{ minHeight: 56, resize: 'vertical' }}
                      value={form.blIndicated}
                      onChange={(e) => updateForm({ blIndicated: e.target.value })}
                      placeholder="e.g. CLEAN SHIPPED ON BOARD FREIGHT PREPAID"
                      disabled={!lookups}
                    />
                  </div>
                  </div>
                </div>
              )}

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

              </fieldset>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={!formEnabled}>Submit</button>
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
                <th className="shipping-instruction-table__expand-col" aria-label="Expand row" />
                <th scope="col" className="si-table__col-actions shipping-instruction-table__th--actions">
                  Actions
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
              </tr>
              <tr className="shipping-instruction-table__filter-row">
                <th className="shipping-instruction-table__expand-col" aria-hidden />
                <th className="si-table__col-actions" aria-hidden />
                {SI_TABLE_COLUMNS.map((col) => (
                  <th key={col.key}>
                    <input
                      type="text"
                      className="shipping-instruction-table__filter"
                      placeholder={`Filter ${col.label}`}
                      value={columnFilters[col.key]}
                      onChange={(e) => updateColumnFilter(col.key, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Filter by ${col.label}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedList.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={`shipping-instruction-table__row ${expandedId === n.id ? 'shipping-instruction-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === n.id ? null : n.id))}
                  >
                    <td className="shipping-instruction-table__expand-col">
                      <span className="shipping-instruction-table__expand-icon" aria-hidden>
                        {expandedId === n.id ? '▼' : '▶'}
                      </span>
                    </td>
                    <td className="si-table__col-actions" onClick={(e) => e.stopPropagation()}>
                      <SiRowActions
                        row={n}
                        canApproveSi={canApprove('shipping-instruction')}
                        canDeleteSi={canDelete('shipping-instruction')}
                        onEdit={(e) => {
                          e.stopPropagation()
                          openEditModal(n.id)
                        }}
                        onRequestApproval={(e) => handleRequestApproval(n, e)}
                        onOpenApprove={(e) => {
                          e.stopPropagation()
                          navigate(`/shipping-instruction/approval/${n.id}`, { state: { si: n } })
                        }}
                        onViewDocument={(e) => {
                          e.stopPropagation()
                          if (canViewAsDocument(n) && (n.siId || n.id)) {
                            navigate(`/shipping-instruction/view/${n.id}`, { state: { si: n } })
                          }
                        }}
                        onDelete={(e) => handleDeleteSi(n, e)}
                      />
                    </td>
                    {SI_TABLE_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getCell(n)}</td>
                    ))}
                  </tr>
                  {expandedId === n.id && (
                    <tr key={n.id + '-detail'} className="shipping-instruction-table__detail-row">
                      <td colSpan={SI_TABLE_COLUMNS.length + 2} className="shipping-instruction-table__detail-cell">
                        <div className="shipping-instruction-detail">
                          <h4 className="shipping-instruction-detail__title">Full details</h4>
                          <dl className="shipping-instruction-detail__grid">
                            <dt>SI No</dt><dd>{n.siId || '—'}</dd>
                            <dt>Status</dt><dd>{getDisplayStatus(n)}</dd>
                            {(n.purpose || '').toLowerCase() === 'unloading' && (
                              <><dt>Source</dt><dd>External</dd></>
                            )}
                            <dt>Vessel</dt><dd>{n.vesselName || n.vesselId || '—'}</dd>
                            <dt>Purpose</dt>
                            <dd>
                              <PurposeBadge purpose={n.purpose} />
                            </dd>
                            <dt>Jetty</dt><dd>{n.jetty || '—'}</dd>
                            <dt>ETA From</dt><dd>{n.etaFrom || (n.etaDateTime ? String(n.etaDateTime).slice(0, 10) : '—')}</dd>
                            <dt>ETA To</dt><dd>{n.etaTo || (n.etaDateTime ? String(n.etaDateTime).slice(0, 10) : '—')}</dd>
                            <dt>Term</dt><dd>{n.term || '—'}</dd>
                            <dt>Voyage</dt><dd>{n.voyageNo || '—'}</dd>
                            <dt>Destination</dt><dd>{n.destinationText || '—'}</dd>
                            <dt>Freight terms</dt><dd>{n.freightTerms || '—'}</dd>
                            <dt>Document date</dt><dd>{n.documentDate || '—'}</dd>
                            <dt>B/L clause</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.billOfLadingClause || '—'}</dd>
                            <dt>B/L split</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.blSplitText || '—'}</dd>
                            <dt>Consignee</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.consigneeText || '—'}</dd>
                            <dt>Notify party</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.notifyPartyText || '—'}</dd>
                            <dt>BL indicated</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.blIndicated || '—'}</dd>
                            <dt>Shipper</dt><dd>{n.shipper || '—'}</dd>
                            <dt>Loading port</dt><dd>{n.loadingPort || '—'}</dd>
                            <dt>Surveyor</dt><dd>{n.surveyor || '—'}</dd>
                            <dt>Agent</dt><dd>{n.agent || '—'}</dd>
                            <dt>Note</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{n.note || '—'}</dd>
                            <dt>Approver</dt>
                            <dd>{n.approverNameSnapshot || n.approverDisplayName || '—'}</dd>
                            <dt>Approval date</dt>
                            <dd>{n.approvedAt ? formatDate(n.approvedAt) : '—'}</dd>
                            <dt>Received</dt><dd>{formatDate(n.receivedAt)}</dd>
                          </dl>
                          <h5 className="shipping-instruction-detail__title" style={{ marginTop: '1rem' }}>Contract / PO breakdown</h5>
                          {breakdownBySi[n.id] === undefined && <p className="text-steel">Loading…</p>}
                          {Array.isArray(breakdownBySi[n.id]) && breakdownBySi[n.id].length === 0 && (
                            <p className="text-steel">No breakdown lines.</p>
                          )}
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
