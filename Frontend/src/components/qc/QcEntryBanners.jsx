import { useTranslation } from 'react-i18next'

/** Status banners on the entry screen: restored draft, save conflict, sample error, last message. */
export default function QcEntryBanners({ entry, message, onOverwrite, ns = 'qc' }) {
  const { t } = useTranslation(ns)

  return (
    <>
      {entry.restored ? (
        <div className="qc-banner" role="status">
          <span>{t('entry.restoredDraft')}</span>
          <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={entry.discardLocalDraft}>
            {t('entry.discardDraft')}
          </button>
        </div>
      ) : null}
      {entry.conflict ? (
        <div className="operator-error-banner qc-conflict" role="alert">
          <p>{t('conflict.message')}</p>
          <div className="qc-conflict__actions">
            <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={entry.reload}>
              {t('conflict.reload')}
            </button>
            <button
              type="button"
              className="op-btn op-btn--soft op-btn--compact"
              onClick={() => onOverwrite(entry.conflict.mode)}
            >
              {t('conflict.overwrite')}
            </button>
          </div>
        </div>
      ) : null}
      {entry.recordError ? (
        <p className="operator-error-banner" role="alert">
          {t('save.recordError', { message: entry.recordError })}
        </p>
      ) : null}
      {message ? (
        <p className={message.type === 'error' ? 'operator-error-banner' : 'qc-banner qc-banner--ok'} role="status">
          {message.text}
        </p>
      ) : null}
    </>
  )
}
