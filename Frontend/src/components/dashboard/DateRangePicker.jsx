import { useState } from 'react'
import { getMonthRange, getRelativeRange } from '../../utils/dashboardPageUtils'

const PRESETS = [
  { key: 'thisMonth', labelKey: 'v2DateThisMonth', getRange: () => getMonthRange(0) },
  { key: 'lastMonth', labelKey: 'v2DateLastMonth', getRange: () => getMonthRange(-1) },
  { key: 'last7d', labelKey: 'v2DateLast7d', getRange: () => getRelativeRange(7) },
  { key: 'last30d', labelKey: 'v2DateLast30d', getRange: () => getRelativeRange(30) },
]

export default function DateRangePicker({ startDate, endDate, onChange, t }) {
  const [activePreset, setActivePreset] = useState('thisMonth')

  const handlePreset = (preset) => {
    setActivePreset(preset.key)
    onChange(preset.getRange())
  }

  const handleStartChange = (e) => {
    setActivePreset('custom')
    onChange({ startDate: e.target.value, endDate })
  }

  const handleEndChange = (e) => {
    setActivePreset('custom')
    onChange({ startDate, endDate: e.target.value })
  }

  return (
    <div className="v2-date-range">
      <div className="v2-date-range__presets">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`v2-date-range__preset${activePreset === p.key ? ' is-active' : ''}`}
            onClick={() => handlePreset(p)}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      <div className="v2-date-range__inputs">
        <label className="v2-date-range__label">
          <span>{t('v2DateFrom')}</span>
          <input
            type="date"
            className="v2-date-range__input"
            value={startDate}
            onChange={handleStartChange}
          />
        </label>
        <span className="v2-date-range__sep">–</span>
        <label className="v2-date-range__label">
          <span>{t('v2DateTo')}</span>
          <input
            type="date"
            className="v2-date-range__input"
            value={endDate}
            onChange={handleEndChange}
          />
        </label>
      </div>
    </div>
  )
}
