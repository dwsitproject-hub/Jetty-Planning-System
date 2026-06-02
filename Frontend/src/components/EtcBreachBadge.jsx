import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { formatOverdueDuration } from '../utils/etcBreach'
import '../styles/etc-breach.css'

function ClockAlertIcon({ className }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm1 11h-2V7h2Zm0 4h-2v-2h2Z"
      />
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/**
 * Compact ETC breach indicator — icon + duration text (colorblind-safe).
 * @param {{ overMs: number, etcMs?: number, size?: 'sm'|'md'|'icon-only', onClick?: (e: Event) => void, className?: string, title?: string }} props
 */
export default function EtcBreachBadge({
  overMs,
  etcMs,
  size = 'sm',
  onClick,
  className = '',
  title,
}) {
  const { t } = useTranslation('common')
  const duration = formatOverdueDuration(overMs)
  const etcLabel = etcMs != null ? formatDateTimeDisplay(new Date(etcMs).toISOString()) : null
  const defaultTitle =
    etcLabel != null
      ? t('etcBreach.tooltip', {
          duration,
          etc: etcLabel,
          defaultValue: `ETC breached · ${duration} · Est. completion ${etcLabel}`,
        })
      : t('etcBreach.overdue', { duration, defaultValue: `${duration} over ETC` })

  const ariaLabel = t('etcBreach.ariaLabel', {
    duration,
    defaultValue: `ETC breached, ${duration} over estimated completion`,
  })

  const showText = size !== 'icon-only'
  const Tag = onClick ? 'button' : 'span'
  const tagProps = onClick
    ? { type: 'button', onClick }
    : {}

  return (
    <Tag
      className={`etc-breach-badge etc-breach-badge--${size}${onClick ? ' etc-breach-badge--interactive' : ''} ${className}`.trim()}
      title={title ?? defaultTitle}
      aria-label={ariaLabel}
      {...tagProps}
    >
      <ClockAlertIcon className="etc-breach-badge__icon" />
      {showText ? <span className="etc-breach-badge__text">{duration}</span> : null}
    </Tag>
  )
}
