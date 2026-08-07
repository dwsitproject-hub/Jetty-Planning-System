import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function OperatorEditTimestampModal({ open, title, initialLocal, busy, onCancel, onSave }) {
  const { t } = useTranslation('operator')
  const [value, setValue] = useState(initialLocal || '')

  useEffect(() => {
    if (open) setValue(initialLocal || '')
  }, [open, initialLocal])

  if (!open) return null

  const dialogTitle = title || t('modal.editTimestamp')

  return (
    <div className="operator-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="operator-modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{dialogTitle}</h2>
        <div>
          <label htmlFor="operator-edit-ts">{t('modal.dateTime')}</label>
          <input
            id="operator-edit-ts"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="operator-modal__actions">
          <button type="button" className="op-btn" onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={busy || !value}
            onClick={() => onSave(value)}
          >
            {t('action.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
