const DOCUMENT_FIELDS = [
  { key: 'si', labelKey: 'partnerDocSi', field: 'partnerSiDocumentUrl' },
  { key: 'contract', labelKey: 'partnerDocContract', field: 'partnerContractDocumentUrl' },
  { key: 'bl', labelKey: 'partnerDocBl', field: 'partnerBlDocumentUrl' },
]

const MAX_DISPLAY_CHARS = 48

function parseHttpUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function shortenUrl(u) {
  const path = u.pathname === '/' ? '' : u.pathname
  const text = `${u.host}${path}${u.search}`
  return text.length > MAX_DISPLAY_CHARS ? `${text.slice(0, MAX_DISPLAY_CHARS - 1)}…` : text
}

/**
 * Valid http(s) partner document links in fixed order (SI, contract, B/L).
 * @param {Record<string, unknown> | null | undefined} si
 * @returns {{ key: string, labelKey: string, url: string, host: string, display: string }[]}
 */
export function partnerDocumentLinks(si) {
  if (!si) return []
  return DOCUMENT_FIELDS.flatMap(({ key, labelKey, field }) => {
    const u = parseHttpUrl(si[field])
    return u ? [{ key, labelKey, url: u.href, host: u.host, display: shortenUrl(u) }] : []
  })
}
