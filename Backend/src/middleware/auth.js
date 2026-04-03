/**
 * JWT auth (Step 1.9). Bearer token OR HttpOnly cookie jps_at (H-1).
 */
import jwt from 'jsonwebtoken';
import { COOKIE_ACCESS_TOKEN } from '../lib/auth-cookies.js';

const JWT_SECRET = process.env.JWT_SECRET;

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const fromCookie = req.cookies?.[COOKIE_ACCESS_TOKEN];
  if (fromCookie && typeof fromCookie === 'string') {
    return fromCookie;
  }
  return null;
}

/** If token is valid, sets req.userId; otherwise continues without auth (for activity logging). */
export function optionalAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return next();
  }
  if (!JWT_SECRET) {
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId ?? payload.sub;
    if (userId != null) {
      req.userId = Number(userId);
    }
  } catch {
    /* ignore invalid token */
  }
  next();
}

export function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId ?? payload.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = Number(userId);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
