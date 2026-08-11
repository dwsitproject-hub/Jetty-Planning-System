import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchShipmentPlan,
  createShipmentPlan,
  updateShipmentPlan,
} from '../api/shipmentPlans'
import {
  createShippingInstruction,
  fetchShippingInstruction,
  fetchSiNpwpMaster,
  updateShippingInstruction,
} from '../api/shippingInstructions'
import { attachDraftSiDocuments, deleteSiDocument } from '../api/siDocuments'
import { fetchSiLookups } from '../api/siLookups'
import {
  computeShipmentPlanJettyAdvice,
  validateJettyAdviceSelection,
} from '../utils/jettyAdvice'
import FormLabelWithInfo from './FormLabelWithInfo'
import ShippingInstructionSiLinkedFields from './ShippingInstructionSiLinkedFields'
import ShippingInstructionDocumentUploadSection from './ShippingInstructionDocumentUploadSection'
import {
  defaultSiDraftForPlanPreview,
  planEtaYmd,
  siDetailToPlanLinkedDraftForm,
  existingSiIdFromDraftKey,
  validateSiDraftForCreate,
  buildSiCreateApiPayload,
  buildSiUpdateApiPayload,
} from '../utils/siPlanLinkedDraft'
import { useSiDocumentExtract } from '../hooks/useSiDocumentExtract'
import SiExtractConflictModal from './SiExtractConflictModal'
import SiExtractResultPanel from './SiExtractResultPanel'
import { MAX_SI_VESSEL_NAME_CHARS, MAX_SI_VOYAGE_CHARS } from '../constants/inputLimits'
import { sumBreakdownMtTotal, breakdownHasUnconvertedKl } from '../utils/planCargoMtTotal'
import '../styles/shipping-instruction.css'

/** Required positive number (LOA, GT, draft). */
function isValidPositiveNumber(raw) {
  if (raw == null || String(raw).trim() === '') return false
  const n = Number(raw)
  return Number.isFinite(n) && n > 0
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

/**
 * Combined shipment plan + SI form modal (create, edit, view, pre-berth edit).
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onSaved?: (result?: { planReopened?: boolean, vesselName?: string, siDrafts?: object[] }) => void,
 *   mode: 'create' | 'edit' | 'view' | 'preBerthEdit',
 *   planRow?: object|null,
 *   planId?: number|null,
 *   occupancyRows?: object[],
 *   logActivity?: (entry: object) => void,
 * }} props
 */
export default function ShipmentPlanCombinedFormModal({
  isOpen,
  onClose,
  onSaved,
  mode,
  planRow = null,
  planId = null,
  occupancyRows = [],
  logActivity,
}) {
  const { t } = useTranslation('shipmentPlan')
  const [toast, setToast] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [modalSiLoading, setModalSiLoading] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [formVessel, setFormVessel] = useState('')
  const [formVesselLoa, setFormVesselLoa] = useState('')
  const [formVesselGt, setFormVesselGt] = useState('')
  const [formVesselDraft, setFormVesselDraft] = useState('')
  const [formJettyId, setFormJettyId] = useState('')
  const [formEta, setFormEta] = useState('')
  const [formPurposeId, setFormPurposeId] = useState('')
  const [formVoyageNo, setFormVoyageNo] = useState('')
  const [formAgentId, setFormAgentId] = useState('')
  const [siDrafts, setSiDrafts] = useState([])
  const [npwpMaster, setNpwpMaster] = useState(null)
  const [editingPlanDetail, setEditingPlanDetail] = useState(null)
  const [siDraftOcrIndex, setSiDraftOcrIndex] = useState(null)
  const loadGenerationRef = useRef(0)

  const isViewMode = mode === 'view'
  const isPreBerthEdit = mode === 'preBerthEdit'
  const isEditLike = mode === 'edit' || isPreBerthEdit
  const showSiUpload = !isViewMode && !isPreBerthEdit
  const showAddAnotherSi = !isViewMode && !isPreBerthEdit

  const resetFormState = useCallback(() => {
    setToast(null)
    setModalSiLoading(false)
    setEditingPlan(null)
    setFormVessel('')
    setFormVesselLoa('')
    setFormVesselGt('')
    setFormVesselDraft('')
    setFormJettyId('')
    setFormEta('')
    setFormPurposeId('')
    setFormVoyageNo('')
    setFormAgentId('')
    setSiDrafts([])
    setNpwpMaster(null)
    setEditingPlanDetail(null)
    setSiDraftOcrIndex(null)
  }, [])

  const handleClose = useCallback(() => {
    resetFormState()
    onClose()
  }, [onClose, resetFormState])

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
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(id)
  }, [toast])

  const applyPlanDetailToFormFields = useCallback((d, row) => {
    setFormVessel(d.vesselName || row?.vesselName || '')
    setFormVesselLoa(
      d.vesselLoaM != null ? String(d.vesselLoaM) : row?.vesselLoaM != null ? String(row.vesselLoaM) : ''
    )
    setFormVesselGt(
      d.vesselGrossTonnage != null
        ? String(d.vesselGrossTonnage)
        : row?.vesselGrossTonnage != null
          ? String(row.vesselGrossTonnage)
          : ''
    )
    setFormVesselDraft(
      d.vesselDraft != null ? String(d.vesselDraft) : row?.vesselDraft != null ? String(row.vesselDraft) : ''
    )
    setFormJettyId(d.jettyId != null ? String(d.jettyId) : '')
    setFormEta(toDateTimeLocalValue(d.eta ?? row?.eta))
    setFormPurposeId(d.purposeId != null ? String(d.purposeId) : '')
    setFormVoyageNo(d.voyageNo || '')
    setFormAgentId(d.agentId != null ? String(d.agentId) : '')
  }, [])

  const buildSiDraftsFromPlanDetail = useCallback(
    async (d, row, lk) => {
      const children = d.shippingInstructions || []
      if (!children.length || !lk) return []
      const purposeRow = (lk?.purposes || []).find((p) => Number(p.id) === Number(d.purposeId)) || null
      const linked = {
        id: d.id,
        vesselName: d.vesselName,
        vesselCapacity: d.vesselCapacity != null ? Number(d.vesselCapacity) : null,
        cargoTotalMt: d.vesselCapacity != null ? Number(d.vesselCapacity) : null,
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
        form: siDetailToPlanLinkedDraftForm(si, lk, linked),
        existingStatus: si.status || 'Draft',
      }))
    },
    []
  )

  useEffect(() => {
    if (!isOpen) {
      resetFormState()
      loadGenerationRef.current += 1
      return
    }

    let cancelled = false
    fetchSiLookups()
      .then((data) => {
        if (!cancelled) setLookups(data)
      })
      .catch(() => {
        if (!cancelled) setLookups(null)
      })

    if (mode === 'create') {
      setEditingPlan(null)
      setEditingPlanDetail(null)
      setSiDrafts([])
      return () => {
        cancelled = true
      }
    }

    const resolvedId = planRow?.id ?? planId
    if (resolvedId == null || !Number.isFinite(Number(resolvedId))) {
      return () => {
        cancelled = true
      }
    }

    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    setModalSiLoading(true)
    setSiDrafts([])
    setEditingPlanDetail(null)

    const row = planRow || {
      id: resolvedId,
      vesselName: '',
      jettyId: null,
      eta: null,
      purposeId: null,
      purposeCode: null,
      planReference: null,
      voyageNo: null,
      approvalStatus: null,
      agentId: null,
    }
    setEditingPlan(row)
    setFormVessel(row.vesselName || '')
    setFormVesselLoa(row.vesselLoaM != null ? String(row.vesselLoaM) : '')
    setFormVesselGt(row.vesselGrossTonnage != null ? String(row.vesselGrossTonnage) : '')
    setFormVesselDraft(row.vesselDraft != null ? String(row.vesselDraft) : '')
    setFormJettyId(row.jettyId != null ? String(row.jettyId) : '')
    setFormEta(toDateTimeLocalValue(row.eta))
    setFormPurposeId(row.purposeId != null ? String(row.purposeId) : '')
    setFormVoyageNo(row.voyageNo || '')
    setFormAgentId(row.agentId != null ? String(row.agentId) : '')

    ;(async () => {
      try {
        const [d, lk] = await Promise.all([
          fetchShipmentPlan(resolvedId),
          fetchSiLookups(),
        ])
        if (cancelled || loadGenerationRef.current !== generation) return
        setLookups(lk)
        const planRowMerged = {
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
          vesselLoaM: d.vesselLoaM,
          vesselGrossTonnage: d.vesselGrossTonnage,
          vesselDraft: d.vesselDraft,
        }
        setEditingPlan(planRowMerged)
        setEditingPlanDetail(d)
        applyPlanDetailToFormFields(d, planRowMerged)
        const drafts = await buildSiDraftsFromPlanDetail(d, planRowMerged, lk)
        if (!cancelled && loadGenerationRef.current === generation && drafts.length) {
          setSiDrafts(drafts)
        }
      } catch {
        if (!cancelled && loadGenerationRef.current === generation) {
          setEditingPlanDetail(null)
          setToast({ message: t('listLoading'), variant: 'error' })
        }
      } finally {
        if (!cancelled && loadGenerationRef.current === generation) {
          setModalSiLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    isOpen,
    mode,
    planRow,
    planId,
    applyPlanDetailToFormFields,
    buildSiDraftsFromPlanDetail,
    resetFormState,
    t,
  ])

  const totalCargoMtFromDrafts = useMemo(
    () => sumBreakdownMtTotal(siDrafts.map((d) => d.form), lookups),
    [siDrafts, lookups]
  )

  const totalCargoMt = useMemo(() => {
    if (totalCargoMtFromDrafts > 0) return totalCargoMtFromDrafts
    const stored = editingPlanDetail?.vesselCapacity ?? editingPlan?.vesselCapacity
    if (stored != null && Number(stored) > 0) return Number(stored)
    return 0
  }, [totalCargoMtFromDrafts, editingPlan, editingPlanDetail])

  const cargoUnconvertedKlNote = useMemo(
    () => breakdownHasUnconvertedKl(siDrafts.map((d) => d.form), lookups),
    [siDrafts, lookups]
  )

  const planPreviewForSi = useMemo(() => {
    const etaDate = formEta?.trim() ? new Date(formEta) : null
    const etaIso = etaDate && !isNaN(etaDate.getTime()) ? etaDate.toISOString() : null
    const purposePid = formPurposeId ? parseInt(formPurposeId, 10) : null
    const pr = (lookups?.purposes || []).find((p) => String(p.id) === String(formPurposeId)) || null
    const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
    const agentPid = formAgentId ? parseInt(formAgentId, 10) : null
    return {
      vesselName: formVessel.trim(),
      vesselCapacity: totalCargoMt > 0 ? totalCargoMt : null,
      cargoTotalMt: totalCargoMt > 0 ? totalCargoMt : null,
      purposeId: Number.isFinite(purposePid) ? purposePid : null,
      purposeCode: pr?.code ?? null,
      eta: etaIso,
      voyageNo: formVoyageNo.trim() || null,
      jettyId: Number.isFinite(jettyId) ? jettyId : null,
      planReference: null,
      id: undefined,
      agentId: Number.isFinite(agentPid) ? agentPid : null,
    }
  }, [formVessel, totalCargoMt, formEta, formPurposeId, formJettyId, formVoyageNo, formAgentId, lookups])

  const vesselDwtComputed = useMemo(() => {
    const gt = Number(formVesselGt)
    if (!Number.isFinite(gt) || gt <= 0 || totalCargoMt <= 0) return null
    return gt + totalCargoMt
  }, [formVesselGt, totalCargoMt])

  const jettyAdvice = useMemo(
    () =>
      computeShipmentPlanJettyAdvice({
        jetties: lookups?.jetties,
        list: occupancyRows,
        formVesselLoa,
        vesselDwtComputed,
        formEta,
        formPurposeId,
        lookups,
        editingPlan,
        siDrafts,
      }),
    [lookups, occupancyRows, formVesselLoa, vesselDwtComputed, formEta, formPurposeId, editingPlan, siDrafts]
  )

  const validateJettySelection = () => {
    const result = validateJettyAdviceSelection({
      jettyAdvice,
      selectedJettyId: formJettyId,
      jetties: lookups?.jetties,
      ctx: { loa: formVesselLoa, dwt: vesselDwtComputed },
      t,
    })
    if (!result.ok) {
      setToast({ message: result.message, variant: 'error' })
      return false
    }
    return true
  }

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

  const createModalPurposeIsLoading = useMemo(() => {
    const p = (lookups?.purposes || []).find((x) => String(x.id) === String(formPurposeId))
    return p?.code === 'Loading'
  }, [lookups, formPurposeId])

  useEffect(() => {
    if (!isOpen || !createModalPurposeIsLoading) {
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
  }, [isOpen, createModalPurposeIsLoading])

  useEffect(() => {
    if (
      (mode !== 'view' && mode !== 'edit' && mode !== 'preBerthEdit') ||
      !isOpen ||
      !lookups ||
      !editingPlanDetail ||
      siDrafts.length > 0
    ) {
      return
    }
    const children = editingPlanDetail.shippingInstructions || []
    if (!children.length) return
    let cancelled = false
    setModalSiLoading(true)
    ;(async () => {
      try {
        const drafts = await buildSiDraftsFromPlanDetail(editingPlanDetail, editingPlan, lookups)
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
  }, [mode, isOpen, lookups, editingPlanDetail, editingPlan, siDrafts.length, buildSiDraftsFromPlanDetail, t])

  useEffect(() => {
    if (!isOpen || isViewMode || !lookups || siDocExtract.extractBusy) return
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
  }, [isOpen, isViewMode, lookups, planPreviewForSi, siDocExtract.extractBusy])

  const validateVesselDimensionFields = () => {
    const dims = [
      [t('formVesselLoaRequired'), formVesselLoa],
      [t('formVesselGtRequired'), formVesselGt],
      [t('formVesselDraftRequired'), formVesselDraft],
    ]
    for (const [label, raw] of dims) {
      if (!isValidPositiveNumber(raw)) {
        setToast({ message: t('formVesselNumberFieldInvalid', { field: label }), variant: 'error' })
        return false
      }
    }
    return true
  }

  const validateCreatePlanFields = () => {
    if (!formVessel.trim()) {
      setToast({ message: t('formVesselRequired'), variant: 'error' })
      return false
    }
    if (!validateVesselDimensionFields()) return false
    if (!validateJettySelection()) return false
    if (!formEta?.trim()) {
      setToast({ message: t('formEtaRequired'), variant: 'error' })
      return false
    }
    if (!formPurposeId) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return false
    }
    const purposePid = parseInt(formPurposeId, 10)
    if (Number.isNaN(purposePid)) {
      setToast({ message: t('formPurposeRequired'), variant: 'error' })
      return false
    }
    if (!lookups) {
      setToast({ message: 'Form options not loaded yet.', variant: 'error' })
      return false
    }
    return true
  }

  const buildCreatePlanBody = () => {
    const jettyId = formJettyId ? parseInt(formJettyId, 10) : null
    const purposePid = parseInt(formPurposeId, 10)
    const agentPidCreate = formAgentId.trim() ? parseInt(formAgentId, 10) : NaN
    return {
      vesselName: formVessel.trim(),
      vesselCapacity: totalCargoMt > 0 ? totalCargoMt : null,
      vesselLoaM: Number(formVesselLoa),
      vesselGrossTonnage: Number(formVesselGt),
      vesselDraft: Number(formVesselDraft),
      jettyId: Number.isNaN(jettyId) ? null : jettyId,
      eta: new Date(formEta).toISOString(),
      purposeId: purposePid,
      voyageNo: formVoyageNo.trim() || null,
      agentId: Number.isFinite(agentPidCreate) ? agentPidCreate : null,
    }
  }

  const handleSavePlan = async (e) => {
    e.preventDefault()
    if (!editingPlan) return
    const v = formVessel.trim()
    if (!v) {
      setToast({ message: t('formVesselRequired'), variant: 'error' })
      return
    }
    if (!validateVesselDimensionFields()) return
    if (!validateJettySelection()) return
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
        vesselCapacity: totalCargoMt > 0 ? totalCargoMt : null,
        vesselLoaM: Number(formVesselLoa),
        vesselGrossTonnage: Number(formVesselGt),
        vesselDraft: Number(formVesselDraft),
        jettyId: Number.isNaN(jettyId) ? null : jettyId,
        eta: etaIso,
        purposeId: purposePid,
        voyageNo: formVoyageNo.trim() || null,
        agentId: Number.isFinite(agentPidSave) ? agentPidSave : null,
      })
      let updatedSiCount = 0
      let createdSiCount = 0
      let planReopened = false
      if (lookups && siDrafts.length > 0) {
        const purposeRow = (lookups?.purposes || []).find((p) => Number(p.id) === purposePid) || null
        const linked = {
          id: editingPlan.id,
          vesselName: v,
          vesselCapacity: totalCargoMt > 0 ? totalCargoMt : null,
          cargoTotalMt: totalCargoMt > 0 ? totalCargoMt : null,
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
            onSaved?.()
            return
          }
          const existingId = existingSiIdFromDraftKey(siDrafts[i].id)
          if (existingId) {
            const updatePayload = buildSiUpdateApiPayload(siDrafts[i].form, linked, validated)
            updatePayload.status = siDrafts[i].existingStatus || 'Draft'
            const saved = await updateShippingInstruction(existingId, updatePayload)
            if (saved?.planReopened) planReopened = true
            updatedSiCount += 1
            logActivity?.({
              pageKey: 'shipment-plan',
              action: 'update',
              entityType: 'Shipping Instruction',
              entityLabel: saved.referenceNumber || `SI-${saved.id}`,
              details: { summary: `Updated SI on plan ${editingPlan.planReference || editingPlan.id} (edit modal)` },
            })
          } else if (!isPreBerthEdit) {
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
            logActivity?.({
              pageKey: 'shipment-plan',
              action: 'add',
              entityType: 'Shipping Instruction',
              entityLabel: saved.referenceNumber || `SI-${saved.id}`,
              details: { summary: `Added SI to plan ${editingPlan.planReference || editingPlan.id} (edit modal)` },
            })
          }
        }
      }
      logActivity?.({
        pageKey: 'shipment-plan',
        action: 'update',
        entityType: 'ShipmentPlan',
        entityLabel: editingPlan.planReference || `Plan #${editingPlan.id}`,
        details: { summary: isPreBerthEdit ? 'Updated shipment plan (pre-berth)' : 'Updated shipment plan' },
      })
      if (isPreBerthEdit) {
        onSaved?.({ planReopened, vesselName: v, siDrafts })
        handleClose()
        return
      }
      let successMessage = t('editPlanSaved')
      if (updatedSiCount > 0 && createdSiCount > 0) {
        successMessage = t('editPlanSavedUpdatedAndCreated', { updated: updatedSiCount, created: createdSiCount })
      } else if (updatedSiCount > 0) {
        successMessage = t('editPlanSavedUpdatedSis', { count: updatedSiCount })
      } else if (createdSiCount > 0) {
        successMessage = t('editPlanSavedWithNewSis', { count: createdSiCount })
      }
      onSaved?.({ toast: { message: successMessage, variant: 'success' } })
      handleClose()
    } catch (err) {
      setToast({ message: err?.message || 'Save failed', variant: 'error' })
    }
  }

  const handleCreatePlanOnly = async (e) => {
    e.preventDefault()
    if (!validateCreatePlanFields()) return
    try {
      const created = await createShipmentPlan(buildCreatePlanBody())
      logActivity?.({
        pageKey: 'shipment-plan',
        action: 'add',
        entityType: 'ShipmentPlan',
        entityLabel: created.planReference || `Plan #${created.id}`,
        details: { summary: 'Created shipment plan (no SI yet — late SI)' },
      })
      onSaved?.({ toast: { message: t('createPlanOnlySuccess'), variant: 'success' } })
      handleClose()
    } catch (err) {
      setToast({ message: err?.message || 'Save failed', variant: 'error' })
    }
  }

  const handleCreatePlanAndSis = async (e) => {
    e.preventDefault()
    if (!validateCreatePlanFields()) return
    for (let i = 0; i < siDrafts.length; i += 1) {
      const err = validateSiDraftForCreate(siDrafts[i].form, lookups, planPreviewForSi, { requirePlanId: false })
      if (typeof err === 'string') {
        setToast({ message: t('createSiValidationError', { n: i + 1, message: err }), variant: 'error' })
        return
      }
    }
    try {
      const created = await createShipmentPlan(buildCreatePlanBody())
      for (const d of siDrafts) {
        if ((d.form.documents || []).some((doc) => doc.documentId)) {
          try {
            await attachDraftSiDocuments({ draftKey: d.id, shipmentPlanId: created.id })
          } catch {
            /* non-fatal */
          }
        }
      }
      const purposeRow = (lookups?.purposes || []).find((p) => Number(p.id) === Number(created.purposeId)) || null
      const linked = {
        id: created.id,
        vesselName: created.vesselName,
        vesselCapacity: created.vesselCapacity != null ? Number(created.vesselCapacity) : null,
        cargoTotalMt: created.vesselCapacity != null ? Number(created.vesselCapacity) : null,
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
          onSaved?.()
          return
        }
        const payload = buildSiCreateApiPayload(siDrafts[i].form, linked, validated)
        const saved = await createShippingInstruction(payload)
        logActivity?.({
          pageKey: 'shipment-plan',
          action: 'add',
          entityType: 'Shipping Instruction',
          entityLabel: saved.referenceNumber || `SI-${saved.id}`,
          details: { summary: `Created Draft SI ${i + 1}/${siDrafts.length} (new shipment plan)` },
        })
      }
      logActivity?.({
        pageKey: 'shipment-plan',
        action: 'add',
        entityType: 'ShipmentPlan',
        entityLabel: created.planReference || `Plan #${created.id}`,
        details: { summary: `Created shipment plan with ${siDrafts.length} shipping instruction(s)` },
      })
      onSaved?.({ toast: { message: t('createPlanAndSisSuccess', { count: siDrafts.length }), variant: 'success' } })
      handleClose()
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

    const draftSnapshot = siDrafts[index]
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

  const modalTitle = useMemo(() => {
    if (isPreBerthEdit) return t('preBerthEditPlanTitle')
    if (isViewMode) {
      return t('modalViewCombinedTitle', {
        ref: editingPlan?.planReference || editingPlanDetail?.planReference || `Plan #${editingPlan?.id}`,
      })
    }
    if (editingPlan) return t('modalEditTitle', { id: editingPlan.id })
    return t('modalCreateCombinedTitle')
  }, [isPreBerthEdit, isViewMode, editingPlan, editingPlanDetail, t])

  const submitLabel = useMemo(() => {
    if (isPreBerthEdit) {
      return siDrafts.length > 0 ? t('editSaveCombined', { count: siDrafts.length }) : t('save')
    }
    if (editingPlan) {
      return siDrafts.length > 0 ? t('editSaveCombined', { count: siDrafts.length }) : t('save')
    }
    return siDrafts.length > 0 ? t('createPlanAndSisSubmit', { count: siDrafts.length }) : t('createPlanOnlySubmit')
  }, [isPreBerthEdit, editingPlan, siDrafts.length, t])

  const showSiSection = isViewMode || isEditLike || !editingPlan

  if (!isOpen) return null

  return (
    <>
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

      <div className="modal-overlay" onClick={handleClose} aria-hidden="true">
        <div
          className="modal modal--wide modal--shipment-plan-form"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shipment-plan-combined-form-title"
        >
          <div className="modal__header">
            <div>
              <h2 id="shipment-plan-combined-form-title" className="modal__title modal__title--flush">
                {modalTitle}
              </h2>
              {isPreBerthEdit && (
                <p className="shipment-plan-form__pre-berth-hint text-steel" style={{ marginTop: '0.5rem' }}>
                  {t('preBerthEditPlanHint')}
                </p>
              )}
            </div>
            <button
              type="button"
              className="modal__close"
              onClick={handleClose}
              aria-label={t('close')}
            >
              ×
            </button>
          </div>
          <form
            onSubmit={(e) => {
              if (isViewMode) {
                e.preventDefault()
                return
              }
              if (editingPlan) handleSavePlan(e)
              else if (siDrafts.length === 0) handleCreatePlanOnly(e)
              else handleCreatePlanAndSis(e)
            }}
            className="shipping-instruction-form shipping-instruction-form--plan-modal"
          >
            <fieldset disabled={isViewMode || modalSiLoading} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="shipping-instruction-form__section shipment-plan-form__plan-section">
                <h3 className="shipping-instruction-form__section-title">{t('createPlanSectionTitle')}</h3>
                <div className="shipping-instruction-form__grid shipment-plan-form__plan-grid">
                  <div className="input-group shipment-plan-form__purpose">
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
                  <div className="input-group shipment-plan-form__vessel">
                    <label htmlFor="sp-vessel">{t('formVesselRequired')}</label>
                    <input
                      id="sp-vessel"
                      maxLength={MAX_SI_VESSEL_NAME_CHARS}
                      value={formVessel}
                      onChange={(e) => setFormVessel(e.target.value)}
                      required
                    />
                  </div>
                  <div className="shipment-plan-form__vessel-specs">
                    <div className="input-group">
                      <label htmlFor="sp-vessel-loa">{t('formVesselLoaRequired')}</label>
                      <input
                        id="sp-vessel-loa"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={formVesselLoa}
                        onChange={(e) => setFormVesselLoa(e.target.value)}
                        placeholder="e.g. 120"
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="sp-vessel-gt">{t('formVesselGtRequired')}</label>
                      <input
                        id="sp-vessel-gt"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={formVesselGt}
                        onChange={(e) => setFormVesselGt(e.target.value)}
                        placeholder="e.g. 3500"
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="sp-vessel-draft">{t('formVesselDraftRequired')}</label>
                      <input
                        id="sp-vessel-draft"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={formVesselDraft}
                        onChange={(e) => setFormVesselDraft(e.target.value)}
                        placeholder="e.g. 6.5"
                        required
                      />
                    </div>
                    <div className="input-group">
                      <FormLabelWithInfo htmlFor="sp-total-cargo-mt" infoTooltip={t('formTotalCargoMtInfoTooltip')}>
                        {t('formTotalCargoMtAuto')}
                      </FormLabelWithInfo>
                      <input
                        id="sp-total-cargo-mt"
                        type="text"
                        value={totalCargoMt > 0 ? totalCargoMt.toLocaleString('en-US') : '—'}
                        readOnly
                      />
                    </div>
                    <div className="input-group">
                      <FormLabelWithInfo htmlFor="sp-vessel-dwt" infoTooltip={t('formVesselDwtInfoTooltip')}>
                        {t('formVesselDwtAuto')}
                      </FormLabelWithInfo>
                      <input
                        id="sp-vessel-dwt"
                        type="text"
                        value={vesselDwtComputed != null ? vesselDwtComputed.toLocaleString('en-US') : '—'}
                        readOnly
                      />
                    </div>
                  </div>
                  {(totalCargoMt <= 0 || siDrafts.length > 1) && (
                    <p className="shipment-plan-form__inline-hint text-steel">
                      {totalCargoMt <= 0
                        ? cargoUnconvertedKlNote
                          ? t('formTotalCargoMtKlNote')
                          : t('formTotalCargoMtPending')
                        : t('formTotalCargoMtMultiSiHint')}
                    </p>
                  )}
                  <div className="input-group shipment-plan-form__eta">
                    <label htmlFor="sp-eta">{t('formEtaRequiredLabel')}</label>
                    <input id="sp-eta" type="datetime-local" value={formEta} onChange={(e) => setFormEta(e.target.value)} required />
                  </div>
                  <div className="input-group shipment-plan-form__voyage">
                    <label htmlFor="sp-voyage">{t('formVoyageOptional')}</label>
                    <input
                      id="sp-voyage"
                      maxLength={MAX_SI_VOYAGE_CHARS}
                      value={formVoyageNo}
                      onChange={(e) => setFormVoyageNo(e.target.value)}
                      placeholder={t('formVoyagePlaceholder')}
                    />
                  </div>
                  <div className="input-group shipment-plan-form__agent">
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
                  <div className="input-group shipment-plan-form__jetty">
                    <label htmlFor="sp-jetty">{t('formJettyOptional')}</label>
                    <select id="sp-jetty" value={formJettyId} onChange={(e) => setFormJettyId(e.target.value)}>
                      <option value="">—</option>
                      {(lookups?.jetties || [])
                        .filter((j) => {
                          const a = jettyAdvice.byId[j.id]
                          if (!jettyAdvice.adviceReady || !a || a.fits) return true
                          return String(j.id) === String(formJettyId)
                        })
                        .map((j) => {
                          const a = jettyAdvice.byId[j.id]
                          let suffix = ''
                          if (jettyAdvice.adviceReady && a) {
                            if (!a.fits) suffix = ` — ✗ ${t('jettyNotSuitable')}`
                            else if (a.occupied) suffix = ` — ${t('jettyOccupiedAtEta')}`
                            else if (a.hasSpecs) suffix = ' — ✓'
                          }
                          return (
                            <option key={j.id} value={j.id}>
                              {(j.label || j.name) + suffix}
                            </option>
                          )
                        })}
                    </select>
                    {jettyAdvice.adviceReady ? (
                      <p
                        className={`shipment-plan-form__jetty-hint${
                          jettyAdvice.suggested.length > 0
                            ? ' text-steel'
                            : ' shipment-plan-form__jetty-hint--error'
                        }`}
                        role={jettyAdvice.suggested.length > 0 ? 'status' : 'alert'}
                      >
                        {jettyAdvice.suggested.length > 0
                          ? t('jettySuggestionLabel', {
                              list: jettyAdvice.suggested.map((j) => j.name).join(', '),
                            })
                          : t('jettyNoSuggestion')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              {showSiSection && (
                <div className="shipping-instruction-form__section shipment-plan-form__si-section">
                  <h3 className="shipping-instruction-form__section-title">{t('createSiSectionTitle')}</h3>
                  {!isViewMode && !isPreBerthEdit && (
                    <p className="shipment-plan-form__si-hint text-steel">
                      {t('createSiSectionHint')}
                    </p>
                  )}
                  {(isViewMode || isEditLike) && modalSiLoading && (
                    <p className="text-steel" style={{ marginBottom: '1rem' }}>
                      {t('viewPlanSiListLoading')}
                    </p>
                  )}
                  {(isViewMode || isEditLike) &&
                    !modalSiLoading &&
                    siDrafts.length === 0 &&
                    editingPlanDetail &&
                    !(editingPlanDetail.shippingInstructions?.length) && (
                    <p className="text-steel" style={{ marginBottom: '1rem' }}>
                      {t('editPlanSiListEmpty')}
                    </p>
                  )}
                  {siDrafts.map((block, index) => (
                    <div key={block.id} className="shipping-instruction-form__section shipment-plan-form__si-draft">
                      <div className="shipment-plan-form__si-draft-header">
                        <h4 className="shipment-plan-form__si-draft-title">{t('createSiBlockTitle', { n: index + 1 })}</h4>
                        {showAddAnotherSi &&
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
                      {showSiUpload && (
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
                        compact
                      />
                    </div>
                  ))}
                  {showAddAnotherSi && (
                    <button type="button" className="btn btn--secondary" onClick={addSiDraftBlock} disabled={!lookups}>
                      {t('addAnotherSi')}
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            <div className="modal__footer">
              {isViewMode ? (
                <button type="button" className="btn btn--primary" onClick={handleClose}>
                  {t('close')}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--secondary" onClick={handleClose}>
                    {t('cancel')}
                  </button>
                  <button type="submit" className="btn btn--primary">
                    {submitLabel}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
