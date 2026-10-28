import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSampleRecord, validateSample } from '../../utils/qcSampling'
import QcSheet from './QcSheet'
import SampleFields from './SampleFields'

/** Edit or delete one recorded palka. Delete is a two-step inline confirm (no browser dialog). */
export default function SampleEditSheet({ record, records, onSave, onDelete, onClose }) {
  const { t } = useTranslation('qc')
  const [form, setForm] = useState({
    noPalka: record.noPalka || '',
    ffa: record.ffa || '',
    moisture: record.moisture || '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const result = validateSample(form, records, record.id)

  const save = () => {
    setSubmitted(true)
    if (!result.ok) return
    const { noPalka, ffa, moisture } = buildSampleRecord(form)
    onSave(record.id, { noPalka, ffa, moisture })
  }

  return (
    <QcSheet open title={t('sample.edit')} onClose={onClose}>
      <SampleFields
        form={form}
        errors={submitted ? result.errors : {}}
        onChange={setForm}
        onEnter={save}
        idPrefix="qc-edit"
      />
      {result.duplicate ? (
        <p className="qc-warning" role="status">
          {t('quickAdd.duplicate', { palka: form.noPalka.trim() })}
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
          <span>{t('sample.confirmDelete', { palka: record.noPalka })}</span>
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
