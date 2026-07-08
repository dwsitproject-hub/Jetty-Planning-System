import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

let discoveryCache = null;
let discoveryAt = 0;
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      if (text) detail = `: ${text.slice(0, 300)}`;
    } catch {
      // ignore body parse issues for error paths
    }
    throw new Error(`OIDC HTTP ${res.status} for ${url}${detail}`);
  }
  return res.json();
}

export async function getDiscoveryDocument(discoveryUrl) {
  const now = Date.now();
  if (discoveryCache && now - discoveryAt < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const doc = await fetchJson(discoveryUrl);
  discoveryCache = doc;
  discoveryAt = now;
  return doc;
}

export async function exchangeAuthorizationCode({ tokenEndpoint, code, redirectUri, clientId, codeVerifier }) {
  return fetchJson(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
}

export async function validateIdToken({ idToken, issuer, audience, jwksUri }) {
  const header = decodeProtectedHeader(idToken);
  if (header.alg !== 'RS256') {
    const e = new Error('Unsupported id_token alg');
    e.statusCode = 401;
    throw e;
  }
  const JWKS = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer,
    audience,
  });
  if (!payload?.sub || typeof payload.sub !== 'string') {
    const e = new Error('id_token sub is required');
    e.statusCode = 401;
    throw e;
  }
  return payload;
}
