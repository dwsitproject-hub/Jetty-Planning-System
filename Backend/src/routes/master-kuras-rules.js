/**
 * Kuras rule master (per port): when a closed cargo segment is auto-tagged Kuras (cleaning).
 * One default rule per port covers commodities not listed in any other rule.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { retagKurasForPort } from '../lib/kuras-movement-store.js';
import {
  actorUserIdFromReq,
  masterAuditJoinSql,
  masterAuditSelectSql,
  pickMasterAudit,
} from '../lib/master-row-audit.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';

const PAGE_KEY = 'master-kuras-rules';
const router = express.Router();
router.use(requireAuth, requirePortScope);

function parsePortId(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function portAllowed(req, portId) {
  return (Array.isArray(req.assignedPortIds) ? req.assignedPortIds : []).includes(Number(portId));
}

function toRule(row) {
  return {
    id: String(row.id),
    portId: Number(row.port_id),
    isDefault: row.is_default === true,
    remainingPctBelow: Number(row.remaining_pct_below),
    rateMtPerHourBelow: Number(row.rate_mt_per_hour_below),
    matchMode: row.match_mode,
    isActive: row.is_active === true,
    commodities: (row.commodities || []).map((c) => ({ id: String(c.id), label: c.label })),
    ...pickMasterAudit(row),
  };
}

async function fetchRules(portId, ruleId = null) {
  const r = await pool.query(
    `SELECT t.id, t.port_id, t.is_default, t.remaining_pct_below, t.rate_mt_per_hour_below,
            t.match_mode, t.is_active, ${masterAuditSelectSql('t')},
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', sc.id, 'label', COALESCE(NULLIF(TRIM(sc.short_name), ''), sc.name))
                               ORDER BY sc.short_name)
              FROM master_kuras_rule_commodities rc
              JOIN si_commodities sc ON sc.id = rc.commodity_id
              WHERE rc.rule_id = t.id
            ), '[]'::jsonb) AS commodities
     FROM master_kuras_rules t
     ${masterAuditJoinSql('t')}
     WHERE t.port_id = $1 AND t.deleted_at IS NULL AND ($2::bigint IS NULL OR t.id = $2)
     ORDER BY t.is_default ASC, t.id ASC`,
    [portId, ruleId]
  );
  return r.rows.map(toRule);
}

/** Validate the editable fields; commodities only for non-default rules. */
function parseBody(body, { isDefault }) {
  const remaining = Number(body?.remainingPctBelow);
  const rate = Number(body?.rateMtPerHourBelow);
  const matchMode = String(body?.matchMode ?? 'and').toLowerCase();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 100) {
    return { error: 'remainingPctBelow must be between 0 and 100' };
  }
  if (!Number.isFinite(rate) || rate <= 0) return { error: 'rateMtPerHourBelow must be greater than 0' };
  if (matchMode !== 'and' && matchMode !== 'or') return { error: 'matchMode must be and or or' };
  const commodityIds = [
    ...new Set((Array.isArray(body?.commodityIds) ? body.commodityIds : []).map(Number).filter((n) => n > 0)),
  ];
  if (!isDefault && commodityIds.length === 0) return { error: 'Select at least one commodity' };
  return {
    remaining,
    rate,
    matchMode,
    isActive: body?.isActive !== false,
    commodityIds: isDefault ? [] : commodityIds,
  };
}

/** Commodities already used by another rule of the port → 409 message. */
async function findTakenCommodities(client, portId, commodityIds, ruleId) {
  if (!commodityIds.length) return [];
  const r = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(sc.short_name), ''), sc.name) AS label
     FROM master_kuras_rule_commodities rc
     JOIN si_commodities sc ON sc.id = rc.commodity_id
     WHERE rc.port_id = $1 AND rc.commodity_id = ANY($2::bigint[]) AND ($3::bigint IS NULL OR rc.rule_id <> $3)`,
    [portId, commodityIds, ruleId]
  );
  return r.rows.map((x) => x.label);
}

async function saveRule(req, res, { ruleId, portId, isDefault, fields }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taken = await findTakenCommodities(client, portId, fields.commodityIds, ruleId);
    if (taken.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Already in another Kuras rule: ${taken.join(', ')}` });
    }
    const actorId = actorUserIdFromReq(req);
    const values = [fields.remaining, fields.rate, fields.matchMode, fields.isActive, actorId];
    const saved = ruleId
      ? await client.query(
          `UPDATE master_kuras_rules
           SET remaining_pct_below = $1, rate_mt_per_hour_below = $2, match_mode = $3, is_active = $4,
               updated_by = $5, updated_at = NOW()
           WHERE id = $6 RETURNING id`,
          [...values, ruleId]
        )
      : await client.query(
          `INSERT INTO master_kuras_rules
             (remaining_pct_below, rate_mt_per_hour_below, match_mode, is_active, created_by, updated_by, port_id, is_default)
           VALUES ($1, $2, $3, $4, $5, $5, $6, FALSE) RETURNING id`,
          [...values, portId]
        );
    const id = Number(saved.rows[0].id);
    if (!isDefault) {
      await client.query(`DELETE FROM master_kuras_rule_commodities WHERE rule_id = $1`, [id]);
      await client.query(
        `INSERT INTO master_kuras_rule_commodities (rule_id, port_id, commodity_id)
         SELECT $1, $2, unnest($3::bigint[])`,
        [id, portId, fields.commodityIds]
      );
    }
    await client.query('COMMIT');
    const [rule] = await fetchRules(portId, id);
    const label = rule.isDefault ? 'All others (default)' : rule.commodities.map((c) => c.label).join(', ');
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: ruleId ? 'update' : 'add',
      entityType: 'MasterKurasRule',
      entityId: String(id),
      entityLabel: label,
      summary: `${ruleId ? 'Updated' : 'Created'} Kuras rule ${label}: remaining < ${rule.remainingPctBelow}% ${rule.matchMode.toUpperCase()} rate < ${rule.rateMtPerHourBelow} MT/h${rule.isActive ? '' : ' (inactive)'}`,
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(ruleId ? 200 : 201).json(rule);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '23505') return res.status(409).json({ error: 'A commodity is already in another Kuras rule' });
    throw e;
  } finally {
    client.release();
  }
}

async function loadExisting(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const r = await pool.query(
    `SELECT id, port_id, is_default FROM master_kuras_rules WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!r.rows[0]) {
    res.status(404).json({ error: 'Kuras rule not found' });
    return null;
  }
  if (!portAllowed(req, r.rows[0].port_id)) {
    res.status(403).json({ error: 'Selected port is not assigned to this user' });
    return null;
  }
  return { id, portId: Number(r.rows[0].port_id), isDefault: r.rows[0].is_default === true };
}

/** GET /master/kuras-rules?portId= */
router.get('/', ...requirePageView(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.query.portId);
  if (portId == null) return res.status(400).json({ error: 'portId is required' });
  if (!portAllowed(req, portId)) return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  res.json(await fetchRules(portId));
});

/** POST /master/kuras-rules */
router.post('/', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.body?.portId);
  if (portId == null) return res.status(400).json({ error: 'portId is required' });
  if (!portAllowed(req, portId)) return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  const fields = parseBody(req.body, { isDefault: false });
  if (fields.error) return res.status(400).json({ error: fields.error });
  return saveRule(req, res, { ruleId: null, portId, isDefault: false, fields });
});

/** PUT /master/kuras-rules/:id */
router.put('/:id', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const existing = await loadExisting(req, res);
  if (!existing) return undefined;
  const fields = parseBody(req.body, { isDefault: existing.isDefault });
  if (fields.error) return res.status(400).json({ error: fields.error });
  return saveRule(req, res, { ruleId: existing.id, portId: existing.portId, isDefault: existing.isDefault, fields });
});

/** DELETE /master/kuras-rules/:id — soft delete; the default rule stays. */
router.delete('/:id', ...requirePageDelete(PAGE_KEY), async (req, res) => {
  const existing = await loadExisting(req, res);
  if (!existing) return undefined;
  if (existing.isDefault) return res.status(400).json({ error: 'The default rule cannot be deleted; turn it off instead' });
  await pool.query(`DELETE FROM master_kuras_rule_commodities WHERE rule_id = $1`, [existing.id]);
  await pool.query(`UPDATE master_kuras_rules SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [existing.id]);
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'delete',
    entityType: 'MasterKurasRule',
    entityId: String(existing.id),
    entityLabel: `Kuras rule ${existing.id}`,
    summary: `Deleted Kuras rule ${existing.id}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  return res.status(204).send();
});

/** POST /master/kuras-rules/recheck — re-apply the rules to every auto-tagged segment at the port. */
router.post('/recheck', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const portId = parsePortId(req.body?.portId);
  if (portId == null) return res.status(400).json({ error: 'portId is required' });
  if (!portAllowed(req, portId)) return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  const result = await retagKurasForPort(pool, portId);
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'update',
    entityType: 'MasterKurasRule',
    entityId: `port-${portId}`,
    entityLabel: 'Re-check past entries',
    summary: `Re-checked ${result.updated} cargo entries on ${result.operations} voyages`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  return res.json(result);
});

export default router;
