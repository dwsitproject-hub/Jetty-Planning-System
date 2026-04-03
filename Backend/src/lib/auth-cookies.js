/**
 * HttpOnly session cookie + readable XSRF cookie names (H-1, CSRF defense).
 */
export const COOKIE_ACCESS_TOKEN = 'jps_at';
export const COOKIE_XSRF = 'jps_xsrf';

const isProd = process.env.NODE_ENV === 'production';

export function cookieBaseOptions() {
  return {
    path: '/',
    sameSite: 'lax',
    secure: isProd,
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
