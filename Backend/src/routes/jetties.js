/**
 * Jetties CRUD + PUT /:id/status — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageEdit, requirePageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { countBlockingOperationsOnJetty, isJettyUnavailableMasterStatus } from '../lib/jetty-blocking.js';

const VALID_STATUSES = ['Available', 'Out of Service'];
const MAX_RTSP_LINK_CHARS = 512;
const router = express.Router();

function normalizeRtspLink(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > MAX_RTSP_LINK_CHARS) return { error: `rtsp_link must be at most ${MAX_RTSP_LINK_CHARS} characters` };
  return s;
}

/** Required positive-number spec (jetty_length_m / jetty_draft / jetty_dwt). Returns number or { error }. */
function parseRequiredSpec(raw, field) {
  if (raw == null || raw === '') return { error: `${field} is required` };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: `${field} must be a positive number` };
  return n;
}

const COMMODITY_PURPOSES = ['Loading', 'Unloading'];

const JETTY_SELECT_COLS = `j.id, j.port_id, j.order_no, j.name, j.description, j.rtsp_link, j.status, j.capacity,
              j.jetty_length_m, j.jetty_draft, j.jetty_dwt, j.created_at, j.updated_at,
              (SELECT COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name), '[]'::json)
               FROM jetty_commodities jc JOIN si_commodities c ON c.id = jc.commodity_id AND c.deleted_at IS NULL
               WHERE jc.jetty_id = j.id AND jc.operational_purpose = 'Unloading') AS unloading_commodities_json,
              (SELECT COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name), '[]'::json)
               FROM jetty_commodities jc JOIN si_commodities c ON c.id = jc.commodity_id AND c.deleted_at IS NULL
               WHERE jc.jetty_id = j.id AND jc.operational_purpose = 'Loading') AS loading_commodities_json`;

function normalizeCommodityIds(rawIds) {
  return [...new Set(rawIds.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0))];
}

/** Replace jetty_commodities links for one purpose; ids validated against si_commodities. */
async function saveJettyCommoditiesForPurpose(jettyId, purpose, rawIds) {
  if (!Array.isArray(rawIds)) return; // omitted => leave as-is
  const ids = normalizeCommodityIds(rawIds);
  await pool.query(
    `DELETE FROM jetty_commodities WHERE jetty_id = $1 AND operational_purpose = $2`,
    [jettyId, purpose]
  );
  if (ids.length) {
    await pool.query(
      `INSERT INTO jetty_commodities (jetty_id, commodity_id, operational_purpose)
       SELECT $1, id, $3 FROM si_commodities WHERE id = ANY($2::bigint[]) AND deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [jettyId, ids, purpose]
    );
  }
}

async function saveJettyCommoditiesByPurpose(jettyId, { unloading, loading }) {
  await saveJettyCommoditiesForPurpose(jettyId, 'Unloading', unloading);
  await saveJettyCommoditiesForPurpose(jettyId, 'Loading', loading);
}

async function loadJettyCommoditiesByPurpose(jettyId) {
  const r = await pool.query(
    `SELECT jc.operational_purpose,
            COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name), '[]'::json) AS commodities
     FROM jetty_commodities jc
     JOIN si_commodities c ON c.id = jc.commodity_id AND c.deleted_at IS NULL
     WHERE jc.jetty_id = $1
     GROUP BY jc.operational_purpose`,
    [jettyId]
  );
  const out = { Unloading: [], Loading: [] };
  for (const row of r.rows) {
    if (COMMODITY_PURPOSES.includes(row.operational_purpose)) {
      out[row.operational_purpose] = row.commodities ?? [];
    }
  }
  return out;
}

function commodityNames(list) {
  return (Array.isArray(list) ? list : []).map((c) => c.name).filter(Boolean).sort();
}

function appendCommodityPurposeChanges(changes, purposeLabel, beforeNames, afterNames) {
  const added = afterNames.filter((n) => !beforeNames.includes(n));
  const removed = beforeNames.filter((n) => !afterNames.includes(n));
  if (added.length) changes.push({ field: `${purposeLabel} — added`, from: null, to: added.join(', ') });
  if (removed.length) changes.push({ field: `${purposeLabel} — removed`, from: removed.join(', '), to: null });
}

function appendInitialCommodityChanges(changes, purposeLabel, names) {
  if (names.length) changes.push({ field: purposeLabel, from: null, to: names.join(', ') });
}
router.use(...requirePageView('master-jetty'));

router.get('/', async (req, res) => {
  const portId = req.query.port_id;
  let result;
  if (portId) {
    const id = parseInt(portId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid port_id' });
    result = await pool.query(
      `SELECT ${JETTY_SELECT_COLS},
              p.name AS port_name
       FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.port_id = $1 AND j.deleted_at IS NULL ORDER BY j.order_no ASC, j.name ASC`,
      [id]
    );
  } else {
    result = await pool.query(
      `SELECT ${JETTY_SELECT_COLS},
              p.name AS port_name
       FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.deleted_at IS NULL
       ORDER BY p.name ASC, j.order_no ASC, j.name ASC`
    );
  }
  res.json(result.rows.map(toJetty));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT ${JETTY_SELECT_COLS},
            p.name AS port_name
     FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
     WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  res.json(toJetty(result.rows[0]));
});

router.post('/', ...requirePageEdit('master-jetty'), async (req, res) => {
  const {
    port_id,
    order_no,
    name,
    description,
    capacity,
    rtsp_link,
    jetty_length_m,
    jetty_draft,
    jetty_dwt,
    unloading_commodity_ids,
    loading_commodity_ids,
  } = req.body || {};
  if (port_id == null || !name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'port_id and name are required' });
  }
  const rtspLink = normalizeRtspLink(rtsp_link);
  if (rtspLink?.error) return res.status(400).json({ error: rtspLink.error });
  const lengthM = parseRequiredSpec(jetty_length_m, 'jetty_length_m');
  if (lengthM?.error) return res.status(400).json({ error: lengthM.error });
  const draft = parseRequiredSpec(jetty_draft, 'jetty_draft');
  if (draft?.error) return res.status(400).json({ error: draft.error });
  const dwt = parseRequiredSpec(jetty_dwt, 'jetty_dwt');
  if (dwt?.error) return res.status(400).json({ error: dwt.error });
  const portId = parseInt(port_id, 10);
  if (Number.isNaN(portId)) return res.status(400).json({ error: 'Invalid port_id' });
  const portOk = await pool.query(
    'SELECT 1 FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [portId]
  );
  if (portOk.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const orderNo = order_no != null ? parseInt(order_no, 10) : 0;
  const capRaw = capacity != null && capacity !== '' ? parseInt(capacity, 10) : null;
  const cap = capRaw == null || Number.isNaN(capRaw) ? null : capRaw;
  if (cap != null && cap < 1) return res.status(400).json({ error: 'capacity must be an integer >= 1' });
  const result = await pool.query(
    `INSERT INTO jetties (port_id, order_no, name, description, capacity, rtsp_link, jetty_length_m, jetty_draft, jetty_dwt)
     VALUES ($1, $2, $3, $4, COALESCE($5, 1), $6, $7, $8, $9)
     RETURNING id, port_id, order_no, name, description, rtsp_link, status, capacity, jetty_length_m, jetty_draft, jetty_dwt, created_at, updated_at`,
    [portId, Number.isNaN(orderNo) ? 0 : orderNo, name.trim(), description?.trim() ?? null, cap, rtspLink, lengthM, draft, dwt]
  );
  const row = result.rows[0];
  await saveJettyCommoditiesByPurpose(row.id, {
    unloading: unloading_commodity_ids,
    loading: loading_commodity_ids,
  });
  const commoditiesByPurpose = await loadJettyCommoditiesByPurpose(row.id);
  row.unloading_commodities_json = commoditiesByPurpose.Unloading;
  row.loading_commodities_json = commoditiesByPurpose.Loading;
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );
  const createChanges = [
    { field: 'Port', from: null, to: portName.rows[0]?.name ?? String(row.port_id) },
    { field: 'Order', from: null, to: row.order_no },
    { field: 'Name', from: null, to: name.trim() },
    { field: 'Capacity', from: null, to: row.capacity },
    { field: 'Length (m)', from: null, to: row.jetty_length_m },
    { field: 'Draft', from: null, to: row.jetty_draft },
    { field: 'DWT', from: null, to: row.jetty_dwt },
    { field: 'Status', from: null, to: row.status },
  ];
  appendInitialCommodityChanges(createChanges, 'Allowed for Unloading', commodityNames(commoditiesByPurpose.Unloading));
  appendInitialCommodityChanges(createChanges, 'Allowed for Loading', commodityNames(commoditiesByPurpose.Loading));
  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'add',
    entityType: 'Jetty',
    entityId: row.id,
    entityLabel: name.trim(),
    summary: 'Created jetty',
    changes: createChanges,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
});

router.put('/:id', ...requirePageEdit('master-jetty'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const {
    port_id,
    order_no,
    name,
    description,
    capacity,
    rtsp_link,
    jetty_length_m,
    jetty_draft,
    jetty_dwt,
    unloading_commodity_ids,
    loading_commodity_ids,
  } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const rtspLink = normalizeRtspLink(rtsp_link);
  if (rtspLink?.error) return res.status(400).json({ error: rtspLink.error });
  const lengthM = parseRequiredSpec(jetty_length_m, 'jetty_length_m');
  if (lengthM?.error) return res.status(400).json({ error: lengthM.error });
  const draft = parseRequiredSpec(jetty_draft, 'jetty_draft');
  if (draft?.error) return res.status(400).json({ error: draft.error });
  const dwt = parseRequiredSpec(jetty_dwt, 'jetty_dwt');
  if (dwt?.error) return res.status(400).json({ error: dwt.error });
  const beforeCommodities = await loadJettyCommoditiesByPurpose(id);
  const before = await pool.query(
    `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.rtsp_link, j.status, j.capacity,
            j.jetty_length_m, j.jetty_draft, j.jetty_dwt, p.name AS port_name
     FROM jetties j
     JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
     WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [id]
  );
  const beforeRow = before.rows[0] ?? null;
  if (!beforeRow) return res.status(404).json({ error: 'Jetty not found' });

  const portId = port_id != null ? parseInt(port_id, 10) : null;
  const orderNo = order_no != null ? parseInt(order_no, 10) : null;
  const capRaw = capacity != null && capacity !== '' ? parseInt(capacity, 10) : null;
  const cap = capRaw == null || Number.isNaN(capRaw) ? null : capRaw;
  if (cap != null && cap < 1) return res.status(400).json({ error: 'capacity must be an integer >= 1' });
  const result = await pool.query(
    `UPDATE jetties SET
       port_id = COALESCE($1, port_id),
       order_no = COALESCE($2, order_no),
       capacity = COALESCE($3, capacity),
       name = $4,
       description = $5,
       rtsp_link = $6,
       jetty_length_m = $7,
       jetty_draft = $8,
       jetty_dwt = $9,
       updated_at = NOW()
     WHERE id = $10 AND deleted_at IS NULL
     RETURNING id, port_id, order_no, name, description, rtsp_link, status, capacity, jetty_length_m, jetty_draft, jetty_dwt, created_at, updated_at`,
    [portId, orderNo, cap, name.trim(), description?.trim() ?? null, rtspLink, lengthM, draft, dwt, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  const row = result.rows[0];
  await saveJettyCommoditiesByPurpose(row.id, {
    unloading: unloading_commodity_ids,
    loading: loading_commodity_ids,
  });
  const afterCommodities = await loadJettyCommoditiesByPurpose(row.id);
  row.unloading_commodities_json = afterCommodities.Unloading;
  row.loading_commodities_json = afterCommodities.Loading;
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );

  const changes = [];
  const add = (field, from, to) => {
    if ((from ?? null) === (to ?? null)) return;
    changes.push({ field, from, to });
  };
  add('Port', beforeRow.port_name ?? beforeRow.port_id, portName.rows[0]?.name ?? row.port_id);
  add('Order', beforeRow.order_no, row.order_no);
  add('Name', beforeRow.name, row.name);
  add('Capacity', beforeRow.capacity, row.capacity);
  add('Length (m)', beforeRow.jetty_length_m, row.jetty_length_m);
  add('Draft', beforeRow.jetty_draft, row.jetty_draft);
  add('DWT', beforeRow.jetty_dwt, row.jetty_dwt);
  add('Status', beforeRow.status, row.status);
  add('Description', beforeRow.description ?? null, row.description ?? null);
  add('RTSP link', beforeRow.rtsp_link ?? null, row.rtsp_link ?? null);
  if (Array.isArray(unloading_commodity_ids)) {
    appendCommodityPurposeChanges(
      changes,
      'Allowed for Unloading',
      commodityNames(beforeCommodities.Unloading),
      commodityNames(afterCommodities.Unloading)
    );
  }
  if (Array.isArray(loading_commodity_ids)) {
    appendCommodityPurposeChanges(
      changes,
      'Allowed for Loading',
      commodityNames(beforeCommodities.Loading),
      commodityNames(afterCommodities.Loading)
    );
  }

  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'update',
    entityType: 'Jetty',
    entityId: row.id,
    entityLabel: row.name,
    summary: 'Updated jetty',
    changes: changes.length ? changes : [{ field: 'No changes', from: '—', to: '—' }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
});

router.put('/:id/status', ...requirePageEdit('master-jetty'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { status } = req.body || {};
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'status required; one of: ' + VALID_STATUSES.join(', '),
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT id, status, name FROM jetties WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const beforeRow = before.rows[0] ?? null;
    if (!beforeRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Jetty not found' });
    }
    if (isJettyUnavailableMasterStatus(status)) {
      const blocking = await countBlockingOperationsOnJetty(client, id);
      if (blocking > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:
            'Cannot set this status while active operations use the jetty. Reassign or complete them on Allocation & Berthing first.',
        });
      }
    }
    const up = await client.query(
      `UPDATE jetties SET status = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, port_id, order_no, name, description, status, created_at, updated_at`,
      [status, id]
    );
    if (up.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Jetty not found' });
    }
    await client.query(
      `INSERT INTO jetty_status_history (jetty_id, status) VALUES ($1, $2)`,
      [id, status]
    );
    await client.query('COMMIT');
    const row = up.rows[0];
    const portName = await pool.query(
      'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
      [row.port_id]
    );
    writeActivityLog({
      pageKey: 'master-jetty',
      action: 'update',
      entityType: 'Jetty',
      entityId: row.id,
      entityLabel: row.name,
      summary: 'Updated jetty status',
      changes: [{ field: 'Status', from: beforeRow.status ?? null, to: status }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', ...requirePageEdit('master-jetty'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT 1 FROM operations WHERE jetty_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (op.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete jetty while operations reference it' });
  }
  const result = await pool.query(
    `UPDATE jetties SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'delete',
    entityType: 'Jetty',
    entityId: id,
    entityLabel: `Jetty ${id}`,
    summary: 'Deleted jetty',
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

function toJetty(row) {
  return {
    id: row.id,
    portId: row.port_id,
    portName: row.port_name ?? undefined,
    orderNo: row.order_no,
    name: row.name,
    description: row.description ?? null,
    rtspLink: row.rtsp_link ?? null,
    status: row.status,
    capacity: row.capacity != null ? Number(row.capacity) : 1,
    jettyLengthM: row.jetty_length_m != null ? Number(row.jetty_length_m) : null,
    jettyDraft: row.jetty_draft != null ? Number(row.jetty_draft) : null,
    jettyDwt: row.jetty_dwt != null ? Number(row.jetty_dwt) : null,
    unloadingCommodities: Array.isArray(row.unloading_commodities_json)
      ? row.unloading_commodities_json
      : (row.unloadingCommodities ?? []),
    loadingCommodities: Array.isArray(row.loading_commodities_json)
      ? row.loading_commodities_json
      : (row.loadingCommodities ?? []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
