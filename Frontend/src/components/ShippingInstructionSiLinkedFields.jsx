import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_SI_BL_INDICATED_CHARS,
  MAX_SI_BL_SPLIT_CHARS,
  MAX_SI_BILL_OF_LADING_CLAUSE_CHARS,
  MAX_SI_BREAKDOWN_SHORT_CHARS,
  MAX_SI_CONSIGNEE_CHARS,
  MAX_SI_DESTINATION_CHARS,
  MAX_SI_NOTE_CHARS,
  MAX_SI_NOTIFY_PARTY_CHARS,
  MAX_SI_REFERENCE_CHARS,
  MAX_SI_VESSEL_NAME_CHARS,
  MAX_SI_VOYAGE_CHARS,
} from '../constants/inputLimits'
import { emptyBreakdownRow, nextDocId, planEtaYmd } from '../utils/siPlanLinkedDraft'
import ShippingInstructionDocumentUploadSection from './ShippingInstructionDocumentUploadSection'

const FREIGHT_TERM_OPTIONS = [
  { value: '', label: '—' },
  { value: 'PREPAID', label: 'PREPAID' },
  { value: 'COLLECT', label: 'COLLECT' },
  { value: 'AS_PER_CHARTER_PARTY', label: 'AS PER CHARTER PARTY' },
  { value: 'OTHER', label: 'OTHER' },
]

/**
 * Controlled SI fields for a plan-linked draft (no outer &lt;form&gt; or submit footer).
 * @param {{
 *   lookups: object | null,
 *   linkedPlan: { id?: number, vesselName?: string, purposeId?: number, purposeCode?: string | null, eta?: string | null, voyageNo?: string | null, jettyId?: number | null, planReference?: string | null },
 *   form: object,
 *   setForm: import('react').Dispatch<import('react').SetStateAction<object>>,
 *   npwpMaster: string | null,
 *   idPrefix: string,
 *   showPlanLinkedNote?: boolean,
 *   omitVesselAndJetty?: boolean,
 *   omitDocumentUpload?: boolean,
 *   compact?: boolean,
 *   onDocumentUpload?: (e: import('react').ChangeEvent<HTMLInputElement>) => void,
 *   documentExtractBusy?: boolean,
 *   extractResultPanel?: import('react').ReactNode,
 * }} props
 */
export default function ShippingInstructionSiLinkedFields({
  lookups,
  linkedPlan,
  form,
  setForm,
  npwpMaster,
  idPrefix,
  showPlanLinkedNote = true,
  omitVesselAndJetty = false,
  omitDocumentUpload = false,
  compact = false,
  onDocumentUpload,
  documentExtractBusy = false,
  extractResultPanel = null,
}) {
  const { t } = useTranslation('shippingInstruction')
  const effectivePurposeId = linkedPlan?.purposeId != null ? String(linkedPlan.purposeId) : form.purposeId
  const selectedPurpose = useMemo(
    () => (lookups?.purposes || []).find((p) => String(p.id) === String(effectivePurposeId)) || null,
    [lookups?.purposes, effectivePurposeId]
  )
  const purposeCode = selectedPurpose?.code || null
  const purposeChosen = Boolean(effectivePurposeId)
  const isLoadingPurpose = purposeCode === 'Loading'
  const isUnloadingPurpose = purposeCode === 'Unloading'
  const formEnabled = !!lookups && purposeChosen

  const updateForm = (updates) => setForm((f) => ({ ...f, ...updates }))
  const addBreakdownRow = () => {
    setForm((f) => ({ ...f, breakdown: [...(f.breakdown || []), emptyBreakdownRow(lookups)] }))
  }
  const updateBreakdownRow = (index, field, value) => {
    setForm((f) => {
      const next = [...(f.breakdown || [])]
      next[index] = { ...next[index], [field]: value }
      return { ...f, breakdown: next }
    })
  }
  const removeBreakdownRow = (index) => {
    setForm((f) => {
      const rows = f.breakdown || []
      if (rows.length <= 1) return f
      return { ...f, breakdown: rows.filter((_, i) => i !== index) }
    })
  }
  const addDocuments = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const newDocs = Array.from(files).map((file) => ({ id: nextDocId(), name: file.name }))
    setForm((f) => ({ ...f, documents: [...(f.documents || []), ...newDocs] }))
    e.target.value = ''
  }
  const removeDocument = (id) => {
    setForm((f) => ({ ...f, documents: (f.documents || []).filter((d) => d.id !== id) }))
  }
  const breakdownTotalsByMetric = (form.breakdown || []).reduce((acc, row) => {
    const m = lookups?.metrics?.find((x) => String(x.id) === String(row.metricId))
    const code = m?.code || '?'
    acc[code] = (acc[code] || 0) + (Number(row.qty) || 0)
    return acc
  }, {})

  return (
    <>
      {showPlanLinkedNote && (
        <div className="shipping-instruction-form__section">
          <p className="text-steel" style={{ fontSize: '0.9rem', margin: 0 }}>
            {t('planLinkedFieldsNote', {
              ref: linkedPlan?.planReference || (linkedPlan?.id != null ? `#${linkedPlan.id}` : '—'),
              purpose: linkedPlan?.purposeCode || selectedPurpose?.label || '—',
              eta: planEtaYmd(linkedPlan) || '—',
              voyage: linkedPlan?.voyageNo?.trim() || '—',
              cargoTotalMt:
                linkedPlan?.cargoTotalMt != null && linkedPlan.cargoTotalMt !== ''
                  ? Number(linkedPlan.cargoTotalMt).toLocaleString()
                  : linkedPlan?.vesselCapacity != null && linkedPlan.vesselCapacity !== ''
                    ? Number(linkedPlan.vesselCapacity).toLocaleString()
                    : '—',
            })}
          </p>
        </div>
      )}
      {!lookups && <p className="text-steel">{t('loadingLookups')}</p>}
      <fieldset disabled={!formEnabled} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="shipping-instruction-form__section">
          <h3 className="shipping-instruction-form__section-title">{t('formVesselTripSection')}</h3>
          <div className="shipping-instruction-form__grid shipping-instruction-form__grid--vessel-trip">
            {!omitVesselAndJetty && (
              <div className="input-group shipping-instruction-form__vessel">
                <label htmlFor={`${idPrefix}vesselName`}>{t('formVesselNameRequired')}</label>
                <input
                  id={`${idPrefix}vesselName`}
                  value={form.vesselName}
                  onChange={(e) => updateForm({ vesselName: e.target.value })}
                  maxLength={MAX_SI_VESSEL_NAME_CHARS}
                  required
                  disabled={!lookups}
                  title={t('fieldFromShipmentPlan')}
                  readOnly
                />
              </div>
            )}
            <div className="input-group shipping-instruction-form__ref">
              <label htmlFor={`${idPrefix}siRef`}>{t('formSiNoRequired')}</label>
              <input
                id={`${idPrefix}siRef`}
                value={form.referenceNumber}
                onChange={(e) => updateForm({ referenceNumber: e.target.value })}
                maxLength={MAX_SI_REFERENCE_CHARS}
                required
                disabled={!lookups}
              />
            </div>
            <div className="input-group shipping-instruction-form__docdate">
              <label htmlFor={`${idPrefix}documentDate`}>{t('formDocumentDateRequired')}</label>
              <input
                id={`${idPrefix}documentDate`}
                type="date"
                value={form.documentDate}
                onChange={(e) => updateForm({ documentDate: e.target.value })}
                required
                disabled={!lookups}
              />
            </div>
            {!omitVesselAndJetty && (
              <div className="input-group shipping-instruction-form__jetty">
                <label htmlFor={`${idPrefix}jetty`}>{t('formPreferredJetty')}</label>
                <select
                  id={`${idPrefix}jetty`}
                  value={form.preferredJettyId}
                  onChange={(e) => updateForm({ preferredJettyId: e.target.value })}
                  disabled={!lookups}
                >
                  <option value="">—</option>
                  {(lookups?.jetties || []).map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {isLoadingPurpose && (
          <div className="shipping-instruction-form__section">
            <h3 className="shipping-instruction-form__section-title">{t('formRouteFreightSection')}</h3>
            <div className="shipping-instruction-form__grid">
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}destinationText`}>{t('formDestination')}</label>
                <input
                  id={`${idPrefix}destinationText`}
                  value={form.destinationText}
                  onChange={(e) => updateForm({ destinationText: e.target.value })}
                  maxLength={MAX_SI_DESTINATION_CHARS}
                  disabled={!lookups}
                />
              </div>
              <div className="input-group">
                <label htmlFor={`${idPrefix}freightTerms`}>{t('formFreightTerms')}</label>
                <select
                  id={`${idPrefix}freightTerms`}
                  value={form.freightTerms}
                  onChange={(e) => updateForm({ freightTerms: e.target.value })}
                  disabled={!lookups}
                >
                  {FREIGHT_TERM_OPTIONS.map((o) => (
                    <option key={o.value || 'none'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="shipping-instruction-form__section">
          <h3 className="shipping-instruction-form__section-title">{t('formPartyPortSection')}</h3>
          <div className="shipping-instruction-form__grid">
            <div className="input-group">
              <label htmlFor={`${idPrefix}loadingPort`}>{t('formLoadingPort')}</label>
              <select
                id={`${idPrefix}loadingPort`}
                value={form.loadingPortId}
                onChange={(e) => updateForm({ loadingPortId: e.target.value })}
                disabled={!lookups}
              >
                <option value="">—</option>
                {(lookups?.loadingPorts || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor={`${idPrefix}surveyor`}>{t('formSurveyor')}</label>
              <select
                id={`${idPrefix}surveyor`}
                value={form.surveyorId}
                onChange={(e) => updateForm({ surveyorId: e.target.value })}
                disabled={!lookups}
              >
                <option value="">—</option>
                {(lookups?.surveyors || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {isUnloadingPurpose && (
              <div className="input-group">
                <label htmlFor={`${idPrefix}term`}>{t('formTerm')}</label>
                <select
                  id={`${idPrefix}term`}
                  value={form.tradeTermId}
                  onChange={(e) => updateForm({ tradeTermId: e.target.value })}
                  disabled={!lookups}
                >
                  <option value="">—</option>
                  {(lookups?.tradeTerms || []).map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {tt.code}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isLoadingPurpose && (
              <div className="input-group">
                <label htmlFor={`${idPrefix}npwp`}>NPWP</label>
                <input id={`${idPrefix}npwp`} value={npwpMaster || '—'} readOnly disabled={!lookups} />
              </div>
            )}
          </div>
        </div>

        <div className="shipping-instruction-form__section">
          <h3 className="shipping-instruction-form__section-title">{t('formBreakdownSection')}</h3>
          {!compact && (
            <p className="text-steel" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              Each row is one contract line: its own commodity, qty, and unit (KL / MT).
            </p>
          )}
          <div className="table-wrap">
            <table className="data-table shipping-instruction-breakdown-table">
              <thead>
                <tr>
                  <th>{t('formBreakdownShipper')}</th>
                  <th>{t('formBreakdownCommodityReq')}</th>
                  <th>{t('formBreakdownQtyReq')}</th>
                  <th>{t('formBreakdownUnitReq')}</th>
                  <th>{t('formBreakdownContractNo')}</th>
                  <th>{t('formBreakdownPoNo')}</th>
                  <th>{t('formBreakdownSoNo')}</th>
                  <th>{t('formBreakdownRemarks')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(form.breakdown || []).map((row, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        value={row.shipperId}
                        onChange={(e) => updateBreakdownRow(i, 'shipperId', e.target.value)}
                        className="shipping-instruction-inline-input"
                        disabled={!lookups}
                      >
                        <option value="">—</option>
                        {(lookups?.shippers || []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
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
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
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
                          <option key={m.id} value={m.id}>
                            {m.code} ({m.label})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={row.contractNo}
                        onChange={(e) => updateBreakdownRow(i, 'contractNo', e.target.value)}
                        maxLength={MAX_SI_BREAKDOWN_SHORT_CHARS}
                        className="shipping-instruction-inline-input"
                      />
                    </td>
                    <td>
                      <input
                        value={row.poNo}
                        onChange={(e) => updateBreakdownRow(i, 'poNo', e.target.value)}
                        maxLength={MAX_SI_BREAKDOWN_SHORT_CHARS}
                        className="shipping-instruction-inline-input"
                      />
                    </td>
                    <td>
                      <input
                        value={row.soNo}
                        onChange={(e) => updateBreakdownRow(i, 'soNo', e.target.value)}
                        maxLength={MAX_SI_BREAKDOWN_SHORT_CHARS}
                        className="shipping-instruction-inline-input"
                      />
                    </td>
                    <td>
                      <input
                        value={row.remarks}
                        onChange={(e) => updateBreakdownRow(i, 'remarks', e.target.value)}
                        maxLength={MAX_SI_BREAKDOWN_SHORT_CHARS}
                        className="shipping-instruction-inline-input"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary shipping-instruction-btn-remove"
                        onClick={() => removeBreakdownRow(i)}
                        disabled={(form.breakdown || []).length <= 1}
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
                  <td colSpan={3} className="shipping-instruction-total-label">
                    {t('formTotalsByUnit')}
                  </td>
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
            <h3 className="shipping-instruction-form__section-title">{t('formBlConsigneeSection')}</h3>
            <div className="shipping-instruction-form__grid">
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}blSplit`}>{t('formBlSplit')}</label>
                <textarea
                  id={`${idPrefix}blSplit`}
                  className="shipping-instruction-inline-input"
                  style={{ minHeight: 56, resize: 'vertical' }}
                  value={form.blSplitText}
                  onChange={(e) => updateForm({ blSplitText: e.target.value })}
                  maxLength={MAX_SI_BL_SPLIT_CHARS}
                  disabled={!lookups}
                />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}billOfLadingClause`}>{t('formBillOfLadingClause')}</label>
                <textarea
                  id={`${idPrefix}billOfLadingClause`}
                  className="shipping-instruction-inline-input"
                  style={{ minHeight: 72, resize: 'vertical' }}
                  value={form.billOfLadingClause}
                  onChange={(e) => updateForm({ billOfLadingClause: e.target.value })}
                  maxLength={MAX_SI_BILL_OF_LADING_CLAUSE_CHARS}
                  disabled={!lookups}
                />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}consignee`}>{t('formConsignee')}</label>
                <textarea
                  id={`${idPrefix}consignee`}
                  className="shipping-instruction-inline-input"
                  style={{ minHeight: 56, resize: 'vertical' }}
                  value={form.consigneeText}
                  onChange={(e) => updateForm({ consigneeText: e.target.value })}
                  maxLength={MAX_SI_CONSIGNEE_CHARS}
                  disabled={!lookups}
                />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}notify`}>{t('formNotifyParty')}</label>
                <textarea
                  id={`${idPrefix}notify`}
                  className="shipping-instruction-inline-input"
                  style={{ minHeight: 72, resize: 'vertical' }}
                  value={form.notifyPartyText}
                  onChange={(e) => updateForm({ notifyPartyText: e.target.value })}
                  maxLength={MAX_SI_NOTIFY_PARTY_CHARS}
                  disabled={!lookups}
                />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${idPrefix}blIndicated`}>{t('formBlIndicated')}</label>
                <textarea
                  id={`${idPrefix}blIndicated`}
                  className="shipping-instruction-inline-input"
                  style={{ minHeight: 56, resize: 'vertical' }}
                  value={form.blIndicated}
                  onChange={(e) => updateForm({ blIndicated: e.target.value })}
                  maxLength={MAX_SI_BL_INDICATED_CHARS}
                  disabled={!lookups}
                />
              </div>
            </div>
          </div>
        )}

        {!omitDocumentUpload && (
          <>
            <ShippingInstructionDocumentUploadSection
              documents={form.documents || []}
              onAddFiles={onDocumentUpload || addDocuments}
              onRemove={removeDocument}
              idPrefix={idPrefix}
              extractBusy={documentExtractBusy}
            />
            {extractResultPanel}
          </>
        )}

        <div className="shipping-instruction-form__section">
          <h3 className="shipping-instruction-form__section-title">{t('formNoteSection')}</h3>
          <div className="input-group">
            <label htmlFor={`${idPrefix}note`}>{t('formNoteLabel')}</label>
            <textarea
              id={`${idPrefix}note`}
              className="shipping-instruction-inline-input"
              style={{ minHeight: 96, resize: 'vertical' }}
              value={form.note}
              onChange={(e) => updateForm({ note: e.target.value })}
              maxLength={MAX_SI_NOTE_CHARS}
              disabled={!lookups}
            />
          </div>
        </div>
      </fieldset>
    </>
  )
}
