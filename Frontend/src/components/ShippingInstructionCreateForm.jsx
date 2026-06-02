/**
 * Create Draft SI linked to an existing shipment plan (purpose / ETA / voyage / vessel from plan).
 * Used inside the shipment plan “new plan” combined modal.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createShippingInstruction, fetchSiNpwpMaster } from '../api/shippingInstructions'
import ShippingInstructionSiLinkedFields from './ShippingInstructionSiLinkedFields'
import {
  defaultSiDraftForPlanPreview,
  planEtaYmd,
  validateSiDraftForCreate,
  buildSiCreateApiPayload,
} from '../utils/siPlanLinkedDraft'
import { attachDraftSiDocuments } from '../api/siDocuments'
import { useSiDocumentExtract } from '../hooks/useSiDocumentExtract'
import SiExtractConflictModal from './SiExtractConflictModal'
import SiExtractResultPanel from './SiExtractResultPanel'

/**
 * @param {{
 *   lookups: object | null,
 *   linkedPlan: { id: number, vesselName?: string, purposeId?: number, purposeCode?: string | null, eta?: string | null, voyageNo?: string | null, jettyId?: number | null, planReference?: string | null },
 *   onSuccess: (saved: object) => void,
 *   onCancel: () => void,
 *   onErrorToast: (message: string, variant?: 'error' | 'success') => void,
 *   logActivity: (entry: object) => void,
 * }} props
 */
export default function ShippingInstructionCreateForm({ lookups, linkedPlan, onSuccess, onCancel, onErrorToast, logActivity }) {
  const { t } = useTranslation('shippingInstruction')
  const { t: tPlan } = useTranslation('shipmentPlan')
  const [form, setForm] = useState(() => defaultSiDraftForPlanPreview(null, linkedPlan))
  const [npwpMaster, setNpwpMaster] = useState(null)
  const [draftDocKey] = useState(
    () => `si-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  )

  const siDocExtract = useSiDocumentExtract({
    lookups,
    t: tPlan,
    getPlanForm: () => ({
      vesselName: linkedPlan?.vesselName || '',
      voyageNo: linkedPlan?.voyageNo || '',
      agentId: linkedPlan?.agentId != null ? String(linkedPlan.agentId) : '',
      eta: linkedPlan?.eta ? planEtaYmd(linkedPlan) : '',
    }),
  })

  const handleDocumentUpload = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    siDocExtract.handleFilesForDraft({
      files,
      form,
      setForm: (next) => setForm((f) => (typeof next === 'function' ? next(f) : next)),
      draftKey: draftDocKey,
      shipmentPlanId: linkedPlan?.id ?? null,
      onToast: (toast) => onErrorToast(toast.message, toast.variant),
    })
  }

  useEffect(() => {
    if (!lookups || !linkedPlan) return
    setForm(defaultSiDraftForPlanPreview(lookups, linkedPlan))
  }, [lookups, linkedPlan])

  const effectivePurposeId = linkedPlan?.purposeId != null ? String(linkedPlan.purposeId) : form.purposeId
  const selectedPurpose = useMemo(
    () => (lookups?.purposes || []).find((p) => String(p.id) === String(effectivePurposeId)) || null,
    [lookups?.purposes, effectivePurposeId]
  )
  const purposeCode = selectedPurpose?.code || null
  const isLoadingPurpose = purposeCode === 'Loading'

  useEffect(() => {
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
        if (!cancelled) {
          setNpwpMaster(null)
          const msg = e?.message || 'Failed to load NPWP master'
          onErrorToast(`Failed to load NPWP master: ${msg}`, 'error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [isLoadingPurpose, onErrorToast])

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault()
      if (!lookups || !linkedPlan?.id) {
        onErrorToast('Form options not loaded yet.', 'error')
        return
      }
      const validated = validateSiDraftForCreate(form, lookups, linkedPlan)
      if (typeof validated === 'string') {
        onErrorToast(validated, 'error')
        return
      }
      const payload = buildSiCreateApiPayload(form, linkedPlan, validated)
      const toLabel = (id, list, fallback) => {
        if (!id) return '—'
        const m = (list || []).find((x) => String(x.id) === String(id))
        return m ? (m.label || m.name || m.code || m.label || m.id) : fallback || String(id)
      }
      const summarizeBreakdown = (rows) => {
        const r = Array.isArray(rows) ? rows : []
        if (r.length === 0) return '—'
        const parts = r.map(
          (x) =>
            `${x.qty || 0} ${toLabel(x.metricId, lookups?.metrics, '?')} · ${toLabel(x.commodityId, lookups?.commodities, '?')}`
        )
        return `${r.length} line(s): ${parts.join(' | ')}`
      }
      try {
        const saved = await createShippingInstruction(payload)
        if ((form.documents || []).some((d) => d.documentId) && linkedPlan?.id) {
          try {
            await attachDraftSiDocuments({
              draftKey: draftDocKey,
              shipmentPlanId: linkedPlan.id,
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
          details: {
            summary: 'Created Draft SI (from shipment plan modal)',
            changes: [
              { field: 'Vessel', from: '—', to: payload.vesselName },
              { field: 'Breakdown', from: '—', to: summarizeBreakdown(form.breakdown) },
            ],
          },
        })
        onSuccess(saved)
      } catch (err) {
        onErrorToast(err?.message || 'Create failed', 'error')
      }
    },
    [lookups, linkedPlan, form, logActivity, onSuccess, onErrorToast]
  )

  const purposeChosen = Boolean(effectivePurposeId)
  const formEnabled = !!lookups && purposeChosen

  return (
    <>
      <SiExtractConflictModal
        open={siDocExtract.conflictOpen}
        conflicts={siDocExtract.conflictList}
        warnings={siDocExtract.conflictWarnings}
        partialApply={siDocExtract.conflictPartialApply}
        onCancel={siDocExtract.cancelConflict}
        onApply={(keys) => siDocExtract.resolveConflict(keys)}
      />
      <form onSubmit={handleSubmit} className="shipping-instruction-form">
        <ShippingInstructionSiLinkedFields
          lookups={lookups}
          linkedPlan={linkedPlan}
          form={form}
          setForm={setForm}
          npwpMaster={npwpMaster}
          idPrefix="sicf-"
          showPlanLinkedNote
          omitVesselAndJetty
          onDocumentUpload={handleDocumentUpload}
          documentExtractBusy={siDocExtract.extractBusy}
          extractResultPanel={
            <SiExtractResultPanel
              report={siDocExtract.getReport(draftDocKey)}
              onDismiss={() => siDocExtract.clearReport(draftDocKey)}
            />
          }
        />
        <div className="modal__footer" style={{ marginTop: 'var(--spacing-2)' }}>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!formEnabled}>
            {t('submit')}
          </button>
        </div>
      </form>
    </>
  )
}
