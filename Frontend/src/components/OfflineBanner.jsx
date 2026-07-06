import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/**
 * Thin fixed banner shown only while offline. Additive and non-intrusive: it
 * renders nothing when online, so it never affects the normal (online) UI.
 */
export default function OfflineBanner() {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span className="offline-banner__dot" aria-hidden />
      {t('offlineBanner', {
        defaultValue: 'Offline — you can keep working; changes will sync when the connection returns.',
      })}
    </div>
  )
}
