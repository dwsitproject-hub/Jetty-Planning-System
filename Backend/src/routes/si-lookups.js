/**
 * Shipping Instruction dropdown lookups (DB-backed, soft-delete aware).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';

const router = express.Router();
router.use(optionalAuth);

/** Maps API :type segment to Activity log page_key (see Layout pathToPageKey). */
const TYPE_META = {
  'trade-terms': {
    pageKey: 'master-si-term',
    entityType: 'SiTradeTerm',
    noun: 'Trade term',
  },
  shippers: { pageKey: 'master-si-shipper', entityType: 'SiShipper', noun: 'Shipper' },
  'loading-ports': {
    pageKey: 'master-si-loading-port',
    entityType: 'SiLoadingPort',
    noun: 'Loading port',
  },
  surveyors: { pageKey: 'master-si-surveyor', entityType: 'SiSurveyor', noun: 'Surveyor' },
  agents: { pageKey: 'master-si-agent', entityType: 'SiAgent', noun: 'Agent' },
  commodities: {
    pageKey: 'master-si-commodity',
    entityType: 'SiCommodity',
    noun: 'Commodity',
  },
};

function getTypeMeta(type) {
  return TYPE_META[type];
}

function formatRateSnapshot(rateValue, rateMetric) {
  if (rateValue == null || rateValue === '') return null;
  const m = rateMetric || 'MTPH';
  return `${rateValue} ${m}`;
}

function normalizeCommodityType(raw) {
  const v = String(raw ?? 'Liquid').trim();
  if (v === 'Solid' || v === 'Liquid') return v;
  return null;
}

async function selectCommoditiesWithRates({ portId, whereSql, params = [] }) {
  const portParam = portId == null ? null : Number(portId);
  return pool.query(
    `SELECT c.id, c.name AS value, c.sort_order, c.commodity_type, c.created_at, c.updated_at,
            srl.id AS loading_standard_rate_id, srl.rate_value AS loading_rate_value, srl.rate_metric AS loading_rate_metric,
            sru.id AS unloading_standard_rate_id, sru.rate_value AS unloading_rate_value, sru.rate_metric AS unloading_rate_metric
     FROM si_commodities c
     LEFT JOIN standard_rates srl
       ON srl.commodity_id = c.id
      AND srl.port_id = $1
      AND srl.activity_type = 'LOADING'
      AND srl.deleted_at IS NULL
     LEFT JOIN standard_rates sru
       ON sru.commodity_id = c.id
      AND sru.port_id = $1
      AND sru.activity_type = 'UNLOADING'
      AND sru.deleted_at IS NULL
     ${whereSql}`,
    [portParam, ...params],
  );
}

const CRUD_TYPES = {
  'trade-terms': { table: 'si_trade_terms', valueCol: 'code', refCol: 'trade_term_id' },
  shippers: { table: 'si_shippers', valueCol: 'name', refCol: 'shipper_id' },
  'loading-ports': { table: 'si_loading_ports', valueCol: 'name', refCol: 'loading_port_id' },
  surveyors: { table: 'si_surveyors', valueCol: 'name', refCol: 'surveyor_id' },
  agents: { table: 'si_agents', valueCol: 'name', refCol: 'agent_id' },
  commodities: { table: 'si_commodities', valueCol: 'name', refCol: 'commodity_id' },
};

function isValidType(type) {
  return Object.prototype.hasOwnProperty.call(CRUD_TYPES, type);
}

function getTypeConfig(type) {
  return CRUD_TYPES[type];
}

function toItem(row, type) {
  const cfg = getTypeConfig(type);
  return {
    id: row.id,
    value: row.value,
    sortOrder: row.sort_order ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // keep name/code fields for convenience/debugging
    ...(cfg.valueCol === 'code' ? { code: row.value } : { name: row.value }),
  };
}

const ALLOWED_RATE_METRICS = ['KLPH', 'MTPH', 'MTPD'];
const ALLOWED_ACTIVITY_TYPES = ['LOADING', 'UNLOADING'];

function toCommodityListItem(row) {
  return {
    id: row.id,
    value: row.value,
    name: row.value,
    commodityType: row.commodity_type ?? 'Liquid',
    sortOrder: row.sort_order ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    portRates: {
      loading: row.loading_standard_rate_id
        ? {
            id: row.loading_standard_rate_id,
            rate: Number(row.loading_rate_value),
            rateMetric: row.loading_rate_metric || 'MTPH',
          }
        : null,
      unloading: row.unloading_standard_rate_id
        ? {
            id: row.unloading_standard_rate_id,
            rate: Number(row.unloading_rate_value),
            rateMetric: row.unloading_rate_metric || 'MTPH',
          }
        : null,
    },
  };
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function normalizeRateMetric(raw) {
  const m = String(raw ?? 'MTPH').toUpperCase().trim();
  return ALLOWED_RATE_METRICS.includes(m) ? m : null;
}

function normalizeActivityType(raw) {
  const v = String(raw ?? '').toUpperCase().trim();
  return ALLOWED_ACTIVITY_TYPES.includes(v) ? v : null;
}

async function findActiveRateRowId({ commodityId, portId, activityType }) {
  const r = await pool.query(
    `SELECT id FROM standard_rates
     WHERE commodity_id = $1 AND port_id = $2 AND activity_type = $3 AND deleted_at IS NULL`,
    [commodityId, portId, activityType],
  );
  return r.rows[0]?.id ?? null;
}

async function upsertPortRate({ commodityId, portId, activityType, materialKey, rateValue, rateMetric }) {
  const existingId = await findActiveRateRowId({ commodityId, portId, activityType });
  if (existingId) {
    await pool.query(
      `UPDATE standard_rates
       SET material_key = $1, rate_value = $2, rate_metric = $3, updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL`,
      [materialKey, rateValue, rateMetric, existingId],
    );
    return existingId;
  }
  const ins = await pool.query(
    `INSERT INTO standard_rates (commodity_id, port_id, activity_type, material_key, rate_value, rate_metric)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [commodityId, portId, activityType, materialKey, rateValue, rateMetric],
  );
  return ins.rows[0].id;
}

async function clearPortRate({ commodityId, portId, activityType }) {
  await pool.query(
    `UPDATE standard_rates
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE commodity_id = $1 AND port_id = $2 AND activity_type = $3 AND deleted_at IS NULL`,
    [commodityId, portId, activityType],
  );
}

// Soft-delete dependency checks so you can't delete master values still used by active SIs.
async function assertDeletable(pool, type, id) {
  const cfg = getTypeConfig(type);

  if (type === 'commodities') {
    const q1 = await pool.query(
      `SELECT 1
       FROM shipping_instruction_breakdown b
       JOIN shipping_instructions si ON si.id = b.shipping_instruction_id AND si.deleted_at IS NULL
       WHERE b.commodity_id = $1 AND b.deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    if (q1.rows.length > 0) return { ok: false, reason: 'Cannot delete commodity while it is used by shipping instruction breakdown lines' };

    const q2 = await pool.query(
      `SELECT 1 FROM shipping_instructions
       WHERE commodity_id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    if (q2.rows.length > 0) return { ok: false, reason: 'Cannot delete commodity while it is used by shipping instructions' };

    return { ok: true };
  }

  // Standard: referenced by shipping_instructions.<refCol>
  const refQuery = await pool.query(
    `SELECT 1 FROM shipping_instructions
     WHERE ${cfg.refCol} = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  if (refQuery.rows.length > 0) {
    return { ok: false, reason: 'Cannot delete while master value is used by shipping instructions' };
  }
  return { ok: true };
}

router.get('/', async (_req, res) => {
  const [
    commodities,
    tradeTerms,
    purposes,
    shippers,
    loadingPorts,
    surveyors,
    agents,
    jetties,
    metrics,
  ] = await Promise.all([
    pool.query(
      `SELECT id, name, sort_order, commodity_type FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, code, sort_order FROM si_trade_terms WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
    pool.query(
      `SELECT id, code, label, sort_order FROM si_purposes WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_shippers WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_loading_ports WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_surveyors WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(`SELECT id, name, sort_order FROM si_agents WHERE deleted_at IS NULL ORDER BY sort_order, name`),
    pool.query(
      `SELECT j.id, j.name, j.port_id, p.name AS port_name
       FROM jetties j
       JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.deleted_at IS NULL
       ORDER BY p.name, j.order_no, j.name`
    ),
    pool.query(
      `SELECT id, code, label, sort_order FROM public.metric WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
  ]);

  res.json({
    commodities: commodities.rows.map((r) => ({
      id: r.id,
      name: r.name,
      commodityType: r.commodity_type ?? 'Liquid',
      sortOrder: r.sort_order,
    })),
    tradeTerms: tradeTerms.rows.map((r) => ({
      id: r.id,
      code: r.code,
      sortOrder: r.sort_order,
    })),
    purposes: purposes.rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sort_order,
    })),
    shippers: shippers.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    loadingPorts: loadingPorts.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    surveyors: surveyors.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    agents: agents.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    jetties: jetties.rows.map((r) => ({
      id: r.id,
      name: r.name,
      portId: r.port_id,
      portName: r.port_name,
      label: `${r.port_name} — ${r.name}`,
    })),
    metrics: metrics.rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sort_order,
    })),
  });
});

/** Master CRUD: GET /si-lookups/:type */
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  if (type === 'commodities') {
    // Commodity rates are per active port.
    if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
    // reuse shared validator to resolve req.selectedPortId
    return requirePortScope(req, res, async () => {
      const result = await selectCommoditiesWithRates({
        portId: req.selectedPortId,
        whereSql: 'WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name ASC',
      });
      return res.json(result.rows.map((r) => toCommodityListItem(r)));
    });
  }
  const cfg = getTypeConfig(type);
  const result = await pool.query(
    `SELECT id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at
     FROM ${cfg.table}
     WHERE deleted_at IS NULL
     ORDER BY sort_order, ${cfg.valueCol} ASC`,
  );
  res.json(result.rows.map((r) => toItem(r, type)));
});

/** Master CRUD: GET /si-lookups/:type/:id */
router.get('/:type/:id', async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (type === 'commodities') {
    if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
    return requirePortScope(req, res, async () => {
      const result = await selectCommoditiesWithRates({
        portId: req.selectedPortId,
        whereSql: 'WHERE c.id = $2 AND c.deleted_at IS NULL',
        params: [id],
      });
      if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
      return res.json(toCommodityListItem(result.rows[0]));
    });
  }
  const cfg = getTypeConfig(type);
  const result = await pool.query(
    `SELECT id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at
     FROM ${cfg.table}
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
  res.json(toItem(result.rows[0], type));
});

/** Master CRUD: POST /si-lookups/:type */
router.post('/:type', async (req, res) => {
  const { type } = req.params;
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  const cfg = getTypeConfig(type);
  const {
    value,
    // legacy single-rate fields (treated as UNLOADING)
    rate,
    ratePerHour,
    rateMetric,
    // port-scoped fields (active port only)
    loadingRate,
    loadingRateMetric,
    unloadingRate,
    unloadingRateMetric,
  } = req.body || {};
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: `${cfg.valueCol} is required` });
  }

  const cleaned = type === 'trade-terms' ? value.trim().toUpperCase() : value.trim();

  if (type === 'commodities') {
    if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
    return requirePortScope(req, res, async () => {
      const ct = normalizeCommodityType(req.body.commodityType ?? req.body.commodity_type);
      if (!ct) return res.status(400).json({ error: 'commodityType must be Solid or Liquid' });
      const ins = await pool.query(
        `INSERT INTO si_commodities (name, sort_order, commodity_type) VALUES ($1, 0, $2)
         RETURNING id, name AS value, sort_order, commodity_type, created_at, updated_at`,
        [cleaned, ct]
      );
      const row = ins.rows[0];
      const portId = req.selectedPortId;
      // Backwards-compatible: legacy `rate` is treated as UNLOADING for the active port.
      const legacyUnloadingRate = toNum(rate ?? ratePerHour);
      const legacyUnloadingMetric = normalizeRateMetric(rateMetric);

      const lRate = toNum(loadingRate);
      const uRate = toNum(unloadingRate);
      const lMetric = normalizeRateMetric(loadingRateMetric);
      const uMetric = normalizeRateMetric(unloadingRateMetric);

      if (lRate != null && lRate < 0) return res.status(400).json({ error: 'loadingRate must be a non-negative number' });
      if (uRate != null && uRate < 0) return res.status(400).json({ error: 'unloadingRate must be a non-negative number' });
      if (legacyUnloadingRate != null && legacyUnloadingRate < 0) return res.status(400).json({ error: 'rate must be a non-negative number' });

      if (lRate != null && !lMetric) return res.status(400).json({ error: 'loadingRateMetric must be KLPH, MTPH, or MTPD' });
      if (uRate != null && !uMetric) return res.status(400).json({ error: 'unloadingRateMetric must be KLPH, MTPH, or MTPD' });
      if (legacyUnloadingRate != null && !legacyUnloadingMetric) return res.status(400).json({ error: 'rateMetric must be KLPH, MTPH, or MTPD' });

      // Write rates only when provided.
      if (lRate != null) {
        await upsertPortRate({
          commodityId: row.id,
          portId,
          activityType: 'LOADING',
          materialKey: cleaned,
          rateValue: lRate,
          rateMetric: lMetric,
        });
      }
      if (uRate != null) {
        await upsertPortRate({
          commodityId: row.id,
          portId,
          activityType: 'UNLOADING',
          materialKey: cleaned,
          rateValue: uRate,
          rateMetric: uMetric,
        });
      } else if (legacyUnloadingRate != null) {
        await upsertPortRate({
          commodityId: row.id,
          portId,
          activityType: 'UNLOADING',
          materialKey: cleaned,
          rateValue: legacyUnloadingRate,
          rateMetric: legacyUnloadingMetric,
        });
      }

      const full = await selectCommoditiesWithRates({
        portId,
        whereSql: 'WHERE c.id = $2',
        params: [row.id],
      });
      const createdItem = toCommodityListItem(full.rows[0]);

      const tm = getTypeMeta(type);
      const lSnap = createdItem.portRates.loading
        ? formatRateSnapshot(createdItem.portRates.loading.rate, createdItem.portRates.loading.rateMetric)
        : null;
      const uSnap = createdItem.portRates.unloading
        ? formatRateSnapshot(createdItem.portRates.unloading.rate, createdItem.portRates.unloading.rateMetric)
        : null;
      let summary = `Created ${tm.noun} "${cleaned}" (${ct})`;
      if (lSnap || uSnap) summary += ` — rates (L: ${lSnap ?? '—'}, U: ${uSnap ?? '—'})`;

      writeActivityLog({
        pageKey: tm.pageKey,
        action: 'create',
        entityType: tm.entityType,
        entityId: String(createdItem.id),
        entityLabel: cleaned,
        summary,
        meta: { siLookupType: type, portId },
        actorUserId: req.userId ?? null,
      }).catch(() => {});

      return res.status(201).json(createdItem);
    });
  }

  const result = await pool.query(
    `INSERT INTO ${cfg.table} (${cfg.valueCol}, sort_order)
     VALUES ($1, 0)
     RETURNING id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at`,
    [cleaned],
  );
  const row = result.rows[0];

  const tm = getTypeMeta(type);
  writeActivityLog({
    pageKey: tm.pageKey,
    action: 'create',
    entityType: tm.entityType,
    entityId: String(row.id),
    entityLabel: cleaned,
    summary: `Created ${tm.noun} "${cleaned}"`,
    meta: { siLookupType: type },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toItem(row, type));
});

/** Master CRUD: PUT /si-lookups/:type/:id */
router.put('/:type/:id', async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const cfg = getTypeConfig(type);
  const {
    value,
    // legacy single-rate fields (treated as UNLOADING)
    rate,
    ratePerHour,
    rateMetric,
    // port-scoped fields (active port only)
    loadingRate,
    loadingRateMetric,
    unloadingRate,
    unloadingRateMetric,
    clearLoadingRate,
    clearUnloadingRate,
  } = req.body || {};
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: `${cfg.valueCol} is required` });
  }
  const cleaned = type === 'trade-terms' ? value.trim().toUpperCase() : value.trim();

  let prevName;
  let prevCommodityType = null;
  let prevLoadingValue = null;
  let prevLoadingMetric = null;
  let prevUnloadingValue = null;
  let prevUnloadingMetric = null;
  if (type === 'commodities') {
    if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
    await new Promise((resolve, reject) =>
      requirePortScope(req, res, (err) => (err ? reject(err) : resolve()))
    );
    const prevQ = await selectCommoditiesWithRates({
      portId: req.selectedPortId,
      whereSql: 'WHERE c.id = $2 AND c.deleted_at IS NULL',
      params: [id],
    });
    if (prevQ.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    prevName = prevQ.rows[0].value;
    prevCommodityType = prevQ.rows[0].commodity_type ?? 'Liquid';
    prevLoadingValue = prevQ.rows[0].loading_rate_value;
    prevLoadingMetric = prevQ.rows[0].loading_rate_metric;
    prevUnloadingValue = prevQ.rows[0].unloading_rate_value;
    prevUnloadingMetric = prevQ.rows[0].unloading_rate_metric;
  } else {
    const prevQ = await pool.query(
      `SELECT ${cfg.valueCol} AS v FROM ${cfg.table} WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (prevQ.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    prevName = prevQ.rows[0].v;
  }

  let result;
  if (type === 'commodities') {
    const ctRaw = req.body.commodityType ?? req.body.commodity_type;
    if (ctRaw !== undefined && ctRaw !== null && String(ctRaw).trim() !== '') {
      const ct = normalizeCommodityType(ctRaw);
      if (!ct) return res.status(400).json({ error: 'commodityType must be Solid or Liquid' });
      result = await pool.query(
        `UPDATE si_commodities
         SET name = $1, commodity_type = $2, updated_at = NOW()
         WHERE id = $3 AND deleted_at IS NULL
         RETURNING id, name AS value, sort_order, commodity_type, created_at, updated_at`,
        [cleaned, ct, id]
      );
    } else {
      result = await pool.query(
        `UPDATE si_commodities
         SET name = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL
         RETURNING id, name AS value, sort_order, commodity_type, created_at, updated_at`,
        [cleaned, id]
      );
    }
  } else {
    result = await pool.query(
      `UPDATE ${cfg.table}
       SET ${cfg.valueCol} = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at`,
      [cleaned, id]
    );
  }
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

  if (type === 'commodities') {
    const portId = req.selectedPortId;

    await pool.query(
      `UPDATE standard_rates
       SET material_key = $1, updated_at = NOW()
       WHERE commodity_id = $2 AND deleted_at IS NULL`,
      [cleaned, id],
    );

    const lRate = loadingRate !== undefined ? toNum(loadingRate) : undefined;
    const uRate = unloadingRate !== undefined ? toNum(unloadingRate) : undefined;
    const lMetric = loadingRate !== undefined ? normalizeRateMetric(loadingRateMetric) : null;
    const uMetric = unloadingRate !== undefined ? normalizeRateMetric(unloadingRateMetric) : null;
    const legacyU = rate !== undefined || ratePerHour !== undefined ? toNum(rate ?? ratePerHour) : undefined;
    const legacyUMetric = rate !== undefined || ratePerHour !== undefined ? normalizeRateMetric(rateMetric) : null;

    if (lRate != null && lRate < 0) return res.status(400).json({ error: 'loadingRate must be a non-negative number' });
    if (uRate != null && uRate < 0) return res.status(400).json({ error: 'unloadingRate must be a non-negative number' });
    if (legacyU != null && legacyU < 0) return res.status(400).json({ error: 'rate must be a non-negative number' });
    if (lRate != null && !lMetric) return res.status(400).json({ error: 'loadingRateMetric must be KLPH, MTPH, or MTPD' });
    if (uRate != null && !uMetric) return res.status(400).json({ error: 'unloadingRateMetric must be KLPH, MTPH, or MTPD' });
    if (legacyU != null && !legacyUMetric) return res.status(400).json({ error: 'rateMetric must be KLPH, MTPH, or MTPD' });

    if (clearLoadingRate === true) {
      await clearPortRate({ commodityId: id, portId, activityType: 'LOADING' });
    } else if (lRate != null) {
      await upsertPortRate({
        commodityId: id,
        portId,
        activityType: 'LOADING',
        materialKey: cleaned,
        rateValue: lRate,
        rateMetric: lMetric,
      });
    }

    if (clearUnloadingRate === true) {
      await clearPortRate({ commodityId: id, portId, activityType: 'UNLOADING' });
    } else if (uRate != null) {
      await upsertPortRate({
        commodityId: id,
        portId,
        activityType: 'UNLOADING',
        materialKey: cleaned,
        rateValue: uRate,
        rateMetric: uMetric,
      });
    } else if (legacyU != null) {
      await upsertPortRate({
        commodityId: id,
        portId,
        activityType: 'UNLOADING',
        materialKey: cleaned,
        rateValue: legacyU,
        rateMetric: legacyUMetric,
      });
    }

    const full = await selectCommoditiesWithRates({
      portId,
      whereSql: 'WHERE c.id = $2',
      params: [id],
    });
    const updatedItem = toCommodityListItem(full.rows[0]);
    const tmC = getTypeMeta(type);
    const changesC = [];
    if (prevName !== cleaned) changesC.push({ field: 'Name', from: prevName, to: cleaned });
    if (prevCommodityType && updatedItem.commodityType && prevCommodityType !== updatedItem.commodityType) {
      changesC.push({ field: 'Commodity type', from: prevCommodityType, to: updatedItem.commodityType });
    }
    const fromL = formatRateSnapshot(prevLoadingValue, prevLoadingMetric);
    const toL = updatedItem.portRates.loading
      ? formatRateSnapshot(updatedItem.portRates.loading.rate, updatedItem.portRates.loading.rateMetric)
      : null;
    if (fromL !== toL) changesC.push({ field: 'Loading rate', from: fromL, to: toL });

    const fromU = formatRateSnapshot(prevUnloadingValue, prevUnloadingMetric);
    const toU = updatedItem.portRates.unloading
      ? formatRateSnapshot(updatedItem.portRates.unloading.rate, updatedItem.portRates.unloading.rateMetric)
      : null;
    if (fromU !== toU) changesC.push({ field: 'Unloading rate', from: fromU, to: toU });
    writeActivityLog({
      pageKey: tmC.pageKey,
      action: 'update',
      entityType: tmC.entityType,
      entityId: String(id),
      entityLabel: cleaned,
      summary: `Updated ${tmC.noun} "${cleaned}"`,
      changes: changesC.length ? changesC : null,
      meta: { siLookupType: type, portId },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.json(updatedItem);
  }

  const tm = getTypeMeta(type);
  const changes = [];
  if (prevName !== cleaned) changes.push({ field: 'Name', from: prevName, to: cleaned });
  writeActivityLog({
    pageKey: tm.pageKey,
    action: 'update',
    entityType: tm.entityType,
    entityId: String(id),
    entityLabel: cleaned,
    summary: `Updated ${tm.noun} "${cleaned}"`,
    changes: changes.length ? changes : null,
    meta: { siLookupType: type },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toItem(result.rows[0], type));
});

/** Master CRUD: DELETE /si-lookups/:type/:id (soft delete) */
router.delete('/:type/:id', async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const check = await assertDeletable(pool, type, id);
  if (!check.ok) return res.status(409).json({ error: check.reason });

  const cfg = getTypeConfig(type);
  const lblQ = await pool.query(
    `SELECT ${cfg.valueCol} AS v FROM ${cfg.table} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (lblQ.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
  const deletedLabel = lblQ.rows[0].v;

  if (type === 'commodities') {
    await pool.query(
      `UPDATE standard_rates SET deleted_at = NOW(), updated_at = NOW()
       WHERE commodity_id = $1 AND deleted_at IS NULL`,
      [id],
    );
  }
  const result = await pool.query(
    `UPDATE ${cfg.table}
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

  const tm = getTypeMeta(type);
  writeActivityLog({
    pageKey: tm.pageKey,
    action: 'delete',
    entityType: tm.entityType,
    entityId: String(id),
    entityLabel: deletedLabel,
    summary: `Deleted ${tm.noun} "${deletedLabel}"`,
    meta: { siLookupType: type },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

export default router;
