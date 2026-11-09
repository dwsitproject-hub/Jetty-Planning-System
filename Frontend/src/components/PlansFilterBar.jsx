import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PlanSourceFilter from './PlanSourceFilter'
import '../styles/plans-filter-bar.css'

const APPROVAL_OPTIONS = ['Draft', 'Submitted', 'Approved', 'Rejected']

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M1.75 2.5A.75.75 0 0 1 2.5 1.75h11a.75.75 0 0 1 .56 1.25L9.75 7.8v4.7a.75.75 0 0 1-.4.66l-2 1.05a.75.75 0 0 1-1.1-.66V7.8L1.94 3A.75.75 0 0 1 1.75 2.5Z"
      />
    </svg>
  )
}

/**
 * Toolbar row (source chips + Filters button) with a collapsible filter panel.
 * The button shows how many of the panel filters are active.
 */
export default function PlansFilterBar({
  sourceChips,
  sourceFilter,
  onSourceChange,
  approval,
  onApprovalChange,
  vesselQ,
  onVesselChange,
  purpose,
  onPurposeChange,
  purposes,
  onClear,
}) {
  const { t } = useTranslation('shipmentPlan')
  const [open, setOpen] = useState(false)
  const activeCount = [approval, vesselQ.trim(), purpose].filter(Boolean).length

  return (
    <>
      <div className="plans-toolbar">
        <PlanSourceFilter chips={sourceChips} selected={sourceFilter} onChange={onSourceChange} />
        <button
          type="button"
          className={`plans-toolbar__filters-btn${open || activeCount > 0 ? ' plans-toolbar__filters-btn--active' : ''}`}
          aria-expanded={open}
          aria-controls="plans-filters-panel"
          onClick={() => setOpen((o) => !o)}
        >
          <FilterIcon />
          {t('filters')}
          {activeCount > 0 ? <span className="plans-toolbar__badge">{activeCount}</span> : null}
        </button>
      </div>

      {open ? (
        <div id="plans-filters-panel" className="plans-filters">
          <label className="plans-filters__field">
            <span className="plans-filters__label">{t('filterApproval')}</span>
            <select
              className="plans-filters__control"
              value={approval}
              onChange={(e) => onApprovalChange(e.target.value)}
            >
              <option value="">{t('filterAll')}</option>
              {APPROVAL_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="plans-filters__field plans-filters__field--grow">
            <span className="plans-filters__label">{t('filterVesselLabel')}</span>
            <input
              type="search"
              className="plans-filters__control"
              value={vesselQ}
              onChange={(e) => onVesselChange(e.target.value)}
              placeholder={t('filterVessel')}
            />
          </label>
          <label className="plans-filters__field">
            <span className="plans-filters__label">{t('filterPanelPurpose')}</span>
            <select
              className="plans-filters__control"
              value={purpose}
              onChange={(e) => onPurposeChange(e.target.value)}
              disabled={!purposes?.length}
            >
              <option value="">{t('filterAll')}</option>
              {(purposes || []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label || p.code || `Purpose ${p.id}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="plans-filters__clear" disabled={activeCount === 0} onClick={onClear}>
            {t('reset')}
          </button>
        </div>
      ) : null}
    </>
  )
}
