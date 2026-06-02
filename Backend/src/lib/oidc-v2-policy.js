/**
 * SSO v2 policy: email_verified gate + optional domain allowlist (SSO-INTEGRATION-GUIDE §4).
 */

export function normalizeEmail(s) {
  if (typeof s !== 'string') return '';
  return s.trim().toLowerCase();
}

/** Hub sets email_verified true only after inbox proof (magic link). */
export function isEmailVerified(claims) {
  return claims?.email_verified === true;
}

/**
 * Parses OIDC_EMAIL_DOMAIN_ALLOWLIST: comma-separated entries like @corp.com or corp.com.
 * Empty env = no restriction (any domain).
 */
export function parseDomainAllowlistFromEnv() {
  const raw = process.env.OIDC_EMAIL_DOMAIN_ALLOWLIST || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('@') ? s : `@${s}`));
}

/**
 * If allowlist is empty, returns true. Otherwise email must match at least one suffix (e.g. ends with @company.com).
 */
export function emailMatchesDomainPolicy(normalizedEmail, suffixes) {
  if (!suffixes || suffixes.length === 0) return true;
  const e = normalizeEmail(normalizedEmail);
  if (!e || !e.includes('@')) return false;
  return suffixes.some((sfx) => e.endsWith(sfx));
}

export function isV2SilentLinkEnabled() {
  return String(process.env.OIDC_V2_SILENT_LINK || '').toLowerCase() === 'true';
}
