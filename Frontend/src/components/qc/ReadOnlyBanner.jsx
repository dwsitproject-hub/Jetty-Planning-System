import { useTranslation } from 'react-i18next'

/** Top-of-entry notice that a sailed vessel's field-menu data is view only. */
export default function ReadOnlyBanner({ ns = 'qc' }) {
  const { t } = useTranslation(ns)
  return (
    <div className="qc-banner qc-banner--readonly" role="status">
      <strong className="qc-banner__title">{t('entry.readOnlyTitle')}</strong>
      <span>{t('entry.readOnlyText')}</span>
    </div>
  )
}
