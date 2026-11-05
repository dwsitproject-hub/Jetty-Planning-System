import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSampleRecord, validateSample } from '../../utils/qcSampling'
import QcSheet from './QcSheet'
import SampleFields from './SampleFields'

/** Edit or delete one recorded palka. Delete is a two-step inline confirm (no browser dialog). */
export default function SampleEditSheet({ record, records, onSave, onDelete, onClose, sampleRefKind = 'palka', tanks = [] }) {
  const { t } = useTranslation('qc')
  const [form, setForm] = useState({
    noPalka: record.noPalka || '',
    tankId: record.tankId != null ? String(record.tankId) : '',
    ffa: record.ffa || '',
    moisture: record.moisture || '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const result = validateSample(form, records, record.id, { kind: sampleRefKind })

  const save = () => {
    setSubmitted(true)
    if (!result.ok) return
    const { noPalka, tankId, ffa, moisture } = buildSampleRecord(form)
    onSave(record.id, { noPalka, ...(tankId != null ? { tankId } : {}), ffa, moisture })
  }

  return (
    <QcSheet open title={t('sample.edit')} onClose={onClose}>
      <SampleFields
        form={form}
        errors={submitted ? result.errors : {}}
        onChange={setForm}
        onEnter={save}
        idPrefix="qc-edit"
        sampleRefKind={sampleRefKind}
        tanks={tanks}
      />
      {result.duplicate ? (
        <p className="qc-warning" role="status">
          {t(sampleRefKind === 'tank' ? 'quickAdd.duplicateTank' : 'quickAdd.duplicate', { palka: form.noPalka.trim() })}
        </p>
      ) : null}
      <div className="qc-sheet__actions">
        <button type="button" className="op-btn op-btn--primary" onClick={save}>
          {t('sample.save')}
        </button>
        <button type="button" className="op-btn op-btn--soft" onClick={onClose}>
          {t('sample.cancel')}
        </button>
      </div>
      {confirmDelete ? (
        <div className="qc-sheet__confirm" role="alert">
          <span>{t(sampleRefKind === 'tank' ? 'sample.confirmDeleteTank' : 'sample.confirmDelete', { palka: record.noPalka })}</span>
          <button type="button" className="op-btn op-btn--danger" onClick={() => onDelete(record.id)}>
            {t('sample.delete')}
          </button>
        </div>
      ) : (
        <button type="button" className="op-btn op-btn--ghost qc-sheet__delete" onClick={() => setConfirmDelete(true)}>
          {t('sample.delete')}
        </button>
      )}
    </QcSheet>
  )
}
