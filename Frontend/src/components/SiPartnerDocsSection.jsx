import { useMemo } from 'react'
import { partnerDocumentLinks } from '../utils/partnerDocumentLinks'
import { usePartnerDocsTitle } from '../hooks/usePartnerDocsTitle'
import PartnerDocumentLinks from './PartnerDocumentLinks'
import '../styles/partner-documents.css'

/**
 * Persistent "partner docs" card: renders nothing unless `si` has at least one valid
 * partner document URL. Shared between SiDetailModal and the shipment plan modal's SI cards.
 */
export default function SiPartnerDocsSection({ si }) {
  const links = useMemo(() => partnerDocumentLinks(si), [si])
  const title = usePartnerDocsTitle(si?.partnerName)
  if (!links.length) return null
  return (
    <section className="partner-docs partner-docs--card" aria-label={title}>
      <h4 className="partner-docs__title">{title}</h4>
      <PartnerDocumentLinks links={links} />
    </section>
  )
}
