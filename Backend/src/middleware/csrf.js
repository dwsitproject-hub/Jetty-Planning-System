import { COOKIE_ACCESS_TOKEN, COOKIE_XSRF } from '../lib/auth-cookies.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Double-submit CSRF: when session cookie is used (no Bearer), require X-XSRF-TOKEN
 * to match readable jps_xsrf cookie. Bearer-only clients skip (API scripts).
 */
export function csrfProtection(req, res, next) {
  if (!UNSAFE.has(req.method)) {
    return next();
  }
  const rel = req.path || '';
  if (rel === '/auth/login' || rel.startsWith('/auth/login')) {
    return next();
  }
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }
  const access = req.cookies?.[COOKIE_ACCESS_TOKEN];
  if (!access) {
    return next();
  }
  const xsrfCookie = req.cookies?.[COOKIE_XSRF];
  const xsrfHeader = req.get('X-XSRF-TOKEN');
  if (!xsrfCookie || !xsrfHeader || xsrfCookie !== xsrfHeader) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}
