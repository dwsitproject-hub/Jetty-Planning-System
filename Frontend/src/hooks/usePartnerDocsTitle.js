import { useTranslation } from 'react-i18next'

/** "{{partner}} documents" using the API key partner name, with a generic fallback. */
export function usePartnerDocsTitle(partnerName) {
  const { t } = useTranslation('shippingInstruction')
  const partner = typeof partnerName === 'string' && partnerName.trim() ? partnerName.trim() : t('partnerNameFallback')
  return t('partnerDocsTitle', { partner })
}
