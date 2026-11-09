import { useTranslation } from 'react-i18next'
import '../styles/partner-documents.css'

function ExternalMark() {
  return (
    <svg className="partner-docs__ext" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9 2.75A.75.75 0 0 1 9.75 2h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V4.56L7.78 8.78a.75.75 0 0 1-1.06-1.06l4.22-4.22H9.75A.75.75 0 0 1 9 2.75ZM3.5 4A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9.5a.75.75 0 0 0-1.5 0v3h-7v-7h3a.75.75 0 0 0 0-1.5h-3Z"
      />
    </svg>
  )
}

/** Rows for the links returned by `partnerDocumentLinks(si)`. */
export default function PartnerDocumentLinks({ links }) {
  const { t } = useTranslation('shippingInstruction')
  if (!links?.length) return null

  return (
    <ul className="partner-docs__list">
      {links.map((link) => {
        const label = t(link.labelKey)
        return (
          <li key={link.key}>
            <a
              className="partner-docs__link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.url}
              aria-label={t('partnerDocLinkAria', { document: label, host: link.host })}
            >
              <span className="partner-docs__name">{label}</span>
              <span className="partner-docs__url">
                {link.display}
                <ExternalMark />
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
