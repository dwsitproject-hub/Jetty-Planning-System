import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchShipmentPlans,
  fetchShipmentPlan,
  createShipmentPlan,
  updateShipmentPlan,
  submitShipmentPlan,
  deleteShipmentPlan,
} from '../api/shipmentPlans'
import {
  createShippingInstruction,
  fetchShippingInstruction,
  fetchSiNpwpMaster,
  updateShippingInstruction,
} from '../api/shippingInstructions'
import { attachDraftSiDocuments, deleteSiDocument } from '../api/siDocuments'
import { fetchSiLookups } from '../api/siLookups'
import { useRbac } from '../context/RbacContext'
import { useActivityLog } from '../context/ActivityLogContext'
import PurposeBadge, { resolvePurposeLabel } from '../components/PurposeBadge'
import SiDocumentModal from '../components/SiDocumentModal'
import ShippingInstructionSiLinkedFields from '../components/ShippingInstructionSiLinkedFields'
import ShippingInstructionDocumentUploadSection from '../components/ShippingInstructionDocumentUploadSection'
import { ShipmentPlanRowActions } from '../components/SiTableRowActions.jsx'
import {
  defaultSiDraftForPlanPreview,
  nextDocId,
  planEtaYmd,
  siDetailToPlanLinkedDraftForm,
  existingSiIdFromDraftKey,
  validateSiDraftForCreate,
  buildSiCreateApiPayload,
  buildSiUpdateApiPayload,
} from '../utils/siPlanLinkedDraft'
import { useSiDocumentExtract } from '../hooks/useSiDocumentExtract'
import SiExtractConflictModal from '../components/SiExtractConflictModal'
import SiExtractResultPanel from '../components/SiExtractResultPanel'
import { MAX_SI_VESSEL_NAME_CHARS, MAX_SI_VOYAGE_CHARS } from '../constants/inputLimits'
import '../styles/shipping-instruction.css'
import '../styles/allocation.css'

function formatEta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function approvalBadgeClass(status) {
  const s = (status || 'draft').toLowerCase()
  return `si-status-badge si-status-badge--${s.replace(/\s+/g, '-')}`
}

function toDateTimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function genSiDraftId() {
  return `si-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const PLANS_LIST_PAGE_SIZE = 20

export default function ShipmentPlansList() {
  const { t } = useTranslation('shipmentPlan')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { logActivity } = useActivityLog()
  const { canView, canEdit, canApprove, canDelete } = useRbac()
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [approvalFilter, setApprovalFilter] = useState('')
  const [purposeFilter, setPurposeFilter] = useState('')
  const [vesselQ, setVesselQ] = useState('')
  const [debouncedVesselQ, setDebouncedVesselQ] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [expandDetail, setExpandDetail] = useState({})
  const [expandLoading, setExpandLoading] = useState(false)

  const [isFormOpen, setIsFormOpen] = useState(false)
  /** 'create' | 'edit' | 'view' — view uses create layout with filled read-only fields */
  const [formModalMode, setFormModalMode] = useState(null)
  const [modalSiLoading, setModalSiLoading] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [formVessel, setFormVessel] = useState('')
  const [formJettyId, setFormJettyId] = useState('')
  const [formEta, setFormEta] = useState('')
  const [formPurposeId, setFormPurposeId] = useState('')
  const [formVoyageNo, setFormVoyageNo] = useState('')
  const [formAgentId, setFormAgentId] = useState('')
  /** Create flow: one scroll — plan + one or more SI draft cards */
  const [siDrafts, setSiDrafts] = useState([])
  const [npwpMaster, setNpwpMaster] = useState(null)
  const [editingPlanDetail, setEditingPlanDetail] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tableFilters, setTableFilters] = useState({
    planRef: '',
    vessel: '',
    siRefs: '',
    commodityQty: '',
    purpose: '',
    approval: '',
    jetty: '',
    eta: '',
  })
  const [plansListPage, setPlansListPage] = useState(1)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)
  const [siDraftOcrIndex, setSiDraftOcrIndex] = useState(null)
  const openedPlanFromQueryRef = useRef(null)

  const getPlanFormForExtract = useCallback(
    () => ({
      vesselName: formVessel,
      voyageNo: formVoyageNo,
      agentId: formAgentId,
      eta: formEta,
    }),
    [formVessel, formVoyageNo, formAgentId, formEta]
  )

  const onApplyPlanFieldsFromExtract = useCallback((plan) => {
    if (plan.vesselName != null) setFormVessel(plan.vesselName)
    if (plan.voyageNo != null) setFormVoyageNo(plan.voyageNo)
    if (plan.agentId != null) setFormAgentId(String(plan.agentId))
    if (plan.eta != null) setFormEta(plan.eta)
  }, [])

  const siDocExtract = useSiDocumentExtract({
    lookups,
    t,
    getPlanForm: getPlanFormForExtract,
    onApplyPlanFields: onApplyPlanFieldsFromExtract,
  })

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedVesselQ(vesselQ.trim()), 350)
    return () => window.clearTimeout(id)
  }, [vesselQ])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    fetchSiLookups()
      .then((data) => setLookups(data))
      .catch(() => setLookups(null))
  }, [])

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const rows = await fetchShipmentPlans({
        approvalStatus: approvalFilter || undefined,
        q: debouncedVesselQ || undefined,
        purposeId: purposeFilter || undefined,
      })
      setList(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setList([])
      setToast({ message: e?.message || t('listLoading'), variant: 'error' })
    } finally {
      setListLoading(false)
    }
  }, [approvalFilter, debouncedVesselQ, purposeFilter, t])

  useEffect(() => {
    if (!canView('shipment-plan')) return
    loadList()
  }, [loadList, canView])

  const summary = useMemo(() => {
    const total = list.length
    const pending = list.filter((r) => r.approvalStatus === 'Submitted').length
    const approved = list.filter((r) => r.approvalStatus === 'Approved').length
    const draft = list.filter((r) => r.approvalStatus === 'Draft' || r.approvalStatus === 'Rejected').length
    return { total, pending, approved, draft }
  }, [list])

  const planPreviewForSi = useMemo(() => {
    const etaDate = formEta?.trim() ? new Date(formEta) : null
    const etaIso = etaDate && !isNaN(etaDate.getTime()) ? etaDate.toISOString() : null
    const purposePid = formPurposeId ? parseInt(formPurposeId, 10) : null
    const pr = (lookups?.purposes || []).find((p) => String(p.id) === String(formPurposeId)) || null
    const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
    const agentPid = formAgentId ? parseInt(formAgentId, 10) : null
    return {
      vesselName: formVessel.trim(),
      purposeId: Number.isFinite(purposePid) ? purposePid : null,
      purposeCode: pr?.code ?? null,
      eta: etaIso,
      voyageNo: formVoyageNo.trim() || null,
      jettyId: Number.isFinite(jettyId) ? jettyId : null,
      planReference: null,
      id: undefined,
      agentId: Number.isFinite(agentPid) ? agentPid : null,
    }
  }, [formVessel, formEta, formPurposeId, formJettyId, formVoyageNo, formAgentId, lookups])

  const linkedPlanForSiCards = useMemo(() => {
    if (!editingPlan) return planPreviewForSi
    const pr = (lookups?.purposes || []).find((p) => String(p.id) === String(formPurposeId)) || null
    return {
      ...planPreviewForSi,
      id: editingPlan.id,
      planReference: editingPlan.planReference,
      purposeCode: pr?.code ?? editingPlan.purposeCode ?? null,
    }
  }, [editingPlan, planPreviewForSi, formPurposeId, lookups])

  const filteredPlans = useMemo(() => {
    const f = tableFilters
    const inc = (hay, needle) =>
      !needle?.trim() || String(hay ?? '').toLowerCase().includes(needle.trim().toLowerCase())
    return list.filter((row) => {
      const planLabel = row.planReference || `Plan #${row.id}`
      if (!inc(planLabel, f.planRef)) return false
      if (!inc(row.vesselName, f.vessel)) return false
      const siStr = (row.shippingInstructions || []).map((s) => s.referenceNumber || `SI-${s.id}`).join(' ')
      if (!inc(siStr, f.siRefs)) return false
      const qtyStr = (row.shippingInstructions || []).map((s) => s.commodityQtyDisplay || '').join(' ')
      if (!inc(qtyStr, f.commodityQty)) return false
      const planPurposeStr = resolvePurposeLabel(row.purposeCode, null)
      if (!inc(planPurposeStr, f.purpose)) return false
      if (!inc(row.approvalStatus, f.approval)) return false
      if (!inc(row.jettyName || '—', f.jetty)) return false
      if (!inc(formatEta(row.eta), f.eta)) return false
      return true
    })
  }, [list, tableFilters])

  useEffect(() => {
    setPlansListPage(1)
  }, [tableFilters, approvalFilter, purposeFilter, debouncedVesselQ])

  const plansListTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredPlans.length / PLANS_LIST_PAGE_SIZE)),
    [filteredPlans.length]
  )

  useEffect(() => {
    setPlansListPage((p) => Math.min(p, plansListTotalPages))
  }, [plansListTotalPages])

  const paginatedFilteredPlans = useMemo(() => {
    const start = (plansListPage - 1) * PLANS_LIST_PAGE_SIZE
    return filteredPlans.slice(start, start + PLANS_LIST_PAGE_SIZE)
  }, [filteredPlans, plansListPage])

  const plansPaginationRange = useMemo(() => {
    const total = filteredPlans.length
    if (total === 0) return { from: 0, to: 0 }
    const from = (plansListPage - 1) * PLANS_LIST_PAGE_SIZE + 1
    const to = Math.min(plansListPage * PLANS_LIST_PAGE_SIZE, total)
    return { from, to }
  }, [filteredPlans.length, plansListPage])

  const createModalPurposeIsLoading = useMemo(() => {
    const p = (lookups?.purposes || []).find((x) => String(x.id) === String(formPurposeId))
    return p?.code === 'Loading'
  }, [lookups, formPurposeId])

  useEffect(() => {
    if (!isFormOpen || !createModalPurposeIsLoading) {
      setNpwpMaster(null)
      return
    }
    let cancelled = false
    fetchSiNpwpMaster()
      .then((r) => {
        if (!cancelled) setNpwpMaster(r?.npwp ?? null)
      })
      .catch((e) => {
        if (!cancelled) {
          setNpwpMaster(null)
          const msg = e?.message || 'Failed to load NPWP master'
          setToast({ message: `Failed to load NPWP master: ${msg}`, variant: 'error' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [isFormOpen, createModalPurposeIsLoading])

  useEffect(() => {
    if (!isFormOpen || formModalMode !== 'create' || !lookups) return
    setSiDrafts((prev) => {
      if (prev.length > 0) return prev
      return [{ id: genSiDraftId(), form: defaultSiDraftForPlanPreview(lookups, planPreviewForSi) }]
    })
  }, [isFormOpen, formModalMode, lookups, planPreviewForSi])

  /** View/edit modal: hydrate SI draft cards when lookups arrive after plan fetch. */
  useEffect(() => {
    if ((formModalMode !== 'view' && formModalMode !== 'edit') || !isFormOpen || !lookups || !editingPlanDetail || siDrafts.length > 0)
      return
    const children = editingPlanDetail.shippingInstructions || []
    if (!children.length) return
    let cancelled = false
    setModalSiLoading(true)
    ;(async () => {
      try {
        const drafts = await buildSiDraftsFromPlanDetail(editingPlanDetail, editingPlan)
        if (!cancelled && drafts.length) setSiDrafts(drafts)
      } catch {
        if (!cancelled) setToast({ message: t('listLoading'), variant: 'error' })
      } finally {
        if (!cancelled) setModalSiLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [formModalMode, isFormOpen, lookups, editingPlanDetail, editingPlan, siDrafts.length, t])

  useEffect(() => {
    if (!isFormOpen || formModalMode === 'view' || !lookups || siDocExtract.extractBusy) return
    setSiDrafts((drafts) => {
      if (drafts.length === 0) return drafts
      if (
        drafts.some((d) =>
          (d.form.documents || []).some((doc) => doc.pending || doc.failed)
        )
      ) {
        return drafts
      }
      const ymd = planEtaYmd(planPreviewForSi)
      return drafts.map((d) => ({
        ...d,
        form: {
          ...d.form,
          documents: Array.isArray(d.form.documents) ? [...d.form.documents] : [],
          vesselName: planPreviewForSi.vesselName || '',
          purposeId: planPreviewForSi.purposeId != null ? String(planPreviewForSi.purposeId) : '',
          preferredJettyId: planPreviewForSi.jettyId != null ? String(planPreviewForSi.jettyId) : '',
          etaFrom: ymd,
          etaTo: ymd,
          documentDate: d.form.documentDate?.trim()
            ? d.form.documentDate
            : ymd || '',
        },
      }))
    })
  }, [isFormOpen, formModalMode, lookups, planPreviewForSi, siDocExtract.extractBusy])

  const applyPlanDetailToFormFields = (d, row) => {
    setFormVessel(d.vesselName || row?.vesselName || '')
    setFormJettyId(d.jettyId != null ? String(d.jettyId) : '')
    setFormEta(toDateTimeLocalValue(d.eta ?? row?.eta))
    setFormPurposeId(d.purposeId != null ? String(d.purposeId) : '')
    setFormVoyageNo(d.voyageNo || '')
    setFormAgentId(d.agentId != null ? String(d.agentId) : '')
  }

  const buildSiDraftsFromPlanDetail = async (d, row) => {
    const children = d.shippingInstructions || []
    if (!children.length || !lookups) return []
    const purposeRow = (lookups?.purposes || []).find((p) => Number(p.id) === Number(d.purposeId)) || null
    const linked = {
      id: d.id,
      vesselName: d.vesselName,
      purposeId: d.purposeId,
      purposeCode: purposeRow?.code ?? d.purposeCode ?? row?.purposeCode ?? null,
      eta: d.eta,
      voyageNo: d.voyageNo,
      jettyId: d.jettyId,
      planReference: d.planReference,
      agentId: d.agentId,
    }
    const fullRows = await Promise.all(children.map((si) => fetchShippingInstruction(si.id)))
    return fullRows.map((si) => ({
      id: `si-existing-${si.id}`,
      form: siDetailToPlanLinkedDraftForm(si, lookups, linked),
      existingStatus: si.status || 'Draft',
    }))
  }

  const openCreateModal = () => {
    setFormModalMode('create')
    setModalSiLoading(false)
    setEditingPlan(null)
    setFormVessel('')
    setFormJettyId('')
    setFormEta('')
    setFormPurposeId('')
    setFormVoyageNo('')
    setFormAgentId('')
    setSiDrafts([])
    setIsFormOpen(true)
  }

  const openEditModal = async (row) => {
    setFormModalMode('edit')
    setModalSiLoading(true)
    setEditingPlan(row)
    setSiDrafts([])
    setEditingPlanDetail(null)
    setFormVessel(row.vesselName || '')
    setFormJettyId(row.jettyId != null ? String(row.jettyId) : '')
    setFormEta(toDateTimeLocalValue(row.eta))
    setFormPurposeId(row.purposeId != null ? String(row.purposeId) : '')
    setFormVoyageNo(row.voyageNo || '')
    setFormAgentId(row.agentId != null ? String(row.agentId) : '')
    setIsFormOpen(true)
    try {
      const d = await fetchShipmentPlan(row.id)
      setEditingPlanDetail(d)
      applyPlanDetailToFormFields(d, row)
      const drafts = await buildSiDraftsFromPlanDetail(d, row)
      if (drafts.length) setSiDrafts(drafts)
    } catch {
      setEditingPlanDetail(null)
      setToast({ message: t('listLoading'), variant: 'error' })
    } finally {
      setModalSiLoading(false)
    }
  }

  const openViewModal = async (row) => {
    setFormModalMode('view')
    setModalSiLoading(true)
    setEditingPlan(row)
    setSiDrafts([])
    setEditingPlanDetail(null)
    setFormVessel(row.vesselName || '')
    setFormJettyId(row.jettyId != null ? String(row.jettyId) : '')
    setFormEta(toDateTimeLocalValue(row.eta))
    setFormPurposeId(row.purposeId != null ? String(row.purposeId) : '')
    setFormVoyageNo(row.voyageNo || '')
    setFormAgentId(row.agentId != null ? String(row.agentId) : '')
    setIsFormOpen(true)
    try {
      const d = await fetchShipmentPlan(row.id)
      setEditingPlanDetail(d)
      applyPlanDetailToFormFields(d, row)
      const drafts = await buildSiDraftsFromPlanDetail(d, row)
      if (drafts.length) setSiDrafts(drafts)
    } catch {
      setEditingPlanDetail(null)
      setToast({ message: t('listLoading'), variant: 'error' })
    } finally {
      setModalSiLoading(false)
    }
  }

  const handleCloseModal = () => {
    setIsFormOpen(false)
    setFormModalMode(null)
    setModalSiLoading(false)
    setEditingPlan(null)
    setSiDrafts([])
    setEditingPlanDetail(null)
    setSiDocumentModalId(null)
    openedPlanFromQueryRef.current = null
    setSiDraftOcrIndex(null)
    setFormAgentId('')
  }

  /** Deep link from plan hub "Add SI": `/shipment-plans?shipment_plan_id=<id>`. */
  useEffect(() => {
    const raw = searchParams.get('shipment_plan_id')
    if (!raw || !canView('shipment-plan')) return
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.delete('shipment_plan_id')
          return p
        },
        { replace: true }
      )
      return
    }
    if (openedPlanFromQueryRef.current === n) return
    openedPlanFromQueryRef.current = n
    ;(async () => {
      try {
        const d = await fetchShipmentPlan(n)
        const row = {
          id: d.id,
          vesselName: d.vesselName,
          jettyId: d.jettyId,
          eta: d.eta,
          purposeId: d.purposeId,
          purposeCode: d.purposeCode,
          planReference: d.planReference,
          voyageNo: d.voyageNo,
          approvalStatus: d.approvalStatus,
          agentId: d.agentId,
        }
        setFormModalMode('edit')
        setEditingPlan(row)
        setSiDrafts([])
        setEditingPlanDetail(d)
        setFormVessel(row.vesselName || '')
        setFormJettyId(row.jettyId != null ? String(row.jettyId) : '')
        setFormEta(toDateTimeLocalValue(row.eta))
        setFormPurposeId(row.purposeId != null ? String(row.purposeId) : '')
        setFormVoyageNo(row.voyageNo || '')
        setFormAgentId(d.agentId != null ? String(d.agentId) : '')
        setIsFormOpen(true)
      } catch {
        openedPlanFromQueryRef.current = null
        setToast({ message: t('listLoading'), variant: 'error' })
      } finally {
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev)
            p.delete('shipment_plan_id')
            return p
          },
          { replace: true }
        )
      }
    })()
  }, [searchParams, setSearchParams, canView, t])

  const handleSavePlan = async (e) => {
    e.preventDefault()
    if (!editingPlan) return
    const v = formVessel.trim()
    if (!v) {
      setToast({ message: t('formVesselRequired'), variant: 'error' })
      return
    }
    if (!formEta?.trim()) {
      setToast({ message: t('formEtaRequired'), variant: 'error' })
      return
    }
    if (!formPurposeId) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return
    }
    try {
      const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
      const etaIso = new Date(formEta).toISOString()
      const purposePid = parseInt(formPurposeId, 10)
      if (Number.isNaN(purposePid)) {
        setToast({ message: t('formPurposeRequired'), variant: 'error' })
        return
      }
      const agentPidSave = formAgentId.trim() ? parseInt(formAgentId, 10) : NaN
      await updateShipmentPlan(editingPlan.id, {
        vesselName: v,
        jettyId: Number.isNaN(jettyId) ? null : jettyId,
        eta: etaIso,
        purposeId: purposePid,
        voyageNo: formVoyageNo.trim() || null,
        agentId: Number.isFinite(agentPidSave) ? agentPidSave : null,
      })
      let updatedSiCount = 0
      let createdSiCount = 0
      if (lookups && siDrafts.length > 0) {
        const purposeRow = (lookups?.purposes || []).find((p) => Number(p.id) === purposePid) || null
        const linked = {
          id: editingPlan.id,
          vesselName: v,
          purposeId: purposePid,
          purposeCode: purposeRow?.code ?? editingPlan.purposeCode ?? null,
          eta: etaIso,
          voyageNo: formVoyageNo.trim() || null,
          jettyId: Number.isNaN(jettyId) ? null : jettyId,
          planReference: editingPlan.planReference,
          agentId: Number.isFinite(agentPidSave) ? agentPidSave : null,
        }
        for (let i = 0; i < siDrafts.length; i += 1) {
          const validated = validateSiDraftForCreate(siDrafts[i].form, lookups, linked)
          if (typeof validated === 'string') {
            setToast({ message: t('createSiValidationError', { n: i + 1, message: validated }), variant: 'error' })
            await loadList()
            return
          }
          const existingId = existingSiIdFromDraftKey(siDrafts[i].id)
          if (existingId) {
            const updatePayload = buildSiUpdateApiPayload(siDrafts[i].form, linked, validated)
            updatePayload.status = siDrafts[i].existingStatus || 'Draft'
            const saved = await updateShippingInstruction(existingId, updatePayload)
            updatedSiCount += 1
            logActivity({
              pageKey: 'shipment-plan',
              action: 'update',
              entityType: 'Shipping Instruction',
              entityLabel: saved.referenceNumber || `SI-${saved.id}`,
              details: { summary: `Updated SI on plan ${editingPlan.planReference || editingPlan.id} (edit modal)` },
            })
          } else {
            const payload = buildSiCreateApiPayload(siDrafts[i].form, linked, validated)
            const saved = await createShippingInstruction(payload)
            createdSiCount += 1
            if ((siDrafts[i].form.documents || []).some((doc) => doc.documentId)) {
              try {
                await attachDraftSiDocuments({
                  draftKey: siDrafts[i].id,
                  shipmentPlanId: editingPlan.id,
                  shippingInstructionId: saved.id,
                })
              } catch {
                /* non-fatal */
              }
            }
            logActivity({
              pageKey: 'shipment-plan',
              action: 'add',
              entityType: 'Shipping Instruction',
              entityLabel: saved.referenceNumber || `SI-${saved.id}`,
              details: { summary: `Added SI to plan ${editingPlan.planReference || editingPlan.id} (edit modal)` },
            })
          }
        }
      }
      logActivity({
        pageKey: 'shipment-plan',
        action: 'update',
        entityType: 'ShipmentPlan',
        entityLabel: editingPlan.planReference || `Plan #${editingPlan.id}`,
        details: { summary: 'Updated shipment plan' },
      })
      let successMessage = t('editPlanSaved')
      if (updatedSiCount > 0 && createdSiCount > 0) {
        successMessage = t('editPlanSavedUpdatedAndCreated', { updated: updatedSiCount, created: createdSiCount })
      } else if (updatedSiCount > 0) {
        successMessage = t('editPlanSavedUpdatedSis', { count: updatedSiCount })
      } else if (createdSiCount > 0) {
        successMessage = t('editPlanSavedWithNewSis', { count: createdSiCount })
      }
      setToast({ message: successMessage, variant: 'success' })
      handleCloseModal()
      await loadList()
    } catch (err) {
      setToast({ message: err?.message || 'Save failed', variant: 'error' })
    }
  }

  const handleCreatePlanAndSis = async (e) => {
    e.preventDefault()
    const v = formVessel.trim()
    if (!v) {
      setToast({ message: t('formVesselRequired'), variant: 'error' })
      return
    }
    if (!formEta?.trim()) {
      setToast({ message: t('formEtaRequired'), variant: 'error' })
      return
    }
    if (!formPurposeId) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return
    }
    if (!lookups) {
      setToast({ message: 'Form options not loaded yet.', variant: 'error' })
      return
    }
    if (!siDrafts.length) {
      setToast({ message: t('createNeedAtLeastOneSi'), variant: 'error' })
      return
    }
    for (let i = 0; i < siDrafts.length; i += 1) {
      const err = validateSiDraftForCreate(siDrafts[i].form, lookups, planPreviewForSi, { requirePlanId: false })
      if (typeof err === 'string') {
        setToast({ message: t('createSiValidationError', { n: i + 1, message: err }), variant: 'error' })
        return
      }
    }
    const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
    const purposePid = parseInt(formPurposeId, 10)
    if (Number.isNaN(purposePid)) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return
    }
    const agentPidCreate = formAgentId.trim() ? parseInt(formAgentId, 10) : NaN
    const body = {
      vesselName: v,
      jettyId: Number.isNaN(jettyId) ? null : jettyId,
      eta: new Date(formEta).toISOString(),
      purposeId: purposePid,
      voyageNo: formVoyageNo.trim() || null,
      agentId: Number.isFinite(agentPidCreate) ? agentPidCreate : null,
    }
    try {
      const created = await createShipmentPlan(body)
      for (const d of siDrafts) {
        if ((d.form.documents || []).some((doc) => doc.documentId)) {
          try {
            await attachDraftSiDocuments({ draftKey: d.id, shipmentPlanId: created.id })
          } catch {
            /* non-fatal: plan and SIs still created */
          }
        }
      }
      const purposeRow = (lookups?.purposes || []).find((p) => Number(p.id) === Number(created.purposeId)) || null
      const linked = {
        id: created.id,
        vesselName: created.vesselName,
        purposeId: created.purposeId,
        purposeCode: purposeRow?.code ?? created.purposeCode ?? null,
        eta: created.eta,
        voyageNo: created.voyageNo,
        jettyId: created.jettyId,
        planReference: created.planReference,
        agentId: created.agentId != null ? Number(created.agentId) : null,
      }
      for (let i = 0; i < siDrafts.length; i += 1) {
        const validated = validateSiDraftForCreate(siDrafts[i].form, lookups, linked)
        if (typeof validated === 'string') {
          setToast({
            message: t('createPlanSavedSiFailed', { n: i + 1, message: validated, planRef: created.planReference || `#${created.id}` }),
            variant: 'error',
          })
          await loadList()
          return
        }
        const payload = buildSiCreateApiPayload(siDrafts[i].form, linked, validated)
        const saved = await createShippingInstruction(payload)
        logActivity({
          pageKey: 'shipment-plan',
          action: 'add',
          entityType: 'Shipping Instruction',
          entityLabel: saved.referenceNumber || `SI-${saved.id}`,
          details: { summary: `Created Draft SI ${i + 1}/${siDrafts.length} (new shipment plan)` },
        })
      }
      logActivity({
        pageKey: 'shipment-plan',
        action: 'add',
        entityType: 'ShipmentPlan',
        entityLabel: created.planReference || `Plan #${created.id}`,
        details: { summary: `Created shipment plan with ${siDrafts.length} shipping instruction(s)` },
      })
      setToast({ message: t('createPlanAndSisSuccess', { count: siDrafts.length }), variant: 'success' })
      handleCloseModal()
      await loadList()
    } catch (err) {
      setToast({ message: err?.message || 'Save failed', variant: 'error' })
    }
  }

  const addSiDraftBlock = () => {
    if (!lookups) return
    setSiDrafts((prev) => {
      let form = defaultSiDraftForPlanPreview(lookups, linkedPlanForSiCards)
      if (prev.length >= 1) {
        form = { ...form, documentDate: '' }
      } else if (prev.length === 0 && editingPlan && editingPlanDetail?.shippingInstructions?.[0]) {
        const ex = editingPlanDetail.shippingInstructions[0]
        form = {
          ...form,
          loadingPortId: ex.loadingPortId != null ? String(ex.loadingPortId) : '',
        }
      }
      return [...prev, { id: genSiDraftId(), form }]
    })
  }

  const removeSiDraftBlock = (index) => {
    setSiDrafts((prev) => {
      const block = prev[index]
      if (block && existingSiIdFromDraftKey(block.id)) return prev
      if (prev.length <= 1 && !editingPlan) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const setSiDraftForm = (index, updater) => {
    setSiDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index) return d
        const nextForm = typeof updater === 'function' ? updater(d.form) : { ...d.form, ...updater }
        return { ...d, form: nextForm }
      })
    )
  }

  const addSiDraftDocuments = async (index, e) => {
    e.preventDefault?.()
    e.stopPropagation?.()
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    let draftSnapshot = siDrafts[index]
    if (!draftSnapshot) {
      setToast({ message: t('createNeedAtLeastOneSi'), variant: 'error' })
      return
    }
    if (!lookups) {
      setToast({ message: t('siExtractLookupsMissing'), variant: 'error' })
      return
    }

    setSiDraftOcrIndex(index)
    try {
      await siDocExtract.handleFilesForDraft({
        files,
        form: draftSnapshot.form,
        setForm: (next) =>
          setSiDraftForm(index, (f) => (typeof next === 'function' ? next(f) : next)),
        draftKey: draftSnapshot.id,
        shipmentPlanId: linkedPlanForSiCards?.id ?? null,
        onToast: setToast,
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[addSiDraftDocuments]', err)
      setToast({
        message: err?.message || t('siExtractFailed'),
        variant: 'error',
      })
    } finally {
      setSiDraftOcrIndex(null)
    }
  }

  const removeSiDraftDocument = (index, docId) => {
    const doc = siDrafts[index]?.form?.documents?.find((d) => d.id === docId)
    if (doc?.documentId) {
      deleteSiDocument(doc.documentId).catch(() => {})
    }
    setSiDraftForm(index, (f) => ({ ...f, documents: (f.documents || []).filter((d) => d.id !== docId) }))
  }

  if (!canView('shipment-plan')) {
    return (
      <div className="shipping-instruction-page shipping-instruction-page--plans">
        <p className="text-steel" style={{ padding: '1rem' }}>
          {t('noPermission')}
        </p>
      </div>
    )
  }

  return (
    <div className="shipping-instruction-page shipping-instruction-page--plans">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : toast.variant === 'warning' ? '!' : '✓'}
          </span>
          <p className="si-toast__message">{toast.message}</p>
          <button type="button" className="si-toast__close" onClick={() => setToast(null)} aria-label={t('dismissNotification')}>
            ×
          </button>
        </div>
      )}

      <SiExtractConflictModal
        open={siDocExtract.conflictOpen}
        conflicts={siDocExtract.conflictList}
        warnings={siDocExtract.conflictWarnings}
        partialApply={siDocExtract.conflictPartialApply}
        onCancel={siDocExtract.cancelConflict}
        onApply={(keys) => siDocExtract.resolveConflict(keys)}
      />

      <header className="si-page-header">
        <div className="si-page-header__text">
          <h1 className="page-title">{t('pageTitle')}</h1>
          <p className="si-page-header__subtitle">{t('subtitle')}</p>
        </div>
        {canEdit('shipment-plan') && (
          <button type="button" className="btn btn--primary si-page-header__cta" onClick={openCreateModal}>
            {t('createNewPlan')}
          </button>
        )}
      </header>

      {listLoading && <p className="text-steel" style={{ padding: '0 1rem' }}>{t('listLoading')}</p>}

      <div className="si-summary-cards">
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🚢</span>
          <span className="si-summary-card__value">{summary.total.toLocaleString()}</span>
          <span className="si-summary-card__label">{t('totalPlans')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>📋</span>
          <span className="si-summary-card__value">{summary.draft}</span>
          <span className="si-summary-card__label">{t('draftPlans')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{summary.pending}</span>
          <span className="si-summary-card__label">{t('pendingPlanApproval')}</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon si-summary-card__icon--check" aria-hidden>✓</span>
          <span className="si-summary-card__value">{summary.approved}</span>
          <span className="si-summary-card__label">{t('approvedPlans')}</span>
        </div>
      </div>

      <div className="si-toolbar si-toolbar--actions-only">
        <div className="si-toolbar__actions">
          <button
            type="button"
            className={`btn btn--secondary si-toolbar__btn ${filtersOpen ? 'si-toolbar__btn--active' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            🔽 {t('filters')}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="si-filters-panel">
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterApproval')}</label>
            <select
              className="si-filters-panel__select"
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value)}
            >
              <option value="">{t('filterAll')}</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterVessel')}</label>
            <input
              type="search"
              className="si-filters-panel__select"
              value={vesselQ}
              onChange={(e) => setVesselQ(e.target.value)}
              placeholder={t('filterVessel')}
            />
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">{t('filterPanelPurpose')}</label>
            <select
              className="si-filters-panel__select"
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              disabled={!lookups?.purposes?.length}
            >
              <option value="">{t('filterAll')}</option>
              {(lookups?.purposes || []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label || p.code || `Purpose ${p.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="si-filters-panel__row si-filters-panel__row--reset">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setApprovalFilter('')
                setPurposeFilter('')
                setVesselQ('')
              }}
            >
              {t('reset')}
            </button>
          </div>
        </div>
      )}

      <section className="card" style={{ marginTop: 'var(--spacing-3)' }}>
        <h2 className="card__title">{t('tableSectionTitle')}</h2>
        <div className="table-wrap shipping-instruction-table-desktop">
          <table className="data-table shipping-instruction-table">
            <thead>
              <tr>
                <th scope="col" className="si-table__col-actions shipping-instruction-table__th--actions">
                  {t('colActions')}
                </th>
                <th className="shipping-instruction-table__th">{t('colPlanRef')}</th>
                <th className="shipping-instruction-table__th">{t('colVessel')}</th>
                <th className="shipping-instruction-table__th">{t('colSiRefs')}</th>
                <th className="shipping-instruction-table__th">{t('colCommodityQty')}</th>
                <th className="shipping-instruction-table__th">{t('colPurpose')}</th>
                <th className="shipping-instruction-table__th">{t('colApproval')}</th>
                <th className="shipping-instruction-table__th">{t('colJetty')}</th>
                <th className="shipping-instruction-table__th">{t('colEta')}</th>
              </tr>
              <tr className="shipping-instruction-table__filter-row">
                <th className="si-table__col-actions" aria-hidden />
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.planRef}
                    onChange={(e) => setTableFilters((f) => ({ ...f, planRef: e.target.value }))}
                    aria-label={t('filterPlanRef')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.vessel}
                    onChange={(e) => setTableFilters((f) => ({ ...f, vessel: e.target.value }))}
                    aria-label={t('filterVessel')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.siRefs}
                    onChange={(e) => setTableFilters((f) => ({ ...f, siRefs: e.target.value }))}
                    aria-label={t('filterSiRefs')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.commodityQty}
                    onChange={(e) => setTableFilters((f) => ({ ...f, commodityQty: e.target.value }))}
                    aria-label={t('filterCommodityQty')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.purpose}
                    onChange={(e) => setTableFilters((f) => ({ ...f, purpose: e.target.value }))}
                    aria-label={t('filterPlanPurpose')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.approval}
                    onChange={(e) => setTableFilters((f) => ({ ...f, approval: e.target.value }))}
                    aria-label={t('filterApproval')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.jetty}
                    onChange={(e) => setTableFilters((f) => ({ ...f, jetty: e.target.value }))}
                    aria-label={t('filterJetty')}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="shipping-instruction-table__filter"
                    placeholder={t('filterPlaceholderShort')}
                    value={tableFilters.eta}
                    onChange={(e) => setTableFilters((f) => ({ ...f, eta: e.target.value }))}
                    aria-label={t('filterEta')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedFilteredPlans.map((row) => (
                <tr key={row.id} className="shipping-instruction-table__row">
                  <td className="si-table__col-actions" onClick={(e) => e.stopPropagation()}>
                    <ShipmentPlanRowActions
                      plan={row}
                      canEdit={canEdit('shipment-plan')}
                      canApprove={canApprove('shipment-plan')}
                      canDelete={canDelete('shipment-plan')}
                      canView={canView('shipment-plan')}
                      onEdit={() => openEditModal(row)}
                      onSubmit={async () => {
                        try {
                          await submitShipmentPlan(row.id)
                          setToast({ message: t('submitPlanSuccess'), variant: 'success' })
                          await loadList()
                        } catch (err) {
                          setToast({ message: err?.message || t('submitPlanFailed'), variant: 'error' })
                        }
                      }}
                      onOpenApproval={() => navigate(`/shipment-plans/approval/${row.id}`)}
                      onViewHub={() => openViewModal(row)}
                      onDelete={() => {
                        const label = row.planReference || `Plan #${row.id}`
                        if (!window.confirm(t('deletePlanConfirm', { label }))) return
                        void (async () => {
                          try {
                            await deleteShipmentPlan(row.id)
                            setToast({ message: t('deletePlanSuccess'), variant: 'success' })
                            await loadList()
                          } catch (err) {
                            setToast({ message: err?.message || t('deletePlanFailed'), variant: 'error' })
                          }
                        })()
                      }}
                    />
                  </td>
                  <td>{row.planReference || `Plan #${row.id}`}</td>
                  <td>{row.vesselName}</td>
                  <td>
                    {(row.shippingInstructions || []).length ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          alignItems: 'flex-start',
                        }}
                      >
                        {(row.shippingInstructions || []).map((si) => (
                          <a
                            key={si.id}
                            href="#"
                            className="link"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSiDocumentModalId(si.id)
                            }}
                          >
                            {si.referenceNumber || `SI-${si.id}`}
                          </a>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {(row.shippingInstructions || []).length ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          alignItems: 'flex-start',
                        }}
                      >
                        {(row.shippingInstructions || []).map((si) => (
                          <span key={`qty-${si.id}`} className="si-cargo-qty-cell">
                            {si.commodityQtyDisplay || '—'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <PurposeBadge purpose={row.purposeCode} />
                  </td>
                  <td>
                    <span className={approvalBadgeClass(row.approvalStatus)}>{row.approvalStatus}</span>
                  </td>
                  <td>{row.jettyName || '—'}</td>
                  <td>{formatEta(row.eta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredPlans.length > 0 && (
          <div
            className="shipment-plans-list__pagination"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginTop: 'var(--spacing-3)',
            }}
          >
            <p className="text-steel" style={{ margin: 0, fontSize: '0.9rem' }}>
              {t('paginationShowing', {
                from: plansPaginationRange.from,
                to: plansPaginationRange.to,
                total: filteredPlans.length,
              })}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={plansListPage <= 1}
                onClick={() => setPlansListPage((p) => Math.max(1, p - 1))}
              >
                {t('paginationPrev')}
              </button>
              <span className="text-steel" style={{ fontSize: '0.9rem' }}>
                {t('paginationPageOf', { page: plansListPage, totalPages: plansListTotalPages })}
              </span>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={plansListPage >= plansListTotalPages}
                onClick={() => setPlansListPage((p) => Math.min(plansListTotalPages, p + 1))}
              >
                {t('paginationNext')}
              </button>
            </div>
          </div>
        )}
      </section>

      <SiDocumentModal
        isOpen={siDocumentModalId != null}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
        allowPreApprovalPreview
      />

      {isFormOpen && (
        <div className="modal-overlay" onClick={handleCloseModal} aria-hidden="true">
          <div
            className="modal modal--wide modal--shipment-plan-form"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal__title">
              {formModalMode === 'view'
                ? t('modalViewCombinedTitle', {
                    ref: editingPlan?.planReference || editingPlanDetail?.planReference || `Plan #${editingPlan?.id}`,
                  })
                : editingPlan
                  ? t('modalEditTitle', { id: editingPlan.id })
                  : t('modalCreateCombinedTitle')}
            </h2>
            <form
              onSubmit={(e) => {
                if (formModalMode === 'view') {
                  e.preventDefault()
                  return
                }
                if (editingPlan) handleSavePlan(e)
                else handleCreatePlanAndSis(e)
              }}
              className="shipping-instruction-form"
            >
              <fieldset disabled={formModalMode === 'view' || modalSiLoading} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">{t('createPlanSectionTitle')}</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="sp-purpose">{t('formPlanPurposeRequired')}</label>
                    <select
                      id="sp-purpose"
                      value={formPurposeId}
                      onChange={(e) => setFormPurposeId(e.target.value)}
                      required
                      disabled={!lookups}
                    >
                      <option value="">—</option>
                      {(lookups?.purposes || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="sp-vessel">{t('formVesselRequired')}</label>
                    <input
                      id="sp-vessel"
                      maxLength={MAX_SI_VESSEL_NAME_CHARS}
                      value={formVessel}
                      onChange={(e) => setFormVessel(e.target.value)}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="sp-jetty">{t('formJettyOptional')}</label>
                    <select id="sp-jetty" value={formJettyId} onChange={(e) => setFormJettyId(e.target.value)}>
                      <option value="">—</option>
                      {(lookups?.jetties || []).map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.label || j.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="sp-eta">{t('formEtaRequiredLabel')}</label>
                    <input id="sp-eta" type="datetime-local" value={formEta} onChange={(e) => setFormEta(e.target.value)} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="sp-voyage">{t('formVoyageOptional')}</label>
                    <input
                      id="sp-voyage"
                      maxLength={MAX_SI_VOYAGE_CHARS}
                      value={formVoyageNo}
                      onChange={(e) => setFormVoyageNo(e.target.value)}
                      placeholder={t('formVoyagePlaceholder')}
                    />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="sp-agent">{t('formAgentOptional')}</label>
                    <select id="sp-agent" value={formAgentId} onChange={(e) => setFormAgentId(e.target.value)} disabled={!lookups}>
                      <option value="">—</option>
                      {(lookups?.agents || []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label || a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {(formModalMode === 'view' || formModalMode === 'edit' || !editingPlan) && (
                <div className="shipping-instruction-form__section" style={{ marginTop: '1.25rem' }}>
                  <h3 className="shipping-instruction-form__section-title">{t('createSiSectionTitle')}</h3>
                  {formModalMode !== 'view' && (
                    <p className="text-steel" style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                      {t('createSiSectionHint')}
                    </p>
                  )}
                  {(formModalMode === 'view' || formModalMode === 'edit') && modalSiLoading && (
                    <p className="text-steel" style={{ marginBottom: '1rem' }}>
                      {t('viewPlanSiListLoading')}
                    </p>
                  )}
                  {(formModalMode === 'view' || formModalMode === 'edit') &&
                    !modalSiLoading &&
                    siDrafts.length === 0 &&
                    editingPlanDetail &&
                    !(editingPlanDetail.shippingInstructions?.length) && (
                    <p className="text-steel" style={{ marginBottom: '1rem' }}>
                      {t('editPlanSiListEmpty')}
                    </p>
                  )}
                  {siDrafts.map((block, index) => (
                    <div
                      key={block.id}
                      className="shipping-instruction-form__section"
                      style={{
                        border: '1px solid var(--color-border, #c9d1d9)',
                        borderRadius: 8,
                        padding: '1rem',
                        marginBottom: '1rem',
                        background: 'var(--color-surface-muted, rgba(0,0,0,0.02))',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <h4 style={{ margin: 0, fontSize: '1rem' }}>{t('createSiBlockTitle', { n: index + 1 })}</h4>
                        {formModalMode !== 'view' &&
                          siDrafts.length > 1 &&
                          !existingSiIdFromDraftKey(block.id) && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => removeSiDraftBlock(index)}
                          >
                            {t('deleteSiBlock')}
                          </button>
                        )}
                      </div>
                      {formModalMode !== 'view' && (
                        <>
                      <ShippingInstructionDocumentUploadSection
                        documents={block.form.documents || []}
                        onAddFiles={(ev) => addSiDraftDocuments(index, ev)}
                        onRemove={(id) => removeSiDraftDocument(index, id)}
                        idPrefix={`sp-si-${index}-`}
                        extractBusy={siDocExtract.extractBusy && siDraftOcrIndex === index}
                      />
                      <SiExtractResultPanel
                        report={siDocExtract.getReport(block.id)}
                        onDismiss={() => siDocExtract.clearReport(block.id)}
                      />
                        </>
                      )}
                      <ShippingInstructionSiLinkedFields
                        lookups={lookups}
                        linkedPlan={linkedPlanForSiCards}
                        form={block.form}
                        setForm={(u) => setSiDraftForm(index, u)}
                        npwpMaster={npwpMaster}
                        idPrefix={`sp-si-${index}-`}
                        showPlanLinkedNote={false}
                        omitVesselAndJetty
                        omitDocumentUpload
                      />
                    </div>
                  ))}
                  {formModalMode !== 'view' && (
                    <button type="button" className="btn btn--secondary" onClick={addSiDraftBlock} disabled={!lookups}>
                      {t('addAnotherSi')}
                    </button>
                  )}
                </div>
              )}

              </fieldset>

              <div className="modal__footer">
                {formModalMode === 'view' ? (
                  <button type="button" className="btn btn--primary" onClick={handleCloseModal}>
                    {t('close')}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn--secondary" onClick={handleCloseModal}>
                      {t('cancel')}
                    </button>
                    <button type="submit" className="btn btn--primary">
                  {editingPlan
                    ? siDrafts.length > 0
                      ? t('editSaveCombined', { count: siDrafts.length })
                      : t('save')
                    : t('createPlanAndSisSubmit', { count: siDrafts.length || 1 })}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
