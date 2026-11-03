import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'

function formatTime(value) {
  if (!value) return null
  const iso = typeof value === 'number' ? new Date(value).toISOString() : value
  return formatDateTimeDisplay(iso)
}

/** Sticky bottom bar: Save draft / Save final and a saved-state indicator. */
export default function QcSaveBar({ saving, dirty, lastSavedAt, localSavedAt, onSave }) {
  const { t } = useTranslation('qc')
  let indicator = null
  if (dirty) {
    const local = formatTime(localSavedAt)
    indicator = local ? t('save.localAt', { time: local }) : t('save.unsaved')
  } else if (lastSavedAt) {
    indicator = t('save.savedAt', { time: formatTime(lastSavedAt) })
  }

  return (
    <div className="qc-save-bar">
      {indicator ? (
        <p className={`qc-save-bar__state${dirty ? ' qc-save-bar__state--dirty' : ''}`} role="status">
          {indicator}
        </p>
      ) : null}
      <div className="qc-save-bar__actions">
        <button type="button" className="op-btn op-btn--soft" disabled={saving} onClick={() => onSave('draft')}>
          {saving ? t('save.saving') : t('save.draft')}
        </button>
        <button type="button" className="op-btn op-btn--primary" disabled={saving} onClick={() => onSave('final')}>
          {saving ? t('save.saving') : t('save.final')}
        </button>
      </div>
    </div>
  )
}
