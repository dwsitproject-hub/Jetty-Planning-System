import { useTranslation } from 'react-i18next'
import { hubSdkEnabled, openHubBugReport } from '../lib/hubSdk'

function BugIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2l1.5 2" />
      <path d="M16 2l-1.5 2" />
      <path d="M9 9h6" />
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M4 10h4" />
      <path d="M16 10h4" />
      <path d="M4 14h4" />
      <path d="M16 14h4" />
      <path d="M12 18v3" />
    </svg>
  )
}

export default function ReportBugButton() {
  const { t } = useTranslation('common')
  if (!hubSdkEnabled()) return null
  const label = t('reportBug')
  return (
    <button type="button" className="topbar__bug-btn" title={label} aria-label={label} onClick={() => openHubBugReport()}>
      <BugIcon />
    </button>
  )
}
