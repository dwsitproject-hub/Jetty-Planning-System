import bcrypt from 'bcrypt';
import crypto from 'crypto';
import express from 'express';
import { pool } from '../db.js';
import { logAuthEvent } from '../lib/auth-events.js';
import { exchangeAuthorizationCode, getDiscoveryDocument, validateIdToken } from '../lib/oidc-client.js';
import { assertOidcConfigured } from '../lib/oidc-config.js';
import {
  clearOidcFlowCookie,
  createPkcePair,
  createSignedState,
  readOidcFlowCookie,
  readSignedState,
  setOidcFlowCookie,
} from '../lib/oidc-flow.js';
import { setSessionCookiesForUserId } from '../lib/session-cookies.js';
import { optionalAuth } from '../middleware/auth.js';
import {
  emailMatchesDomainPolicy,
  isEmailVerified,
  isV2SilentLinkEnabled,
  normalizeEmail,
  parseDomainAllowlistFromEnv,
} from '../lib/oidc-v2-policy.js';

const router = express.Router();
const PUBLIC_ORIGIN = (process.env.JPS_PUBLIC_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
const OIDC_JIT_PROVISION = String(process.env.OIDC_JIT_PROVISION || '').toLowerCase() === 'true';
const OIDC_ALLOW_QUERY_CODE_VERIFIER = String(process.env.OIDC_ALLOW_QUERY_CODE_VERIFIER || '').toLowerCase() === 'true';

/** Plain GET smoke test: confirms /auth reaches Node without DB (use curl from host). */
router.get('/oidc/ready', (req, res) => {
  res.type('text/plain').send('ok');
});

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/'/g, '&#39;');
}

function absoluteRequestUrl(req) {
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000').split(',')[0].trim();
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${host}${req.originalUrl}`;
}

/** IdP redirects here; if the document loads in an iframe, promote the same URL to the top window before running token exchange. */
function sendOidcCallbackIframeBreakout(res, req) {
  const target = absoluteRequestUrl(req);
  const safeJs = JSON.stringify(target);
  logAuthEvent('oidc.callback.iframe_breakout', { ip: req.ip });
  const href = escapeHtmlAttr(target);
  return res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Continue sign-in</title></head><body>
<script>try{window.top.location.replace(${safeJs});}catch(e){window.location.replace(${safeJs});}</script>
<noscript><p><a href="${href}" target="_top">Continue sign-in</a></p></noscript>
</body></html>`);
}

/** When Jetty is opened inside an iframe, a 302 to the IdP stays in the iframe; HTML+script promotes top window before IdP redirect. */
function sendOidcStartBrowserBreakout(res, authUrlString) {
  const safeJs = JSON.stringify(authUrlString);
  const href = escapeHtmlAttr(authUrlString);
  return res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Continue sign-in</title></head><body>
<script>try{window.top.location.replace(${safeJs});}catch(e){window.location.replace(${safeJs});}</script>
<noscript><p><a href="${href}" target="_top">Continue sign-in</a></p></noscript>
</body></html>`);
}

router.get('/oidc/start', async (req, res, next) => {
  try {
    const cfg = assertOidcConfigured();
    if (!cfg.enabled) {
      return res.status(410).type('html').send(
        '<!DOCTYPE html><html><body><p>OIDC SSO is disabled on this server. Use legacy SSO launch flow.</p></body></html>',
      );
    }
    const discovery = await getDiscoveryDocument(cfg.discoveryUrl);
    const { verifier, challenge, method } = createPkcePair();
    const mode = typeof req.query?.mode === 'string' ? req.query.mode.trim() : 'login';
    const statePayload = { verifier, mode };
    if (mode === 'admin_prelink') {
      const targetUserId = Number(req.query?.target_user_id);
      const expectedEmail =
        typeof req.query?.expected_email === 'string' ? req.query.expected_email.trim() : '';
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Invalid target user' });
      }
      if (!expectedEmail) {
        return res.status(400).json({ error: 'Missing expected email' });
      }
      statePayload.targetUserId = targetUserId;
      statePayload.expectedEmail = expectedEmail;
    }
    const state = createSignedState(statePayload);
    setOidcFlowCookie(res, { state, verifier });
    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', cfg.clientId);
    authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
    authUrl.searchParams.set('scope', cfg.scopes);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', method);
    const authUrlString = authUrl.toString();
    logAuthEvent('oidc.start.redirect', { ip: req.ip });
    const accept = req.get('Accept') || '';
    if (accept.includes('text/html')) {
      return sendOidcStartBrowserBreakout(res, authUrlString);
    }
    return res.redirect(302, authUrlString);
  } catch (err) {
    logAuthEvent('oidc.start.failure', { reason: err.message, ip: req.ip });
    return next(err);
  }
});

router.get('/oidc/callback', optionalAuth, async (req, res) => {
  const accept = req.get('Accept') || '';
  const secFetchDest = (req.get('Sec-Fetch-Dest') || '').toLowerCase();
  if (accept.includes('text/html') && secFetchDest === 'iframe') {
    return sendOidcCallbackIframeBreakout(res, req);
  }

  const clearAndFail = (status, message, reason) => {
    clearOidcFlowCookie(res);
    logAuthEvent('oidc.callback.failure', { reason, ip: req.ip, code: req.query?.code });
    return res.status(status).type('html').send(`<!DOCTYPE html><html><body><p>${message}</p></body></html>`);
  };
  try {
    const cfg = assertOidcConfigured();
    if (!cfg.enabled) {
      return clearAndFail(410, 'OIDC SSO is disabled on this server.', 'oidc_disabled');
    }
    const flow = readOidcFlowCookie(req);
    const code = typeof req.query?.code === 'string' ? req.query.code : '';
    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    const queryCodeVerifier = typeof req.query?.code_verifier === 'string' ? req.query.code_verifier : '';
    const signedState = readSignedState(state);
    let codeVerifier = signedState?.verifier || '';
    if (!codeVerifier && OIDC_ALLOW_QUERY_CODE_VERIFIER && queryCodeVerifier) {
      codeVerifier = queryCodeVerifier;
      logAuthEvent('oidc.callback.warn', { reason: 'invalid_state_fallback_query_verifier', ip: req.ip });
    }
    if (!codeVerifier) {
      return clearAndFail(400, 'Invalid OIDC state.', 'invalid_state');
    }
    if (!code) {
      return clearAndFail(400, 'Missing authorization code.', 'missing_code');
    }
    if (flow?.state && flow?.verifier) {
      if (flow.state !== state) {
        logAuthEvent('oidc.callback.warn', { reason: 'state_cookie_mismatch_fallback_state_token', ip: req.ip });
      } else {
        codeVerifier = flow.verifier;
      }
    } else {
      logAuthEvent('oidc.callback.warn', { reason: 'missing_flow_cookie_fallback_state_token', ip: req.ip });
    }

    const discovery = await getDiscoveryDocument(cfg.discoveryUrl);
    const tokenSet = await exchangeAuthorizationCode({
      tokenEndpoint: discovery.token_endpoint,
      code,
      redirectUri: cfg.redirectUri,
      clientId: cfg.clientId,
      codeVerifier,
    });
    if (!tokenSet?.id_token) {
      return clearAndFail(401, 'OIDC token exchange failed.', 'missing_id_token');
    }

    const claims = await validateIdToken({
      idToken: tokenSet.id_token,
      issuer: cfg.issuer,
      audience: cfg.clientId,
      jwksUri: discovery.jwks_uri,
    });

    const mode = typeof signedState?.mode === 'string' ? signedState.mode : 'login';
    const oidcSub = claims.sub;
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    if (mode === 'connect_sso') {
      if (!isEmailVerified(claims)) {
        return clearAndFail(
          403,
          'Email not verified for SSO. Complete Hub verification (magic link), then try again.',
          'connect_sso_email_not_verified',
        );
      }
      const linkDomainList = parseDomainAllowlistFromEnv();
      if (!emailMatchesDomainPolicy(normalizeEmail(email), linkDomainList)) {
        return clearAndFail(403, 'Email domain is not allowed for SSO.', 'domain_not_allowed');
      }
      if (!req.userId) {
        return clearAndFail(401, 'Please sign in locally first, then connect SSO from Settings.', 'connect_sso_requires_session');
      }
      const me = await pool.query(
        `SELECT id, email, is_active FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [req.userId],
      );
      if (me.rows.length === 0 || !me.rows[0].is_active) {
        return clearAndFail(403, 'User not found or inactive.', 'connect_sso_user_not_found');
      }
      const myEmail = typeof me.rows[0].email === 'string' ? me.rows[0].email.trim().toLowerCase() : '';
      const tokenEmail = email.trim().toLowerCase();
      if (myEmail && tokenEmail && myEmail !== tokenEmail) {
        return clearAndFail(409, 'Hub account email does not match your Jetty account.', 'connect_sso_email_mismatch');
      }
      const collision = await pool.query(
        `SELECT id FROM users WHERE oidc_sub = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
        [oidcSub, req.userId],
      );
      if (collision.rows.length > 0) {
        return clearAndFail(409, 'This Hub identity is already linked to another Jetty user.', 'connect_sso_sub_collision');
      }
      await pool.query(
        `UPDATE users
         SET oidc_sub = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL`,
        [oidcSub, req.userId],
      );
      logAuthEvent('oidc.link.success', { userId: req.userId, mode: 'connect_sso', ip: req.ip });
      clearOidcFlowCookie(res);
      return res.redirect(302, `${PUBLIC_ORIGIN}/?sso_link=success`);
    }

    if (mode === 'admin_prelink') {
      if (!isEmailVerified(claims)) {
        return clearAndFail(
          403,
          'Email not verified for SSO. Complete Hub verification (magic link), then try again.',
          'admin_prelink_email_not_verified',
        );
      }
      const prelinkDomainList = parseDomainAllowlistFromEnv();
      if (!emailMatchesDomainPolicy(normalizeEmail(email), prelinkDomainList)) {
        return clearAndFail(403, 'Email domain is not allowed for SSO.', 'domain_not_allowed');
      }
      const targetUserId = Number(signedState?.targetUserId);
      const expectedEmail = typeof signedState?.expectedEmail === 'string' ? signedState.expectedEmail.trim().toLowerCase() : '';
      if (!Number.isFinite(targetUserId) || targetUserId <= 0 || !expectedEmail) {
        return clearAndFail(400, 'Invalid admin prelink state.', 'admin_prelink_state_invalid');
      }
      const tokenEmail = email.trim().toLowerCase();
      if (!tokenEmail || tokenEmail !== expectedEmail) {
        return clearAndFail(409, 'Hub account email does not match the target user.', 'admin_prelink_email_mismatch');
      }
      const target = await pool.query(
        `SELECT id, email, is_active FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [targetUserId],
      );
      if (target.rows.length === 0 || !target.rows[0].is_active) {
        return clearAndFail(404, 'Target user not found or inactive.', 'admin_prelink_target_missing');
      }
      const targetEmail = typeof target.rows[0].email === 'string' ? target.rows[0].email.trim().toLowerCase() : '';
      if (targetEmail && targetEmail !== expectedEmail) {
        return clearAndFail(409, 'Target user email changed. Ask admin to regenerate link.', 'admin_prelink_target_email_changed');
      }
      const collision = await pool.query(
        `SELECT id FROM users WHERE oidc_sub = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
        [oidcSub, targetUserId],
      );
      if (collision.rows.length > 0) {
        return clearAndFail(409, 'This Hub identity is already linked to another Jetty user.', 'admin_prelink_sub_collision');
      }
      await pool.query(
        `UPDATE users
         SET oidc_sub = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL`,
        [oidcSub, targetUserId],
      );
      setSessionCookiesForUserId(res, targetUserId);
      logAuthEvent('oidc.link.success', { userId: targetUserId, mode: 'admin_prelink', ip: req.ip });
      clearOidcFlowCookie(res);
      return res.redirect(302, `${PUBLIC_ORIGIN}/?sso_link=success`);
    }

    const displayName = typeof claims.name === 'string' ? claims.name.trim() : '';
    const emailNorm = normalizeEmail(email);
    const v2Enabled = isV2SilentLinkEnabled();
    const domainList = parseDomainAllowlistFromEnv();

    let user = await pool.query(
      `SELECT id, is_active FROM users WHERE oidc_sub = $1 AND deleted_at IS NULL LIMIT 1`,
      [oidcSub],
    );

    if (user.rows.length === 0 && v2Enabled && emailNorm) {
      const candidates = await pool.query(
        `SELECT id, is_active
         FROM users
         WHERE lower(email) = lower($1)
           AND deleted_at IS NULL
           AND auth_source = 'local'
           AND oidc_sub IS NULL`,
        [emailNorm],
      );
      if (candidates.rows.length > 1) {
        return clearAndFail(
          409,
          'Multiple accounts share this email. Contact administrator.',
          'ambiguous_email_match',
        );
      }
      if (candidates.rows.length === 1) {
        const row = candidates.rows[0];
        if (!row.is_active) {
          return clearAndFail(403, 'Your account is inactive.', 'inactive_user');
        }
        if (!isEmailVerified(claims)) {
          return clearAndFail(
            403,
            'Email not verified for SSO. Complete Hub verification (magic link), then try again.',
            'email_not_verified',
          );
        }
        if (!emailMatchesDomainPolicy(emailNorm, domainList)) {
          return clearAndFail(403, 'Email domain is not allowed for SSO.', 'domain_not_allowed');
        }
        const subCollision = await pool.query(
          `SELECT id FROM users WHERE oidc_sub = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
          [oidcSub, row.id],
        );
        if (subCollision.rows.length > 0) {
          return clearAndFail(
            409,
            'This Hub identity is already linked to another Jetty user.',
            'oidc_sub_collision',
          );
        }
        await pool.query(
          `UPDATE users SET oidc_sub = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
          [oidcSub, row.id],
        );
        logAuthEvent('oidc.v2.silent_bind', { userId: row.id, ip: req.ip });
        user = await pool.query(
          `SELECT id, is_active FROM users WHERE id = $1 AND deleted_at IS NULL`,
          [row.id],
        );
      }
    }

    if (user.rows.length === 0 && email && !v2Enabled) {
      const localCollision = await pool.query(
        `SELECT id FROM users WHERE lower(email) = lower($1) AND auth_source = 'local' AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      if (localCollision.rows.length > 0) {
        return clearAndFail(
          409,
          'SSO account is not linked. Contact administrator to link your SSO identity.',
          'email_collision_local_account',
        );
      }
    }

    if (user.rows.length === 0 && OIDC_JIT_PROVISION) {
      if (v2Enabled) {
        if (!emailNorm) {
          return clearAndFail(403, 'SSO sign-in requires an email claim in the ID token.', 'jit_missing_email');
        }
        if (!isEmailVerified(claims)) {
          return clearAndFail(
            403,
            'Email not verified for SSO. Complete Hub verification (magic link), then try again.',
            'jit_email_not_verified',
          );
        }
        if (!emailMatchesDomainPolicy(emailNorm, domainList)) {
          return clearAndFail(403, 'Email domain is not allowed for SSO.', 'domain_not_allowed');
        }
      }
      const usernameBase = (email.split('@')[0] || `sso_${oidcSub.slice(0, 8)}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const username = `oidc_${usernameBase}_${Math.random().toString(16).slice(2, 6)}`;
      const randomPw = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPw, 10);
      const inserted = await pool.query(
        `INSERT INTO users (username, display_name, email, password_hash, is_active, auth_source, oidc_sub)
         VALUES ($1, $2, NULLIF($3, ''), $4, TRUE, 'sso', $5)
         RETURNING id, is_active`,
        [username, displayName || usernameBase, email, passwordHash, oidcSub],
      );
      user = inserted;
    }

    if (user.rows.length === 0) {
      return clearAndFail(403, 'No linked SSO account found.', 'no_linked_sso_user');
    }
    if (!user.rows[0].is_active) {
      return clearAndFail(403, 'Your account is inactive.', 'inactive_user');
    }

    setSessionCookiesForUserId(res, user.rows[0].id);
    clearOidcFlowCookie(res);
    logAuthEvent('oidc.callback.success', { userId: user.rows[0].id, sub: oidcSub, ip: req.ip });
    return res.redirect(302, `${PUBLIC_ORIGIN}/`);
  } catch (err) {
    clearOidcFlowCookie(res);
    logAuthEvent('oidc.callback.failure', { reason: err.message, ip: req.ip });
    return res.status(500).type('html').send('<!DOCTYPE html><html><body><p>OIDC sign-in failed.</p></body></html>');
  }
});

export default router;
