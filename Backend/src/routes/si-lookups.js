/**
 * Shipping Instruction dropdown lookups (DB-backed, soft-delete aware).
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

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
      `SELECT id, name, sort_order FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, name`
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
  const { value } = req.body || {};
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: `${cfg.valueCol} is required` });
  }

  const cleaned = type === 'trade-terms' ? value.trim().toUpperCase() : value.trim();
  const result = await pool.query(
    `INSERT INTO ${cfg.table} (${cfg.valueCol}, sort_order)
     VALUES ($1, 0)
     RETURNING id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at`,
    [cleaned],
  );
  res.status(201).json(toItem(result.rows[0], type));
});

/** Master CRUD: PUT /si-lookups/:type/:id */
router.put('/:type/:id', async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!isValidType(type)) return res.status(400).json({ error: 'Invalid si lookup type' });
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const cfg = getTypeConfig(type);
  const { value } = req.body || {};
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: `${cfg.valueCol} is required` });
  }
  const cleaned = type === 'trade-terms' ? value.trim().toUpperCase() : value.trim();
  const result = await pool.query(
    `UPDATE ${cfg.table}
     SET ${cfg.valueCol} = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id, ${cfg.valueCol} AS value, sort_order, created_at, updated_at`,
    [cleaned, id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
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
  const result = await pool.query(
    `UPDATE ${cfg.table}
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
  res.status(204).send();
});

export default router;
