import { useState } from 'react'
import { useTranslation } from 'react-i18next'

function formatLineTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString()
  } catch {
    return String(iso)
  }
}

export default function OperatorActivitySheet({ items }) {
  const { t } = useTranslation('operator')
  const [open, setOpen] = useState(false)
  const list = Array.isArray(items) ? items : []

  return (
    <div className="operator-activity-sheet">
      <button
        type="button"
        className="operator-activity-sheet__handle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▴'} {t('activity.recent', { count: list.length })}
      </button>
      {open ? (
        <ul className="operator-activity-sheet__list">
          {list.length === 0 ? (
            <li className="operator-activity-sheet__item">{t('activity.empty')}</li>
          ) : (
            list.map((item) => (
              <li key={item.id} className="operator-activity-sheet__item">
                {item.label}
                <time dateTime={item.at}>{formatLineTime(item.at)}</time>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
