/**
 * Standard rates CRUD — linked to SI commodities (rate value + metric; buffer is global SLA only).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(optionalAuth);

const RATE_PAGE_KEY = 'master-si-commodity';

function formatRateLog(rateValue, rateMetric) {
  const m = rateMetric || 'MTPH';
  return `${rateValue} ${m}`;
}

const ALLOWED_METRICS = ['KLPH', 'MTPH', 'MTPD'];

function normalizeMetric(raw) {
  const m = String(raw ?? 'MTPH').toUpperCase().trim();
  return ALLOWED_METRICS.includes(m) ? m : null;
}

router.get('/', async (_req, res) => {
  const result = await pool.query(
    `SELECT sr.id, sr.material_key, sr.rate_value, sr.rate_metric, sr.commodity_id, sr.created_at, sr.updated_at,
            sc.name AS commodity_name
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.deleted_at IS NULL
     ORDER BY COALESCE(sc.name, sr.material_key) ASC`,
  );
  res.json(result.rows.map(toRate));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT sr.id, sr.material_key, sr.rate_value, sr.rate_metric, sr.commodity_id, sr.created_at, sr.updated_at,
            sc.name AS commodity_name
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.id = $1 AND sr.deleted_at IS NULL`,
    [id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  res.json(toRate(result.rows[0]));
});

router.post('/', async (req, res) => {
  const { commodity_id, commodityId, material_key, rate, rate_per_hour, rate_metric, rateMetric } = req.body || {};
  const cid = commodity_id ?? commodityId;
  const rateNum = toNum(rate ?? rate_per_hour);
  if (rateNum == null || rateNum < 0) return res.status(400).json({ error: 'rate must be a non-negative number' });
  const metric = normalizeMetric(rate_metric ?? rateMetric);
  if (!metric) return res.status(400).json({ error: 'rate_metric must be KLPH, MTPH, or MTPD' });

  if (cid != null && cid !== '') {
    const idNum = parseInt(cid, 10);
    if (Number.isNaN(idNum)) return res.status(400).json({ error: 'Invalid commodity_id' });
    const cn = await pool.query(
      `SELECT name FROM si_commodities WHERE id = $1 AND deleted_at IS NULL`,
      [idNum],
    );
    if (cn.rows.length === 0) return res.status(404).json({ error: 'Commodity not found' });
    const name = cn.rows[0].name;
    const result = await pool.query(
      `INSERT INTO standard_rates (commodity_id, material_key, rate_value, rate_metric)
       VALUES ($1, $2, $3, $4)
       RETURNING id, material_key, rate_value, rate_metric, commodity_id, created_at, updated_at`,
      [idNum, name, rateNum, metric],
    );
    const row = result.rows[0];
    const payload = toRate({ ...row, commodity_name: name });
    writeActivityLog({
      pageKey: RATE_PAGE_KEY,
      action: 'create',
      entityType: 'StandardRate',
      entityId: String(row.id),
      entityLabel: name,
      summary: `Created standard rate for commodity "${name}" (${formatRateLog(rateNum, metric)})`,
      meta: { commodityId: idNum, standardRateId: row.id },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(201).json(payload);
  }

  if (!material_key || typeof material_key !== 'string' || !material_key.trim()) {
    return res.status(400).json({ error: 'commodity_id or material_key is required' });
  }
  const mk = material_key.trim();
  const result = await pool.query(
    `INSERT INTO standard_rates (commodity_id, material_key, rate_value, rate_metric)
     VALUES (NULL, $1, $2, $3)
     RETURNING id, material_key, rate_value, rate_metric, commodity_id, created_at, updated_at`,
    [mk, rateNum, metric],
  );
  const row = result.rows[0];
  writeActivityLog({
    pageKey: RATE_PAGE_KEY,
    action: 'create',
    entityType: 'StandardRate',
    entityId: String(row.id),
    entityLabel: mk,
    summary: `Created standard rate (unlinked) "${mk}" (${formatRateLog(rateNum, metric)})`,
    meta: { standardRateId: row.id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toRate(row));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { material_key, rate, rate_per_hour, rate_metric, rateMetric } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;
  if (material_key !== undefined) {
    if (typeof material_key !== 'string' || !material_key.trim()) {
      return res.status(400).json({ error: 'material_key must be a non-empty string' });
    }
    updates.push(`material_key = $${i++}`);
    values.push(material_key.trim());
  }
  const rv = rate !== undefined ? rate : rate_per_hour;
  if (rv !== undefined) {
    const rateN = toNum(rv);
    if (rateN == null || rateN < 0) return res.status(400).json({ error: 'rate must be a non-negative number' });
    updates.push(`rate_value = $${i++}`);
    values.push(rateN);
  }
  if (rate_metric !== undefined || rateMetric !== undefined) {
    const metric = normalizeMetric(rate_metric ?? rateMetric);
    if (!metric) return res.status(400).json({ error: 'rate_metric must be KLPH, MTPH, or MTPD' });
    updates.push(`rate_metric = $${i++}`);
    values.push(metric);
  }
  if (updates.length === 0) {
    const result = await pool.query(
      `SELECT sr.id, sr.material_key, sr.rate_value, sr.rate_metric, sr.commodity_id, sr.created_at, sr.updated_at,
              sc.name AS commodity_name
       FROM standard_rates sr
       LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
       WHERE sr.id = $1 AND sr.deleted_at IS NULL`,
      [id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
    return res.json(toRate(result.rows[0]));
  }

  const prevQ = await pool.query(
    `SELECT sr.id, sr.material_key, sr.rate_value, sr.rate_metric, sr.commodity_id,
            sc.name AS commodity_name
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.id = $1 AND sr.deleted_at IS NULL`,
    [id],
  );
  if (prevQ.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  const prev = prevQ.rows[0];

  values.push(id);
  const result = await pool.query(
    `UPDATE standard_rates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} AND deleted_at IS NULL RETURNING id, material_key, rate_value, rate_metric, commodity_id, created_at, updated_at`,
    values,
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  const row = result.rows[0];
  const full = await pool.query(
    `SELECT sr.id, sr.material_key, sr.rate_value, sr.rate_metric, sr.commodity_id, sr.created_at, sr.updated_at,
            sc.name AS commodity_name
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.id = $1`,
    [row.id],
  );
  const updated = full.rows[0];
  const label = updated.commodity_name || updated.material_key || `#${id}`;
  const changes = [];
  if (prev.material_key !== updated.material_key) {
    changes.push({ field: 'Material key', from: prev.material_key, to: updated.material_key });
  }
  const fromR = formatRateLog(prev.rate_value, prev.rate_metric);
  const toR = formatRateLog(updated.rate_value, updated.rate_metric);
  if (fromR !== toR) changes.push({ field: 'Rate', from: fromR, to: toR });
  writeActivityLog({
    pageKey: RATE_PAGE_KEY,
    action: 'update',
    entityType: 'StandardRate',
    entityId: String(id),
    entityLabel: label,
    summary: `Updated standard rate for "${label}"`,
    changes: changes.length ? changes : null,
    meta: { standardRateId: id, commodityId: updated.commodity_id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toRate(updated));
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const prevQ = await pool.query(
    `SELECT sr.id, sr.material_key, sr.commodity_id, sc.name AS commodity_name
     FROM standard_rates sr
     LEFT JOIN si_commodities sc ON sc.id = sr.commodity_id AND sc.deleted_at IS NULL
     WHERE sr.id = $1 AND sr.deleted_at IS NULL`,
    [id],
  );
  if (prevQ.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  const prev = prevQ.rows[0];
  const label = prev.commodity_name || prev.material_key || `#${id}`;
  const result = await pool.query(
    `UPDATE standard_rates SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  writeActivityLog({
    pageKey: RATE_PAGE_KEY,
    action: 'delete',
    entityType: 'StandardRate',
    entityId: String(id),
    entityLabel: label,
    summary: `Deleted standard rate for "${label}"`,
    meta: { standardRateId: id, commodityId: prev.commodity_id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toRate(row) {
  return {
    id: row.id,
    materialKey: row.material_key,
    commodityId: row.commodity_id ?? null,
    commodityName: row.commodity_name ?? null,
    rate: Number(row.rate_value),
    rateMetric: row.rate_metric || 'MTPH',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
