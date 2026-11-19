import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DropdownMultiSelect from '../DropdownMultiSelect.jsx'
import StickyFormOverlay from '../StickyFormOverlay.jsx'

/**
 * Add / Edit form for one Kuras rule. Commodities used by another rule of the port are
 * shown disabled; the default rule has no commodity list ("All others").
 */
export default function KurasRuleFormModal({ rule, rules, commodities, saving, onSave, onClose }) {
  const { t } = useTranslation('pages')
  const isDefault = rule?.isDefault === true
  const [commodityIds, setCommodityIds] = useState(() => (rule?.commodities || []).map((c) => c.id))
  const [remaining, setRemaining] = useState(String(rule?.remainingPctBelow ?? 20))
  const [rate, setRate] = useState(String(rule?.rateMtPerHourBelow ?? 30))
  const [matchMode, setMatchMode] = useState(rule?.matchMode ?? 'and')
  const [isActive, setIsActive] = useState(rule?.isActive ?? true)
  const [error, setError] = useState('')

  const options = useMemo(() => {
    const takenBy = new Map()
    for (const r of rules) {
      if (r.id === rule?.id) continue
      for (const c of r.commodities) takenBy.set(c.id, true)
    }
    return commodities.map((c) => ({
      value: String(c.id),
      label: takenBy.has(String(c.id)) ? `${c.label} — ${t('kurasRuleInOtherRule')}` : c.label,
      disabled: takenBy.has(String(c.id)),
    }))
  }, [commodities, rules, rule?.id, t])

  const submit = () => {
    const r = Number(remaining)
    const q = Number(rate)
    if (!isDefault && commodityIds.length === 0) return setError(t('kurasRuleCommodityRequired'))
    if (!(r > 0 && r <= 100)) return setError(t('kurasRuleRemainingInvalid'))
    if (!(q > 0)) return setError(t('kurasRuleRateInvalid'))
    setError('')
    return onSave({ remainingPctBelow: r, rateMtPerHourBelow: q, matchMode, isActive, commodityIds })
  }

  return (
    <StickyFormOverlay onClose={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="kuras-rule-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="kuras-rule-modal-title" className="modal__title">
          {rule ? t('kurasRuleEditTitle') : t('kurasRuleAddTitle')}
        </h2>
        <div className="modal__body">
          <div className="modal__field">
            <span className="modal__label">{t('kurasRuleColCommodities')}</span>
            {isDefault ? (
              <p className="text-steel">{t('kurasRuleAllOthers')}</p>
            ) : (
              <DropdownMultiSelect
                id="kuras-rule-commodities"
                options={options}
                selectedValues={commodityIds}
                onChange={setCommodityIds}
                placeholder={t('kurasRuleSelectCommodities')}
                searchable
                portal
                ariaLabel={t('kurasRuleColCommodities')}
              />
            )}
          </div>
          <div className="modal__field">
            <label className="modal__label" htmlFor="kuras-rule-remaining">{t('kurasRuleRemainingLabel')}</label>
            <input id="kuras-rule-remaining" className="modal__input" type="number" min="1" max="100" step="0.1"
              value={remaining} onChange={(e) => setRemaining(e.target.value)} />
          </div>
          <div className="modal__field">
            <label className="modal__label" htmlFor="kuras-rule-rate">{t('kurasRuleRateLabel')}</label>
            <input id="kuras-rule-rate" className="modal__input" type="number" min="1" step="0.1"
              value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="modal__field">
            <label className="modal__label" htmlFor="kuras-rule-match">{t('kurasRuleColMatch')}</label>
            <select id="kuras-rule-match" className="modal__input" value={matchMode} onChange={(e) => setMatchMode(e.target.value)}>
              <option value="and">{t('kurasRuleMatchAnd')}</option>
              <option value="or">{t('kurasRuleMatchOr')}</option>
            </select>
          </div>
          <label className="modal__field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t('kurasRuleActiveLabel')}
          </label>
          {error ? <p role="alert" style={{ color: 'var(--color-danger, #c00)' }}>{error}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
            {t('kurasRuleCancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? t('kurasRuleSaving') : t('kurasRuleSave')}
          </button>
        </div>
      </div>
    </StickyFormOverlay>
  )
}
