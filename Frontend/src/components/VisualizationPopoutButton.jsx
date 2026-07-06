import { useTranslation } from 'react-i18next'

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

  const handleClick = () => {
    const params = new URLSearchParams()
    params.set('embed', '1')
    params.set('profile', profile === 'legacy' ? 'legacy' : 'plan')
    const url = `${window.location.origin}/allocation/visualization/${mode}?${params.toString()}`
    window.open(url, '_blank', 'noopener,noreferrer,width=1440,height=900')
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
