import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { createMasterVessel, fetchMasterVesselById, fetchSimilarMasterVessels, updateMasterVesselApi } from '../api/masterVessels'
import MasterVesselFormFields from './MasterVesselFormFields.jsx'
import MasterVesselSimilarNotice from './MasterVesselSimilarNotice.jsx'
import StickyFormOverlay from './StickyFormOverlay.jsx'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/modal.css'

const PAGE_KEY = 'master-vessel'

export const EMPTY_VESSEL_FORM = {
  vesselName: '',
  hubCode: '',
  isActive: true,
  vesselImo: '',
  vesselMmsi: '',
  vesselCodeSap: '',
  vesselCapacityMt: '',
  vesselGrossTonnage: '',
  vesselDraft: '',
  vesselLengthOverall: '',
  vesselType: '',
  heater: false,
  typeLambung: '',
  typeCharter: '',
}

export function vesselFormFromRecord(v) {
  if (!v) return { ...EMPTY_VESSEL_FORM }
  return {
    vesselName: v.vesselName || '',
    hubCode: v.hubCode || '',
    isActive: v.isActive !== false,
    vesselImo: v.vesselImo ?? '',
    vesselMmsi: v.vesselMmsi ?? '',
    vesselCodeSap: v.vesselCodeSap ?? '',
    vesselCapacityMt: v.vesselCapacityMt ?? '',
    vesselGrossTonnage: v.vesselGrossTonnage ?? '',
    vesselDraft: v.vesselDraft ?? '',
    vesselLengthOverall: v.vesselLengthOverall ?? '',
    vesselType: v.vesselType ?? '',
    heater: v.heater === true,
    typeLambung: v.typeLambung ?? '',
    typeCharter: v.typeCharter ?? '',
  }
}

export function pushSaveToast(name, push) {
  if (!push || push.skipped) return { message: `Saved locally: ${name}.`, variant: 'success' }
  if (push.ok) {
    const code = push.code ? ` (${push.code})` : ''
    return { message: `Saved and pushed to DataHub${code}.`, variant: 'success' }
  }
  return {
    message: `Saved locally. DataHub push failed: ${push.error || 'unknown error'}`,
    variant: 'warning',
  }
}

/**
 * Shared add/edit dialog for master vessels.
 * highlightPlanningFields groups the fields a shipment plan needs and quiets the rest.
 * stacked raises the overlay above the vessel search panel.
 */
export default function MasterVesselFormModal({
  editingId = null,
  initialForm,
  highlightPlanningFields = false,
  stacked = false,
  onClose,
  onSaved,
  onUseExisting,
}) {
  const { t } = useTranslation('shipmentPlan')
  const { logActivity } = useActivityLog()
  const [form, setForm] = useState(() => ({ ...EMPTY_VESSEL_FORM, ...initialForm }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [similarMatches, setSimilarMatches] = useState([])
  const [confirmSimilar, setConfirmSimilar] = useState(false)
  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'vesselName' || key === 'vesselImo' || key === 'vesselMmsi') {
      setConfirmSimilar(false)
    }
  }

  useEffect(() => {
    const name = (form.vesselName || '').trim()
    const imo = (form.vesselImo || '').trim()
    const mmsi = (form.vesselMmsi || '').trim()
    if (name.length < 4 && !imo && !mmsi) {
      setSimilarMatches([])
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetchSimilarMasterVessels({
        name,
        imo,
        mmsi,
        excludeId: editingId,
      })
        .then((rows) => {
          if (!cancelled) setSimilarMatches(Array.isArray(rows) ? rows : [])
        })
        .catch(() => {
          if (!cancelled) setSimilarMatches([])
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.vesselName, form.vesselImo, form.vesselMmsi, editingId])

  const handleUse = async (match) => {
    if (!match?.isActive || match.id == null) return
    let vessel = match
    try {
      const full = await fetchMasterVesselById(match.id)
      if (full) vessel = full
    } catch {
      vessel = match
    }
    await onUseExisting?.(vessel)
    onClose()
  }

  const handleSubmit = async (forceSimilar = false) => {
    const name = (form.vesselName || '').trim()
    if (!name) {
      setSaveError('Vessel name is required.')
      return
    }
    const confirmed = forceSimilar === true || confirmSimilar
    if (forceSimilar === true) setConfirmSimilar(true)
    setSaving(true)
    setSaveError(null)
    const payload = { ...form, confirmSimilar: confirmed }
    try {
      const resp = editingId != null
        ? await updateMasterVesselApi(editingId, payload)
        : await createMasterVessel(payload)
      logActivity({
        pageKey: PAGE_KEY,
        action: editingId != null ? 'update' : 'add',
        entityType: 'Vessel',
        entityLabel: name,
      })
      await onSaved?.(resp)
      onClose()
    } catch (e) {
      if (e?.body?.code === 'similar_vessel') {
        setSimilarMatches(Array.isArray(e.body.matches) ? e.body.matches : [])
        setConfirmSimilar(false)
        return
      }
      setSaveError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <StickyFormOverlay className={stacked ? 'sticky-form-overlay--stacked' : ''}>
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="vessel-modal-title"
        aria-modal="true"
      >
        <h2 id="vessel-modal-title" className="modal__title">
          {editingId != null ? 'Edit Vessel' : 'Add Vessel'}
        </h2>
        {saveError ? (
          <p className="master-vessel-form__error" role="alert">{saveError}</p>
        ) : null}
        <MasterVesselFormFields
          form={form}
          setField={setField}
          saving={saving}
          highlightPlanningFields={highlightPlanningFields}
          planHint={highlightPlanningFields ? t('masterVesselUsedOnPlan') : null}
          neededTitle={t('masterVesselNeededTitle')}
          neededHint={t('masterVesselNeededHint')}
          otherTitle={t('masterVesselOtherFields')}
          nameNotice={(
            <MasterVesselSimilarNotice
              matches={similarMatches}
              saving={saving}
              editing={editingId != null}
              onUse={handleUse}
              onAddAnyway={() => handleSubmit(true)}
            />
          )}
        />
        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => handleSubmit(false)} disabled={saving}>
            {saving ? 'Saving…' : editingId != null ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </StickyFormOverlay>,
    document.body
  )
}
