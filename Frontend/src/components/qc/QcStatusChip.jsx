import { useTranslation } from 'react-i18next'

const ICONS = { not_started: '○', draft: '◐', done: '✓' }

/** Step state chip. The icon carries the state as well as colour (colour-blind safe). */
export default function QcStatusChip({ status = 'not_started', ns = 'qc' }) {
  const { t } = useTranslation(ns)
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
