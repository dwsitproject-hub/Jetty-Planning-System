/**
 * HttpOnly session cookie + readable XSRF cookie names (H-1, CSRF defense).
 *
 * In production, `secure: true` is the default so cookies are HTTPS-only.
 * If the SPA is served over plain HTTP (e.g. internal IP:3080), browsers will
 * not accept or send Secure cookies — set COOKIE_SECURE=false on the API.
 */
export const COOKIE_ACCESS_TOKEN = 'jps_at';
export const COOKIE_XSRF = 'jps_xsrf';

function cookieSecure() {
  const raw = process.env.COOKIE_SECURE;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  }
  return process.env.NODE_ENV === 'production';
}

export function cookieBaseOptions() {
  return {
    path: '/',
    sameSite: 'lax',
    secure: cookieSecure(),
  };
}

/** Parse JWT_EXPIRES_IN style string to milliseconds for Cookie maxAge. */
export function jwtExpiresInToMs(exp) {
  const raw = String(exp || '8h').trim();
  const m = raw.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return 8 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mult[u];
}
