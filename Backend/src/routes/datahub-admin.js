/**
 * Admin UI for the DataHub (DHM) client credentials (datahub_config, migration 117).
 *
 * Gated by the shared 'admin' page permission, the same as partner API keys and
 * SMTP, so the private key sits behind a narrower permission than the
 * 'master-vessel' page that consumes it. The private key is write-only: reads
 * report privateKeyConfigured, never the value.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { clearDataHubTokenCache, fetchVesselCatalog } from '../lib/datahub-client.js';
import {
  getDataHubConfigForAdmin,
  getEffectiveDataHubConfig,
  normalizeBaseUrl,
  saveDataHubConfig,
} from '../lib/datahub-config.js';

const router = express.Router();
router.use(...requireAdminPageView);

const ACTIVITY_PAGE_KEY = 'admin';

router.get('/', async (_req, res) => {
  res.json(await getDataHubConfigForAdmin(pool));
});

router.put('/', async (req, res) => {
  const body = req.body || {};
  const before = await getDataHubConfigForAdmin(pool);
  try {
    await saveDataHubConfig(
      pool,
      {
        baseUrl: body.baseUrl,
        publicKey: body.publicKey,
        privateKey: body.privateKey,
        enabled: body.enabled,
      },
      req.userId ?? null
    );
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Invalid DataHub configuration' });
  }
  // A cached app token belongs to the old credentials.
  clearDataHubTokenCache();

  const after = await getDataHubConfigForAdmin(pool);
  const changes = [];
  if (before.baseUrl !== after.baseUrl) {
    changes.push({ field: 'Base URL', from: before.baseUrl || null, to: after.baseUrl || null });
  }
  if (before.publicKey !== after.publicKey) {
    changes.push({ field: 'Public Key', from: before.publicKey || null, to: after.publicKey || null });
  }
  if (before.enabled !== after.enabled) {
    changes.push({ field: 'Enabled', from: before.enabled ? 'Yes' : 'No', to: after.enabled ? 'Yes' : 'No' });
  }
  if (body.privateKey != null && String(body.privateKey).trim()) {
    changes.push({ field: 'Private Key', from: null, to: 'updated' });
  }
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: 'DataHub Integration',
    entityId: 'datahub',
    entityLabel: 'DataHub Integration',
    summary: 'Updated DataHub integration settings',
    changes,
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json(after);
});

/**
 * Connection test against GET /v1/catalog/vessel. Accepts inline credentials so
 * the form can be validated before saving; falls back to the stored config.
 */
router.post('/test', async (req, res) => {
  const body = req.body || {};
  const stored = await getEffectiveDataHubConfig(pool);

  let baseUrl = stored.baseUrl;
  if (body.baseUrl != null && String(body.baseUrl).trim()) {
    try {
      baseUrl = normalizeBaseUrl(body.baseUrl);
    } catch (e) {
      return res.status(400).json({ ok: false, error: e?.message || 'Invalid baseUrl' });
    }
  }
  const publicKey =
    body.publicKey != null && String(body.publicKey).trim()
      ? String(body.publicKey).trim()
      : stored.publicKey;
  const privateKey =
    body.privateKey != null && String(body.privateKey).trim()
      ? String(body.privateKey).trim()
      : stored.privateKey;

  if (!baseUrl) return res.status(400).json({ ok: false, error: 'baseUrl is not configured' });
  if (!publicKey || !privateKey) {
    return res.status(400).json({ ok: false, error: 'Public and private keys are not configured' });
  }

  try {
    const catalog = await fetchVesselCatalog({ baseUrl, publicKey, privateKey });
    res.json({
      ok: true,
      baseUrl,
      entity: catalog.slug,
      fieldCount: catalog.fieldCount,
      message: `Reached DataHub and read the vessel catalog (${catalog.fieldCount} fields).`,
    });
  } catch (e) {
    const status = Number(e?.status);
    const hint = e?.isHtml
      ? `Ask the DataHub team for the /v1 API host: GET ${baseUrl}/openapi.json should return JSON, not a page.`
      : status === 403
        ? 'The key pair is not allowlisted for the vessel entity. Tick Vessel on the DataHub /integrations page.'
        : status === 401
          ? 'DataHub rejected the key pair. Check the values, and that the application is still active on the DataHub /integrations page.'
          : status === 0
            ? 'No response before the timeout. Check that the /v1 API is published and reachable from this server.'
            : null;
    res.status(502).json({ ok: false, error: e?.message || 'DataHub test failed', hint });
  }
});

export default router;
