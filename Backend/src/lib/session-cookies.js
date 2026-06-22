/**
 * Issue JPS session cookies (same contract as POST /api/v1/auth/login).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  COOKIE_ACCESS_TOKEN,
  COOKIE_XSRF,
  cookieBaseOptions,
  jwtExpiresInToMs,
} from './auth-cookies.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

/**
 * @param {import('express').Response} res
 * @param {number} userId Jetty users.id
 * @returns {string} Signed JWT (same as Set-Cookie value)
 */
export function setSessionCookiesForUserId(res, userId) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }
  const token = jwt.sign({ userId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });
  const base = cookieBaseOptions();
  const maxAge = jwtExpiresInToMs(JWT_EXPIRES_IN);
  const xsrf = crypto.randomBytes(32).toString('hex');
  res.cookie(COOKIE_ACCESS_TOKEN, token, {
    ...base,
    httpOnly: true,
    maxAge,
  });
  res.cookie(COOKIE_XSRF, xsrf, {
    ...base,
    httpOnly: false,
    maxAge,
  });
  return token;
}
