/**
 * Validate partner-supplied document URLs (integration API v5.1+).
 * HTTP and HTTPS are accepted (internal document hosts often lack TLS).
 */
export const PARTNER_DOCUMENT_URL_MAX_LEN = 2048;

const INVALID_DOCUMENT_URL_ISSUE = 'must be a valid HTTP or HTTPS URL';

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string | null } | { ok: false, issue: string }}
 */
export function parsePartnerDocumentUrl(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: null };
  if (s.length > PARTNER_DOCUMENT_URL_MAX_LEN) {
    return { ok: false, issue: `max length ${PARTNER_DOCUMENT_URL_MAX_LEN}` };
  }
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return { ok: true, value: s };
    return { ok: false, issue: INVALID_DOCUMENT_URL_ISSUE };
  } catch {
    return { ok: false, issue: INVALID_DOCUMENT_URL_ISSUE };
  }
}

/**
 * @param {Record<string, unknown>} body
 * @param {(field: string, issue: string) => void} push
 * @returns {{ siDocumentUrl?: string | null, contractDocumentUrl?: string | null, blDocumentUrl?: string | null }}
 */
export function parseOptionalPartnerDocumentUrls(body, push) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};

  if (b.shipping_instruction_document_url !== undefined) {
    const r = parsePartnerDocumentUrl(b.shipping_instruction_document_url);
    if (!r.ok) push('shipping_instruction_document_url', r.issue);
    else out.siDocumentUrl = r.value;
  }
  if (b.contract_document_url !== undefined) {
    const r = parsePartnerDocumentUrl(b.contract_document_url);
    if (!r.ok) push('contract_document_url', r.issue);
    else out.contractDocumentUrl = r.value;
  }
  if (b.bl_document_url !== undefined) {
    const r = parsePartnerDocumentUrl(b.bl_document_url);
    if (!r.ok) push('bl_document_url', r.issue);
    else out.blDocumentUrl = r.value;
  }

  return out;
}
