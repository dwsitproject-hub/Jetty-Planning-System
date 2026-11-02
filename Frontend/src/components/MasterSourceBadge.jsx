import { useTranslation } from 'react-i18next'

const SOURCE_KINDS = {
  datahub: {
    labelKey: 'masterSourceDataHub',
    hintKey: 'masterSourceDataHubHint',
  },
  local: {
    labelKey: 'masterSourceLocal',
    hintKey: 'masterSourceLocalHint',
  },
  tankvision: {
    labelKey: 'masterSourceTankvision',
    hintKey: 'masterSourceTankvisionHint',
  },
}

function SourceIcon({ kind }) {
  if (kind === 'datahub') {
    return (
      <svg className="master-source-badge__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.4 9.6 9.6 6.4M7.1 4.5l.9-.9a2.2 2.2 0 0 1 3.1 3.1l-.9.9M8.9 11.5l-.9.9a2.2 2.2 0 0 1-3.1-3.1l.9-.9"
        />
      </svg>
    )
  }
  if (kind === 'local') {
    return (
      <svg className="master-source-badge__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.8 2.8 13.2 5.2 5.6 12.8H3.2V10.4L10.8 2.8z"
        />
      </svg>
    )
  }
  return (
    <svg className="master-source-badge__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.2 11.2a4.8 4.8 0 1 1 9.6 0M8 11.2 10.6 7.4"
      />
    </svg>
  )
}

export default function MasterSourceBadge({ kind }) {
  const { t } = useTranslation('pages')
  const spec = SOURCE_KINDS[kind]
  if (!spec) return null

  return (
    <span
      className={`master-hub-badge master-source-badge master-source-badge--${kind}`}
      title={t(spec.hintKey)}
    >
      <SourceIcon kind={kind} />
      {t(spec.labelKey)}
    </span>
  )
}
