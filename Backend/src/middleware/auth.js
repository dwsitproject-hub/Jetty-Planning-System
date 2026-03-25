/**
 * JWT auth middleware (Step 1.9). Sets req.userId when Authorization: Bearer <token> is valid.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

/** If Bearer token is valid, sets req.userId; otherwise continues without auth (for activity logging). */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.slice(7);
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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token required' });
  }
  const token = authHeader.slice(7);
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
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
