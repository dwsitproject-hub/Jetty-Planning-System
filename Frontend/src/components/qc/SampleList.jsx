import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SampleEditSheet from './SampleEditSheet'

const dash = (v) => (v == null || v === '' ? '—' : v)

/** Recorded samples as tappable cards; a tap opens the edit bottom sheet. */
export default function SampleList({ records, onUpdate, onRemove }) {
  const { t } = useTranslation('qc')
  const [editingId, setEditingId] = useState(null)
  const editing = records.find((r) => r.id === editingId) || null

  return (
    <section className="qc-card-block" aria-labelledby="qc-recorded-title">
      <h2 id="qc-recorded-title" className="qc-card-block__title">
        {t('entry.sectionRecorded', { count: records.length })}
      </h2>
      {records.length === 0 ? <p className="qc-muted">{t('entry.noRecords')}</p> : null}
      <ul className="qc-sample-list">
        {records.map((rec) => (
          <li key={rec.id}>
            <button type="button" className="qc-sample" onClick={() => setEditingId(rec.id)}>
              <span className="qc-sample__palka">{t('sample.palka', { palka: rec.noPalka })}</span>
              <span className="qc-sample__metric">{t('sample.ffa', { value: dash(rec.ffa) })}</span>
              <span className="qc-sample__metric">{t('sample.moisture', { value: dash(rec.moisture) })}</span>
            </button>
          </li>
        ))}
      </ul>
      {editing ? (
        <SampleEditSheet
          key={editing.id}
          record={editing}
          records={records}
          onClose={() => setEditingId(null)}
          onSave={(id, patch) => {
            onUpdate(id, patch)
            setEditingId(null)
          }}
          onDelete={(id) => {
            onRemove(id)
            setEditingId(null)
          }}
        />
      ) : null}
    </section>
  )
}
