import { useTranslation } from 'react-i18next'
import { usePortScope } from '../context/PortScopeContext'

/**
 * Opens jetty schematic or schedule in a chromeless embed route (new browser window).
 * @param {{ mode: 'schematic' | 'schedule', profile?: 'plan' | 'legacy', className?: string }} props
 */
export default function VisualizationPopoutButton({
  mode,
  profile = 'plan',
  className = '',
}) {
  const { t } = useTranslation('allocation')
  const { selectedPortId } = usePortScope()

  const handleClick = () => {
    const params = new URLSearchParams()
    params.set('embed', '1')
    params.set('profile', profile === 'legacy' ? 'legacy' : 'plan')
    if (selectedPortId != null) {
      params.set('portId', String(selectedPortId))
    }
    const url = `${window.location.origin}/allocation/visualization/${mode}?${params.toString()}`
    // Keep window.opener so Full View can focus the Allocation tab on "Manage in Allocation".
    window.open(url, '_blank', 'noreferrer,width=1440,height=900')
  }

  const title = t('vizOpenFullViewHint', { defaultValue: 'Opens in a new window for a larger view' })

  return (
    <button
      type="button"
      className={`btn btn--secondary btn--small viz-popout-btn ${className}`.trim()}
      onClick={handleClick}
      title={title}
      aria-label={`${t('vizOpenFullView', { defaultValue: 'Open full view' })} — ${title}`}
    >
      <span className="viz-popout-btn__icon" aria-hidden>
        ↗
      </span>
      <span>{t('vizOpenFullView', { defaultValue: 'Open full view' })}</span>
    </button>
  )
}
