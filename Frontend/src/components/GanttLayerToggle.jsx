import { useTranslation } from 'react-i18next'
import { GANTT_LAYER_MODES } from '../utils/ganttLayerMode.js'

const LABEL_KEYS = {
  both: 'ganttLayerBoth',
  planned: 'ganttLayerPlanned',
  actual: 'ganttLayerActual',
}

const DEFAULTS = {
  both: 'Both',
  planned: 'Planned',
  actual: 'Actual',
}

export default function GanttLayerToggle({ value, onChange, idPrefix = 'gantt-layer' }) {
  const { t } = useTranslation('allocation')

  return (
    <fieldset className="jetty-schedule-gantt__layer-toggle-field">
      <legend className="jetty-schedule-gantt__layer-toggle-legend">
        {t('ganttLayerShow', { defaultValue: 'Show' })}
      </legend>
      <div
        className="jetty-schedule-gantt__layer-toggle"
        role="radiogroup"
        aria-label={t('ganttLayerAria', { defaultValue: 'Schedule layers' })}
      >
        {GANTT_LAYER_MODES.map((mode) => {
          const inputId = `${idPrefix}-${mode}`
          const label = t(LABEL_KEYS[mode], { defaultValue: DEFAULTS[mode] })
          return (
            <label
              key={mode}
              className={`jetty-schedule-gantt__layer-toggle-option${value === mode ? ' jetty-schedule-gantt__layer-toggle-option--active' : ''}`}
            >
              <input
                id={inputId}
                type="radio"
                name={`${idPrefix}-group`}
                value={mode}
                checked={value === mode}
                onChange={() => onChange(mode)}
              />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
