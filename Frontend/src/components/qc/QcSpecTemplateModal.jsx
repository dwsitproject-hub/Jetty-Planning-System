import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DropdownMultiSelect from '../DropdownMultiSelect.jsx'
import StickyFormOverlay from '../StickyFormOverlay.jsx'
import { paramLabel, paramMethod, paramUnit } from '../../utils/qcSpec'

const SCOPES = [
  { id: 'report', labelKey: 'qcSpec.scopeReport' },
  { id: 'sample', labelKey: 'qcSpec.scopeSample' },
  { id: 'both', labelKey: 'qcSpec.scopeBoth' },
]

/**
 * Create/edit one QC spec template: name, searchable commodity checkboxes, ordered parameters.
 */
export default function QcSpecTemplateModal({
  open,
  template,
  templates = [],
  parameters,
  commodities,
  saving,
  error,
  onClose,
  onSave,
  onCreateParameter,
}) {
  const { t, i18n } = useTranslation('pages')
  const [name, setName] = useState(template?.name || '')
  const [selectedIds, setSelectedIds] = useState(() => (template?.commodities || []).map((c) => String(c.commodityId)))
  const [items, setItems] = useState(() => (template?.parameters || []).map((p) => ({ ...p, parameterId: p.id })))
  const [addCode, setAddCode] = useState('')
  const [custom, setCustom] = useState({ code: '', labelEn: '', unit: '', method: '' })
  const templateId = template?.id ?? null

  const commodityOptions = useMemo(
    () =>
      (commodities || []).map((c) => {
        const taken = Boolean(c.assignedTemplateId && c.assignedTemplateId !== templateId)
        const base = c.shortName || c.name
        return {
          value: String(c.commodityId),
          label: taken ? `${base} — ${t('qcSpec.onTemplate', { name: c.assignedTemplateName })}` : base,
          keywords: `${c.shortName || ''} ${c.name || ''}`,
          disabled: taken,
        }
      }),
    [commodities, t, templateId]
  )

  const selectedLabels = commodityOptions.filter((o) => selectedIds.includes(o.value) && !o.disabled).map((o) => o.label)
  const unusedParams = (parameters || []).filter((p) => !items.some((row) => String(row.parameterId || row.id) === String(p.id)))

  const moveItem = (index, delta) => {
    setItems((prev) => {
      const dest = index + delta
      if (dest < 0 || dest >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(index, 1)
      next.splice(dest, 0, row)
      return next
    })
  }

  if (!open) return null

  return (
    <StickyFormOverlay onClose={onClose} closeDisabled={saving}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qc-spec-title">
        <h2 id="qc-spec-title" className="modal__title">
          {templateId ? t('qcSpec.editTitle') : t('qcSpec.addTitle')}
        </h2>

        <div className="modal__section">
          <label className="modal__label" htmlFor="qc-spec-name">
            {t('qcSpec.name')}
          </label>
          <input id="qc-spec-name" className="modal__input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="modal__section">
          <DropdownMultiSelect
            id="qc-spec-commodities"
            label={t('qcSpec.commodities')}
            options={commodityOptions}
            selectedValues={selectedIds}
            onChange={setSelectedIds}
            placeholder={t('qcSpec.searchCommodity')}
            titleLabel={t('qcSpec.commodities')}
            searchable
            searchPlaceholder={t('qcSpec.searchCommodity')}
            portal
            emptyText={t('qcSpec.emptyCommodities')}
          />
          <p className="text-steel" style={{ marginTop: '0.25rem' }}>
            {selectedLabels.length ? t('qcSpec.selectedCommodities', { list: selectedLabels.join(', ') }) : t('qcSpec.noCommodities')}
          </p>
        </div>

        <div className="modal__section">
          <label className="modal__label" htmlFor="qc-spec-copy">
            {t('qcSpec.parameters')}
          </label>
          <select
            id="qc-spec-copy"
            className="modal__input"
            defaultValue=""
            onChange={(e) => {
              const source = templates.find((row) => String(row.id) === e.target.value)
              if (source) setItems((source.parameters || []).map((p) => ({ ...p, parameterId: p.id })))
              e.target.value = ''
            }}
          >
            <option value="">{t('qcSpec.copyFrom')}</option>
            {templates
              .filter((row) => row.id !== templateId && (row.parameters || []).length)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
          <div className="table-wrap">
            <table className="data-table qc-spec-param-table">
              <thead>
                <tr>
                  <th>{t('qcSpec.colParam')}</th>
                  <th>{t('qcSpec.colUnit')}</th>
                  <th>{t('qcSpec.colMethod')}</th>
                  <th>{t('qcSpec.colScope')}</th>
                  <th>{t('qcSpec.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p, index) => (
                  <tr key={p.parameterId || p.id}>
                    <td>{paramLabel(p, i18n.language)}</td>
                    <td>{paramUnit(p) || '—'}</td>
                    <td>{paramMethod(p) || '—'}</td>
                    <td>
                      <select
                        className="modal__input"
                        value={p.scope || 'report'}
                        onChange={(e) => setItems((prev) => prev.map((row, i) => (i === index ? { ...row, scope: e.target.value } : row)))}
                      >
                        {SCOPES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {t(s.labelKey)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="qc-spec-param-actions">
                        <button type="button" className="btn btn--small btn--secondary" disabled={index === 0} onClick={() => moveItem(index, -1)}>
                          {t('qcSpec.moveUp')}
                        </button>
                        <button type="button" className="btn btn--small btn--secondary" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}>
                          {t('qcSpec.moveDown')}
                        </button>
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                          {t('qcSpec.remove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qc-spec-add-row">
            <select className="modal__input" value={addCode} onChange={(e) => setAddCode(e.target.value)}>
              <option value="">{t('qcSpec.addFromLibrary')}</option>
              {unusedParams.map((p) => (
                <option key={p.id} value={p.id}>
                  {[paramLabel(p, i18n.language), paramUnit(p), paramMethod(p)].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--small btn--primary"
              disabled={!addCode}
              onClick={() => {
                const p = unusedParams.find((x) => String(x.id) === String(addCode))
                if (!p) return
                setItems((prev) => [...prev, { ...p, parameterId: p.id, scope: 'report' }])
                setAddCode('')
              }}
            >
              {t('qcSpec.addParam')}
            </button>
          </div>
          <div className="qc-spec-custom-row">
            <input className="modal__input" placeholder={t('qcSpec.customCode')} value={custom.code} onChange={(e) => setCustom((c) => ({ ...c, code: e.target.value }))} />
            <input className="modal__input" placeholder={t('qcSpec.customLabel')} value={custom.labelEn} onChange={(e) => setCustom((c) => ({ ...c, labelEn: e.target.value }))} />
            <input className="modal__input" placeholder={t('qcSpec.customUnit')} value={custom.unit} onChange={(e) => setCustom((c) => ({ ...c, unit: e.target.value }))} />
            <input className="modal__input" placeholder={t('qcSpec.customMethod')} value={custom.method} onChange={(e) => setCustom((c) => ({ ...c, method: e.target.value }))} />
            <button
              type="button"
              className="btn btn--small btn--secondary"
              disabled={!custom.code.trim()}
              onClick={async () => {
                const created = await onCreateParameter({
                  code: custom.code,
                  labelEn: custom.labelEn,
                  unit: custom.unit,
                  method: custom.method,
                })
                if (!created) return
                setItems((prev) => [...prev, { ...created, parameterId: created.id, scope: 'report' }])
                setCustom({ code: '', labelEn: '', unit: '', method: '' })
              }}
            >
              {t('qcSpec.addCustom')}
            </button>
          </div>
        </div>

        {error ? <p className="text-error">{error}</p> : null}
        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
            {t('qcSpec.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving}
            onClick={() =>
              onSave({
                name,
                commodityIds: selectedIds
                  .filter((id) => !commodityOptions.find((o) => o.value === id)?.disabled)
                  .map(Number)
                  .filter((id) => Number.isFinite(id)),
                parameters: items.map((p, i) => ({ parameterId: p.parameterId || p.id, scope: p.scope || 'report', sortOrder: i })),
              })
            }
          >
            {saving ? t('qcSpec.saving') : t('qcSpec.save')}
          </button>
        </div>
      </div>
    </StickyFormOverlay>
  )
}
