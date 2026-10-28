import { useTranslation } from 'react-i18next'

const ICONS = { not_started: '○', draft: '◐', done: '✓' }

/** Sampling state chip. The icon carries the state as well as colour (colour-blind safe). */
export default function QcStatusChip({ status = 'not_started' }) {
  const { t } = useTranslation('qc')
  const key = ICONS[status] ? status : 'not_started'
  return (
    <span className={`qc-chip qc-chip--${key}`}>
      <span className="qc-chip__icon" aria-hidden>
        {ICONS[key]}
      </span>
      {t(`status.${key}`)}
    </span>
  )
}
