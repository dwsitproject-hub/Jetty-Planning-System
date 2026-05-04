const DEFAULT_DISCOVERY_PATH = '/api/sso/.well-known/openid-configuration';

function asBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function ensureNoTrailingSlash(v) {
  return v.replace(/\/$/, '');
}

export function getOidcConfig() {
  const issuer = ensureNoTrailingSlash(trim(process.env.OIDC_ISSUER));
  const discoveryUrl = trim(process.env.OIDC_DISCOVERY_URL) || (issuer ? `${issuer}${DEFAULT_DISCOVERY_PATH}` : '');
  return {
    enabled: asBool(process.env.SSO_OIDC_ENABLED, false),
    issuer,
    discoveryUrl,
    clientId: trim(process.env.OIDC_CLIENT_ID),
    redirectUri: trim(process.env.OIDC_REDIRECT_URI),
    scopes: trim(process.env.OIDC_SCOPES) || 'openid profile email',
    legacyBridgeEnabled: asBool(process.env.SSO_LEGACY_BRIDGE_ENABLED, true),
  };
}

export function assertOidcConfigured() {
  const cfg = getOidcConfig();
  if (!cfg.enabled) return cfg;
  const missing = [];
  if (!cfg.issuer) missing.push('OIDC_ISSUER');
  if (!cfg.discoveryUrl) missing.push('OIDC_DISCOVERY_URL');
  if (!cfg.clientId) missing.push('OIDC_CLIENT_ID');
  if (!cfg.redirectUri) missing.push('OIDC_REDIRECT_URI');
  if (missing.length) {
    const e = new Error(`OIDC is enabled but missing config: ${missing.join(', ')}`);
    e.statusCode = 503;
    throw e;
  }
  return cfg;
}
