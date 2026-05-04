import crypto from 'crypto';
import express from 'express';
import { pool } from '../db.js';
import { logAuthEvent } from '../lib/auth-events.js';
import { getDiscoveryDocument } from '../lib/oidc-client.js';
import { assertOidcConfigured } from '../lib/oidc-config.js';
import { createPkcePair, createSignedState } from '../lib/oidc-flow.js';
import { requireAdminPageView } from '../middleware/permissions.js';

const router = express.Router();
const jobs = new Map();

function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function summarize(items) {
  const summary = {
    total: items.length,
    ready: 0,
    needsReview: 0,
    blocked: 0,
    linked: 0,
    failedRetryable: 0,
    failedTerminal: 0,
  };
  for (const item of items) {
    if (item.previewStatus === 'ready_to_link') summary.ready += 1;
    if (item.previewStatus === 'needs_review') summary.needsReview += 1;
    if (item.previewStatus === 'blocked') summary.blocked += 1;
    if (item.finalStatus === 'linked') summary.linked += 1;
    if (item.finalStatus === 'failed_retryable') summary.failedRetryable += 1;
    if (item.finalStatus === 'failed_terminal') summary.failedTerminal += 1;
  }
  return summary;
}

async function evaluateRows(rows) {
  const items = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const email = normalizeEmail(row.email);
    const username = typeof row.username === 'string' ? row.username.trim() : '';
    if (!email) {
      items.push({
        rowIndex: i,
        email: row.email || '',
        username,
        previewStatus: 'blocked',
        finalStatus: 'blocked_email_mismatch',
        reasonCode: 'missing_email',
      });
      continue;
    }
    const userResult = await pool.query(
      `SELECT id, email, oidc_sub, is_active
       FROM users
       WHERE deleted_at IS NULL AND lower(email) = lower($1)
       ORDER BY id ASC`,
      [email]
    );
    if (userResult.rows.length !== 1) {
      items.push({
        rowIndex: i,
        email,
        username,
        previewStatus: userResult.rows.length > 1 ? 'needs_review' : 'blocked',
        finalStatus: userResult.rows.length > 1 ? null : 'failed_terminal',
        reasonCode: userResult.rows.length > 1 ? 'ambiguous_user_match' : 'missing_user',
      });
      continue;
    }
    const user = userResult.rows[0];
    if (!isTruthy(user.is_active)) {
      items.push({
        rowIndex: i,
        email,
        username,
        userId: user.id,
        previewStatus: 'blocked',
        finalStatus: 'blocked_inactive_user',
        reasonCode: 'inactive_user',
      });
      continue;
    }
    if (user.oidc_sub) {
      items.push({
        rowIndex: i,
        email,
        username,
        userId: user.id,
        previewStatus: 'blocked',
        finalStatus: 'skipped_already_linked',
        reasonCode: 'already_linked',
      });
      continue;
    }
    const oidcSub = typeof row.oidc_sub === 'string' ? row.oidc_sub.trim() : '';
    if (!oidcSub) {
      items.push({
        rowIndex: i,
        email,
        username,
        userId: user.id,
        previewStatus: 'needs_review',
        finalStatus: null,
        reasonCode: 'missing_idp_subject',
      });
      continue;
    }
    const collision = await pool.query(
      `SELECT id FROM users WHERE oidc_sub = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
      [oidcSub, user.id]
    );
    if (collision.rows.length > 0) {
      items.push({
        rowIndex: i,
        email,
        username,
        userId: user.id,
        oidcSub,
        previewStatus: 'blocked',
        finalStatus: 'blocked_collision',
        reasonCode: 'oidc_sub_already_bound',
      });
      continue;
    }
    items.push({
      rowIndex: i,
      email,
      username,
      userId: user.id,
      oidcSub,
      previewStatus: 'ready_to_link',
      finalStatus: null,
      reasonCode: null,
    });
  }
  return items;
}

router.use(...requireAdminPageView);

router.get('/users/:id/sso-status', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, email, auth_source, oidc_sub, updated_at, is_active
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({
    userId: row.id,
    email: row.email ?? null,
    linked: Boolean(row.oidc_sub),
    authSource: row.auth_source || 'local',
    linkedAt: row.updated_at || null,
    subjectFingerprint: row.oidc_sub ? `...${String(row.oidc_sub).slice(-6)}` : null,
    isActive: row.is_active !== false,
  });
});

router.post('/users/:id/sso-link/start', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const userResult = await pool.query(
    `SELECT id, email, is_active
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_active) return res.status(403).json({ error: 'Target user is inactive' });
  const expectedEmail = normalizeEmail(user.email);
  if (!expectedEmail) return res.status(409).json({ error: 'Target user must have an email before generating SSO link' });

  const cfg = assertOidcConfigured();
  const discovery = await getDiscoveryDocument(cfg.discoveryUrl);
  const { verifier, challenge, method } = createPkcePair();
  const state = createSignedState({
    verifier,
    mode: 'admin_prelink',
    targetUserId: id,
    expectedEmail,
  });
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('scope', cfg.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', method);
  logAuthEvent('oidc.link.start', { mode: 'admin_prelink', actorUserId: req.userId, targetUserId: id, ip: req.ip });
  res.json({ targetUserId: id, expectedEmail, expiresInSeconds: 600, url: authUrl.toString() });
});

router.post('/users/:id/sso-unlink', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const result = await pool.query(
    `UPDATE users
     SET oidc_sub = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  logAuthEvent('oidc.unlink.success', { actorUserId: req.userId, targetUserId: id, reason: reason || null, ip: req.ip });
  res.json({ ok: true, userId: id });
});

router.post('/sso-link/bulk/dry-run', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'rows is required' });
  const items = await evaluateRows(rows);
  const summary = summarize(items);
  res.json({ summary, items });
});

router.post('/sso-link/bulk/jobs', async (req, res) => {
  const dryRunItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (dryRunItems.length === 0) return res.status(400).json({ error: 'items is required' });
  const selectedRowIndexes = Array.isArray(req.body?.selectedRowIndexes) ? req.body.selectedRowIndexes : [];
  const selected = new Set(selectedRowIndexes.map((x) => Number(x)).filter((n) => Number.isFinite(n)));
  const jobId = crypto.randomUUID();
  const items = dryRunItems.map((item) => ({
    ...item,
    finalStatus: selected.has(Number(item.rowIndex)) && item.previewStatus === 'ready_to_link' ? 'pending' : item.finalStatus || 'failed_terminal',
    attempts: 0,
  }));

  for (const item of items) {
    if (item.finalStatus !== 'pending') continue;
    item.attempts += 1;
    try {
      const update = await pool.query(
        `UPDATE users
         SET oidc_sub = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL AND (oidc_sub IS NULL OR oidc_sub = $1)
         RETURNING id`,
        [item.oidcSub, item.userId]
      );
      item.finalStatus = update.rows.length > 0 ? 'linked' : 'failed_retryable';
      item.reasonCode = update.rows.length > 0 ? null : 'update_failed';
    } catch (err) {
      item.finalStatus = 'failed_retryable';
      item.reasonCode = 'db_error';
    }
  }

  const job = {
    jobId,
    createdAt: new Date().toISOString(),
    createdBy: req.userId,
    status: 'completed',
    items,
  };
  jobs.set(jobId, job);
  logAuthEvent('oidc.bulk.execute', { actorUserId: req.userId, jobId, rowCount: items.length, ip: req.ip });
  res.status(201).json({ jobId, status: job.status, summary: summarize(items) });
});

router.get('/sso-link/bulk/jobs/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    jobId: job.jobId,
    createdAt: job.createdAt,
    createdBy: job.createdBy,
    status: job.status,
    summary: summarize(job.items),
  });
});

router.get('/sso-link/bulk/jobs/:jobId/items', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId: job.jobId, items: job.items });
});

router.post('/sso-link/bulk/jobs/:jobId/retry', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  for (const item of job.items) {
    if (item.finalStatus !== 'failed_retryable' || !item.oidcSub || !item.userId) continue;
    if ((item.attempts || 0) >= 3) {
      item.finalStatus = 'failed_terminal';
      item.reasonCode = 'retry_exhausted';
      continue;
    }
    item.attempts += 1;
    const update = await pool.query(
      `UPDATE users
       SET oidc_sub = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL AND (oidc_sub IS NULL OR oidc_sub = $1)
       RETURNING id`,
      [item.oidcSub, item.userId]
    );
    item.finalStatus = update.rows.length > 0 ? 'linked' : 'failed_retryable';
    item.reasonCode = update.rows.length > 0 ? null : 'retry_update_failed';
  }
  res.json({ jobId: job.jobId, status: job.status, summary: summarize(job.items) });
});

router.get('/sso-link/bulk/jobs/:jobId/export.csv', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const header = 'rowIndex,email,username,userId,oidcSub,previewStatus,finalStatus,reasonCode,attempts';
  const lines = job.items.map((item) =>
    [
      item.rowIndex ?? '',
      item.email ?? '',
      item.username ?? '',
      item.userId ?? '',
      item.oidcSub ?? '',
      item.previewStatus ?? '',
      item.finalStatus ?? '',
      item.reasonCode ?? '',
      item.attempts ?? 0,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sso-link-job-${job.jobId}.csv"`);
  res.send([header, ...lines].join('\n'));
});

export default router;
