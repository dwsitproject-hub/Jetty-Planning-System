import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { cookieBaseOptions } from './auth-cookies.js';

export const OIDC_FLOW_COOKIE = 'jps_oidc_flow';

function b64url(input) {
  return input.toString('base64url');
}

export function createPkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function createState() {
  return b64url(crypto.randomBytes(24));
}

export function createSignedState(payload = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const verifier = typeof payload.verifier === 'string' ? payload.verifier : '';
  if (!verifier) throw new Error('OIDC verifier is required');
  const mode = typeof payload.mode === 'string' ? payload.mode : 'login';
  const targetUserId =
    Number.isFinite(Number(payload.targetUserId)) && Number(payload.targetUserId) > 0
      ? Number(payload.targetUserId)
      : null;
  const expectedEmail =
    typeof payload.expectedEmail === 'string' && payload.expectedEmail.trim()
      ? payload.expectedEmail.trim().toLowerCase()
      : null;
  return jwt.sign(
    {
      type: 'oidc_state',
      nonce: createState(),
      verifier,
      mode,
      targetUserId,
      expectedEmail,
    },
    secret,
    { expiresIn: '10m' }
  );
}

export function readSignedState(stateToken) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !stateToken) return null;
  try {
    const decoded = jwt.verify(stateToken, secret);
    if (decoded?.type !== 'oidc_state') return null;
    if (typeof decoded?.verifier !== 'string' || !decoded.verifier) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function setOidcFlowCookie(res, payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const token = jwt.sign(payload, secret, { expiresIn: '10m' });
  const base = cookieBaseOptions();
  res.cookie(OIDC_FLOW_COOKIE, token, {
    ...base,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
}

export function readOidcFlowCookie(req) {
  const secret = process.env.JWT_SECRET;
  const token = req?.cookies?.[OIDC_FLOW_COOKIE];
  if (!secret || !token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

export function clearOidcFlowCookie(res) {
  const base = cookieBaseOptions();
  res.clearCookie(OIDC_FLOW_COOKIE, { path: base.path });
}
