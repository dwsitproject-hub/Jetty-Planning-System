import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import StickyFormOverlay from '../StickyFormOverlay.jsx'
import { paramLabel, paramMethod, paramUnit } from '../../utils/qcSpec'

const EMPTY = { code: '', labelEn: '', labelId: '', unit: '', method: '' }

function formFrom(param) {
  if (!param?.id) return { ...EMPTY }
  return {
    code: param.code || '',
    labelEn: param.labelEn || '',
    labelId: param.labelId || '',
    unit: param.unit || '',
    method: param.method || '',
  }
}

/**
 * Master library: unit and method are their own columns, not folded into the label.
 */
export default function QcSpecParameterLibrary({ parameters, canEdit, onCreate, onUpdate }) {
  const { t, i18n } = useTranslation('pages')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    setEditing(null)
    setForm(EMPTY)
    setError('')
  }

  const open = (param) => {
    setEditing(param || {})
    setForm(formFrom(param))
    setError('')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const body = {
        code: form.code,
        labelEn: form.labelEn,
        labelId: form.labelId,
        unit: form.unit,
        method: form.method,
        kind: editing?.kind || 'number',
        maxValue: editing?.maxValue || 100,
      }
      if (editing?.id) await onUpdate(editing.id, body)
      else await onCreate(body)
      close()
    } catch (e) {
      setError(e?.message || t('qcSpec.paramSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <div className="card__header-row">
        <h2 className="card__title">{t('qcSpec.libraryTitle')}</h2>
        {canEdit ? (
          <button type="button" className="btn btn--primary" onClick={() => open(null)}>
            {t('qcSpec.libraryAdd')}
          </button>
        ) : null}
      </div>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        {t('qcSpec.libraryIntro')}
      </p>
      <div className="table-wrap table-wrap--pin-actions table-wrap--pin-actions--pair">
        <table className="data-table allocation-table">
          <thead>
            <tr>
              {canEdit ? <th className="allocation-table__action-col">{t('qcSpec.colActions')}</th> : null}
              <th>{t('qcSpec.colCode')}</th>
              <th>{t('qcSpec.colParam')}</th>
              <th>{t('qcSpec.colUnit')}</th>
              <th>{t('qcSpec.colMethod')}</th>
            </tr>
          </thead>
          <tbody>
            {(parameters || []).map((row) => (
              <tr key={row.id} className="allocation-table__row">
                {canEdit ? (
                  <td className="allocation-table__action-col">
                    <div className="allocation-table__action-btns">
                      <button type="button" className="btn btn--small btn--edit" onClick={() => open(row)}>
                        {t('qcSpec.edit')}
                      </button>
                    </div>
                  </td>
                ) : null}
                <td>{row.code}</td>
                <td>{paramLabel(row, i18n.language)}</td>
                <td>{paramUnit(row) || '—'}</td>
                <td>{paramMethod(row) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(parameters || []).length === 0 ? <p className="text-steel">{t('qcSpec.libraryEmpty')}</p> : null}
      </div>

      {editing ? (
        <StickyFormOverlay onClose={close} closeDisabled={saving}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qc-param-title">
            <h2 id="qc-param-title" className="modal__title">
              {editing.id ? t('qcSpec.paramEditTitle') : t('qcSpec.paramAddTitle')}
            </h2>
            <div className="modal__section">
              <label className="modal__label" htmlFor="qc-param-code">
                {t('qcSpec.paramCode')}
              </label>
              <input
                id="qc-param-code"
                className="modal__input"
                value={form.code}
                disabled={Boolean(editing.id)}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="qc-param-label">
                {t('qcSpec.paramLabel')}
              </label>
              <input
                id="qc-param-label"
                className="modal__input"
                value={form.labelEn}
                onChange={(e) => setForm((f) => ({ ...f, labelEn: e.target.value }))}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="qc-param-label-id">
                {t('qcSpec.paramLabelId')}
              </label>
              <input
                id="qc-param-label-id"
                className="modal__input"
                value={form.labelId}
                onChange={(e) => setForm((f) => ({ ...f, labelId: e.target.value }))}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="qc-param-unit">
                {t('qcSpec.paramUnit')}
              </label>
              <input
                id="qc-param-unit"
                className="modal__input"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label" htmlFor="qc-param-method">
                {t('qcSpec.paramMethod')}
              </label>
              <input
                id="qc-param-method"
                className="modal__input"
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              />
            </div>
            {error ? <p className="text-error">{error}</p> : null}
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={close} disabled={saving}>
                {t('qcSpec.cancel')}
              </button>
              <button type="button" className="btn btn--primary" onClick={save} disabled={saving || (!editing.id && !form.code.trim())}>
                {saving ? t('qcSpec.saving') : t('qcSpec.paramSave')}
              </button>
            </div>
          </div>
        </StickyFormOverlay>
      ) : null}
    </section>
  )
}
