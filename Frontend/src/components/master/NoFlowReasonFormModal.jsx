import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import StickyFormOverlay from '../StickyFormOverlay.jsx'

export const NO_FLOW_CATEGORIES = ['terminal', 'vessel', 'external', 'other']

/** Add / Edit one no-flow reason (shared by all ports). */
export default function NoFlowReasonFormModal({ reason, saving, onSave, onClose }) {
  const { t } = useTranslation('pages')
  const [form, setForm] = useState({
    code: reason?.code ?? '',
    nameEn: reason?.nameEn ?? '',
    nameId: reason?.nameId ?? '',
    category: reason?.category ?? 'terminal',
    requiresNote: reason?.requiresNote ?? false,
    sortOrder: String(reason?.sortOrder ?? 0),
    isActive: reason?.isActive ?? true,
  })
  const [error, setError] = useState('')
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = () => {
    if (!form.code.trim() || !form.nameEn.trim() || !form.nameId.trim()) return setError(t('noFlowReasonFieldsRequired'))
    setError('')
    return onSave({ ...form, code: form.code.trim().toUpperCase(), sortOrder: Number(form.sortOrder) || 0 })
  }

  const field = (key, labelKey, props = {}) => (
    <div className="modal__field">
      <label className="modal__label" htmlFor={`no-flow-reason-${key}`}>{t(labelKey)}</label>
      <input id={`no-flow-reason-${key}`} className="modal__input" value={form[key]} onChange={set(key)} {...props} />
    </div>
  )

  return (
    <StickyFormOverlay onClose={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="no-flow-reason-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="no-flow-reason-modal-title" className="modal__title">
          {reason ? t('noFlowReasonEditTitle') : t('noFlowReasonAddTitle')}
        </h2>
        <div className="modal__body">
          {field('code', 'noFlowReasonColCode', { maxLength: 12, autoComplete: 'off' })}
          {field('nameEn', 'noFlowReasonColNameEn')}
          {field('nameId', 'noFlowReasonColNameId')}
          <div className="modal__field">
            <label className="modal__label" htmlFor="no-flow-reason-category">{t('noFlowReasonColCategory')}</label>
            <select id="no-flow-reason-category" className="modal__input" value={form.category} onChange={set('category')}>
              {NO_FLOW_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`noFlowCategory_${c}`)}</option>
              ))}
            </select>
          </div>
          {field('sortOrder', 'noFlowReasonColSort', { type: 'number', step: 1 })}
          <label className="modal__field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={form.requiresNote} onChange={set('requiresNote')} />
            {t('noFlowReasonRequiresNote')}
          </label>
          <label className="modal__field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
            {t('kurasRuleActiveLabel')}
          </label>
          {error ? <p role="alert" style={{ color: 'var(--color-danger, #c00)' }}>{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>{t('kurasRuleCancel')}</button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? t('kurasRuleSaving') : t('kurasRuleSave')}
          </button>
        </div>
      </div>
    </StickyFormOverlay>
  )
}
