/**
 * Operational milestone activities (timed) + milestone N/A rows (merged entry_type).
 * Timeline merges with operation_sub_processes (Pre + Post) for unified activity log.
 */
import express from 'express';
import { pool } from '../db.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';
import { promoteDockedToInProgressIfDocked } from '../lib/operation-auto-status.js';
import { loadOperationScheduleTimezone, parseScheduleInstantToIso } from '../lib/schedule-instant.js';
import { computeAtgWindowMassDelta } from '../lib/atg-window-rate.js';

const router = express.Router();

router.use(optionalAuth);

const MILESTONE_KEYS = new Set([
  'opening_hatch',
  'cargo_pre_conditioning',
  'cargo_operations',
  'other',
]);

const START_ONLY_MILESTONE_KEYS = new Set(['opening_hatch', 'cargo_pre_conditioning']);

/** Milestones where end_at may be NULL (Opening, Pre-conditioning, Cargo Operations). */
function milestoneAllowsNullEnd(milestoneKey) {
  return START_ONLY_MILESTONE_KEYS.has(milestoneKey) || milestoneKey === 'cargo_operations';
}

function operationalActivityTitle(milestoneKey) {
  if (milestoneKey === 'opening_hatch') return 'OPENING';
  return String(milestoneKey || '').replace(/_/g, ' ').toUpperCase();
}

const SUB_PROCESS_TITLE = {
  key_meeting: 'KEY MEETING',
  nor_accepted: 'NOR ACCEPTED',
  inspection: 'INSPECTION',
  tank_inspection: 'INSPECTION',
  hold_inspection: 'INSPECTION',
  sampling: 'SAMPLING',
  initial_cargo_checking: 'INITIAL CARGO CHECKING',
  initial_sounding: 'INITIAL CARGO CHECKING',
  initial_draft_survey: 'INITIAL CARGO CHECKING',
  final_inspection: 'FINAL INSPECTION',
  final_tank_inspection: 'FINAL INSPECTION',
  final_hold_inspection: 'FINAL INSPECTION',
  final_sounding: 'FINAL CARGO CHECKING',
};

function parseOperationId(raw) {
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

function titleForSubProcessKey(key) {
  return SUB_PROCESS_TITLE[key] || String(key || '').replace(/_/g, ' ').toUpperCase();
}

async function assertOperationAccess(operationId, req) {
  await assertOperationInSelectedPort(operationId, req.selectedPortId);
}

/** Same SI commodity_type resolution as operations route (Solid | Liquid). */
async function loadCommodityTypeForOperation(q, operationId) {
  const r = await q.query(
    `SELECT COALESCE(
      (SELECT sc.commodity_type FROM public.shipping_instruction_breakdown b
       JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id LIMIT 1),
      'Liquid'
    ) AS commodity_type
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  if (r.rows.length === 0) return null;
  const t = String(r.rows[0].commodity_type || 'Liquid');
  return t === 'Solid' ? 'Solid' : 'Liquid';
}

async function resolveCargoHandlingMethodIdForOpening(q, commodityType) {
  const code = commodityType === 'Solid' ? 'conveyor' : 'hose';
  const r = await q.query(
    `SELECT id FROM master_cargo_handling_methods
     WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE`,
    [code]
  );
  if (r.rows.length === 0) {
    const err = new Error(
      `Master data missing active cargo handling method with code "${code}" (required for Opening)`
    );
    err.statusCode = 400;
    throw err;
  }
  return r.rows[0].id;
}

/** Cargo handling method FK: only opening_hatch rows store it; all other milestones null. */
async function resolveActivityCargoHandlingMethodId(q, operationId, milestoneKey) {
  if (milestoneKey !== 'opening_hatch') return null;
  const ct = await loadCommodityTypeForOperation(q, operationId);
  if (!ct) {
    const err = new Error('Operation not found or has no shipping instruction');
    err.statusCode = 404;
    throw err;
  }
  return resolveCargoHandlingMethodIdForOpening(q, ct);
}

async function loadPrimarySiCargoLine(q, operationId) {
  const r = await q.query(
    `SELECT tot.s AS qty, mc.code AS metric_code, mc.label AS metric_name
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT SUM(b.qty::numeric) AS s
       FROM shipping_instruction_breakdown b
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
     ) tot ON true
     LEFT JOIN LATERAL (
       SELECT m.code, m.label
       FROM shipping_instruction_breakdown b
       LEFT JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id
       LIMIT 1
     ) mc ON true
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  return r.rows[0] ?? null;
}

/** Sum of load-line qty on other cargo_operations activities for the same operation (excludes excludeActivityId). */
async function sumOtherCargoOpsLineQty(q, operationId, excludeActivityId) {
  const r = await q.query(
    `SELECT COALESCE(SUM(l.qty), 0)::numeric AS s
     FROM operation_cargo_load_lines l
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id
     WHERE oa.operation_id = $1
       AND oa.deleted_at IS NULL
       AND oa.entry_type = 'activity'
       AND oa.milestone_key = 'cargo_operations'
       AND ($2::bigint IS NULL OR oa.id <> $2::bigint)`,
    [operationId, excludeActivityId]
  );
  return Number(r.rows[0]?.s || 0);
}

/**
 * @param {import('pg').PoolClient|import('pg').Pool} q
 * @param {number|null} excludeActivityId — null for POST
 */
async function parseValidateCargoLoadLines(q, body, milestoneKey, scheduleTz, parentStartIso, operationId, excludeActivityId) {
  if (milestoneKey !== 'cargo_operations') {
    return { ok: true, lines: null };
  }
  const legacy = body.cargoMovedQty ?? body.cargo_moved_qty;
  if (legacy !== undefined && legacy !== null && legacy !== '') {
    return {
      ok: false,
      status: 400,
      error: 'Use cargoLoadLines for cargo_operations; do not send cargoMovedQty',
    };
  }
  const raw = body.cargoLoadLines ?? body.cargo_load_lines;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'cargoLoadLines must be a non-empty array for cargo_operations',
    };
  }
  const parentStartMs = new Date(parentStartIso).getTime();
  if (Number.isNaN(parentStartMs)) {
    return { ok: false, status: 400, error: 'Invalid activity start time for cargo load lines' };
  }

  const commodityType = await loadCommodityTypeForOperation(q, operationId);
  if (!commodityType) {
    return { ok: false, status: 404, error: 'Operation not found or has no shipping instruction' };
  }

  const parsed = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {};
    const st = row.startAt ?? row.start_at;
    const en = row.endAt ?? row.end_at;
    if (st === undefined || st === null || st === '') {
      return { ok: false, status: 400, error: `cargoLoadLines[${i}].startAt is required` };
    }
    const startIso = parseScheduleInstantToIso(st, scheduleTz);
    if (startIso === undefined || startIso === null) {
      return { ok: false, status: 400, error: `cargoLoadLines[${i}].startAt is invalid` };
    }
    const startMs = new Date(startIso).getTime();
    if (Number.isNaN(startMs)) {
      return { ok: false, status: 400, error: `cargoLoadLines[${i}].startAt is invalid` };
    }
    if (startMs < parentStartMs) {
      return {
        ok: false,
        status: 400,
        error: `cargoLoadLines[${i}].startAt must be on or after the activity start time`,
      };
    }

    let endIso = null;
    let endMs = null;
    const hasEnd = en !== undefined && en !== null && en !== '';
    if (hasEnd) {
      endIso = parseScheduleInstantToIso(en, scheduleTz);
      if (endIso === undefined || endIso === null) {
        return { ok: false, status: 400, error: `cargoLoadLines[${i}].endAt is invalid` };
      }
      endMs = new Date(endIso).getTime();
      if (Number.isNaN(endMs)) {
        return { ok: false, status: 400, error: `cargoLoadLines[${i}].endAt is invalid` };
      }
      if (endMs <= startMs) {
        return {
          ok: false,
          status: 400,
          error: `cargoLoadLines[${i}].endAt must be after startAt`,
        };
      }
    }

    const qtyRaw = row.qty ?? row.quantity;
    let qty = null;
    if (qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== '') {
      qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, status: 400, error: `cargoLoadLines[${i}].qty must be a positive number` };
      }
    }

    if (hasEnd && qty == null) {
      return { ok: false, status: 400, error: `cargoLoadLines[${i}].qty is required when endAt is set` };
    }

    const rawTankIds = row.tankIds ?? row.tank_ids;
    let lineTankIds = [];
    if (rawTankIds !== undefined && rawTankIds !== null) {
      if (!Array.isArray(rawTankIds)) {
        return { ok: false, status: 400, error: `cargoLoadLines[${i}].tankIds must be an array` };
      }
      for (let j = 0; j < rawTankIds.length; j++) {
        const n = parseInt(String(rawTankIds[j]), 10);
        if (!Number.isFinite(n) || n <= 0) {
          return { ok: false, status: 400, error: `cargoLoadLines[${i}].tankIds[${j}] is invalid` };
        }
        if (!lineTankIds.includes(n)) lineTankIds.push(n);
      }
    }

    if (commodityType === 'Solid') {
      if (lineTankIds.length > 0) {
        return {
          ok: false,
          status: 400,
          error: `cargoLoadLines[${i}].tankIds are not allowed for solid commodity cargo operations`,
        };
      }
    } else if (lineTankIds.length === 0) {
      return {
        ok: false,
        status: 400,
        error: `cargoLoadLines[${i}]: select at least one tank`,
      };
    } else {
      const tankCheck = await validateTankIdsForPort(q, lineTankIds, operationId, `cargoLoadLines[${i}]`);
      if (!tankCheck.ok) return tankCheck;
      lineTankIds = tankCheck.tankIds;
    }

    parsed.push({ qty, startIso, endIso, startMs, endMs, hasEnd, _i: i, tankIds: lineTankIds });
  }

  parsed.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a._i - b._i;
  });

  const openCount = parsed.filter((p) => !p.hasEnd).length;
  if (openCount > 1) {
    return { ok: false, status: 400, error: 'Only one load segment may be in progress (missing endAt)' };
  }
  if (openCount === 1 && parsed[parsed.length - 1].hasEnd) {
    return { ok: false, status: 400, error: 'In-progress segment (missing endAt) must be the last entry' };
  }

  for (let i = 1; i < parsed.length; i++) {
    const prevEndMs = parsed[i - 1].endMs;
    if (prevEndMs == null) {
      return {
        ok: false,
        status: 400,
        error: 'Cannot add entries after an in-progress segment without endAt',
      };
    }
    if (parsed[i].startMs < prevEndMs) {
      return {
        ok: false,
        status: 400,
        error:
          'cargoLoadLines segments must not overlap: each entry startAt must be on or after the previous entry endAt',
      };
    }
    if (parsed[i].startMs <= parsed[i - 1].startMs) {
      return {
        ok: false,
        status: 400,
        error: 'cargoLoadLines startAt values must be strictly increasing',
      };
    }
  }

  const totalQty = parsed.reduce((s, x) => s + (x.qty != null ? x.qty : 0), 0);
  const line = await loadPrimarySiCargoLine(q, operationId);
  if (!line || line.qty == null) {
    return {
      ok: false,
      status: 400,
      error: 'Shipping instruction has no breakdown quantity for cargo operations',
    };
  }
  const siQty = Number(line.qty);
  const otherSum = await sumOtherCargoOpsLineQty(q, operationId, excludeActivityId);
  const budget = siQty - otherSum;
  if (totalQty > budget + 1e-9) {
    return {
      ok: false,
      status: 400,
      error: `Load line quantities exceed remaining quantity (remaining ${budget})`,
    };
  }

  const lines = parsed.map((p, idx) => ({
    qty: p.qty,
    startIso: p.startIso,
    endIso: p.endIso,
    lineOrder: idx + 1,
    tankIds: p.tankIds || [],
  }));
  return { ok: true, lines };
}

async function attachAtgMassSnapshots(client, lines, { commodityType }) {
  const out = [];
  for (const ln of lines) {
    const tankIds = ln.tankIds || [];
    if (commodityType !== 'Liquid' || tankIds.length === 0) {
      out.push({ ...ln, atgMassDelta: null, atgMassDetail: null });
      continue;
    }
    const endAt = ln.endIso || new Date().toISOString();
    const result = await computeAtgWindowMassDelta(client, {
      tankIds,
      startAt: ln.startIso,
      endAt,
    });
    const detail = {
      sumDeltaMass: result.sumDeltaMass,
      incomplete: result.incomplete,
      error: result.error,
      tanks: result.tanks,
    };
    out.push({
      ...ln,
      atgMassDelta: result.ok ? result.sumDeltaMass : null,
      atgMassDetail: detail,
    });
  }
  return out;
}

function mapCargoLoadLineRow(row, tanks = null) {
  const base = {
    id: String(row.id),
    lineOrder: Number(row.line_order),
    qty: row.qty != null ? Number(row.qty) : null,
    startAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    endAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    atgMassDelta:
      row.atg_mass_delta != null && row.atg_mass_delta !== '' ? Number(row.atg_mass_delta) : null,
    atgMassDetail: row.atg_mass_detail ?? null,
    atgMassComputedAt: row.atg_mass_computed_at ?? null,
  };
  if (Array.isArray(tanks)) {
    base.tanks = tanks;
    base.tankIds = tanks.map((t) => t.id);
  }
  return base;
}

async function insertLoadLineTanks(client, loadLineId, tankIds) {
  if (!Array.isArray(tankIds) || tankIds.length === 0) return;
  for (const tankId of tankIds) {
    await client.query(
      `INSERT INTO operation_cargo_load_line_tanks (load_line_id, tank_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [loadLineId, tankId]
    );
  }
}

async function fetchTanksForLoadLineIds(q, loadLineIds) {
  if (!loadLineIds.length) return new Map();
  const r = await q.query(
    `SELECT clt.load_line_id, t.id, t.code, t.name
     FROM operation_cargo_load_line_tanks clt
     JOIN master_tanks t ON t.id = clt.tank_id
     WHERE clt.load_line_id = ANY($1::bigint[])
     ORDER BY clt.load_line_id ASC, t.sort_order ASC, LOWER(t.code) ASC, t.id ASC`,
    [loadLineIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    const lid = Number(row.load_line_id);
    if (!map.has(lid)) map.set(lid, []);
    map.get(lid).push({
      id: String(row.id),
      code: row.code,
      name: row.name ?? null,
    });
  }
  return map;
}

async function insertCargoLoadLines(client, operationalActivityId, lines, opts = {}) {
  const { commodityType = 'Liquid' } = opts;
  const enriched = await attachAtgMassSnapshots(client, lines, { commodityType });
  const lineIds = [];
  const out = [];
  for (let i = 0; i < enriched.length; i++) {
    const ln = enriched[i];
    const ins = await client.query(
      `INSERT INTO operation_cargo_load_lines (
         operational_activity_id, line_order, qty, started_at, ended_at,
         atg_mass_delta, atg_mass_detail, atg_mass_computed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::jsonb,
         CASE WHEN $6::numeric IS NULL THEN NULL::timestamptz ELSE NOW() END)
       RETURNING id, line_order, qty, started_at, ended_at, atg_mass_delta, atg_mass_detail, atg_mass_computed_at`,
      [
        operationalActivityId,
        ln.lineOrder ?? i + 1,
        ln.qty,
        ln.startIso,
        ln.endIso,
        ln.atgMassDelta,
        ln.atgMassDetail ? JSON.stringify(ln.atgMassDetail) : null,
      ]
    );
    const loadLineId = Number(ins.rows[0].id);
    lineIds.push(loadLineId);
    await insertLoadLineTanks(client, loadLineId, ln.tankIds || []);
    out.push(mapCargoLoadLineRow(ins.rows[0]));
  }
  const tankMap = await fetchTanksForLoadLineIds(client, lineIds);
  return out.map((row, i) => {
    const tanks = tankMap.get(lineIds[i]) || [];
    return { ...row, tanks, tankIds: tanks.map((t) => t.id) };
  });
}

async function replaceCargoLoadLines(client, operationalActivityId, lines, opts = {}) {
  await client.query(`DELETE FROM operation_cargo_load_lines WHERE operational_activity_id = $1`, [
    operationalActivityId,
  ]);
  return insertCargoLoadLines(client, operationalActivityId, lines, opts);
}

async function loadOperationPortId(q, operationId) {
  const r = await q.query(
    `SELECT COALESCE(o.port_id, j.port_id) AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  const portId = r.rows[0]?.port_id != null ? Number(r.rows[0].port_id) : null;
  return Number.isFinite(portId) ? portId : null;
}

async function validateTankIdsForPort(q, ids, operationId, errorPrefix) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, status: 400, error: `${errorPrefix}: select at least one tank` };
  }
  const portId = await loadOperationPortId(q, operationId);
  if (portId == null) {
    return { ok: false, status: 400, error: 'Operation has no port; cannot validate tanks' };
  }
  const r = await q.query(
    `SELECT id FROM master_tanks
     WHERE deleted_at IS NULL AND port_id = $1 AND id = ANY($2::bigint[])`,
    [portId, ids]
  );
  if (r.rows.length !== ids.length) {
    return {
      ok: false,
      status: 400,
      error: `${errorPrefix}: one or more tankIds are invalid or not available for this port`,
    };
  }
  return { ok: true, tankIds: ids };
}

/**
 * Legacy activity-level tank validation (ignored on save; per-line tankIds are used instead).
 */
async function parseValidateCargoTanks(q, body, milestoneKey, operationId) {
  if (milestoneKey !== 'cargo_operations') {
    return { ok: true, tankIds: null };
  }
  // Per-line tankIds are validated in parseValidateCargoLoadLines; ignore legacy body.tankIds.
  return { ok: true, tankIds: [] };
}

async function replaceCargoActivityTanks(client, operationalActivityId, tankIds) {
  await client.query(
    `DELETE FROM operation_cargo_activity_tanks WHERE operational_activity_id = $1`,
    [operationalActivityId]
  );
  if (!Array.isArray(tankIds) || tankIds.length === 0) return [];
  for (const tankId of tankIds) {
    await client.query(
      `INSERT INTO operation_cargo_activity_tanks (operational_activity_id, tank_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [operationalActivityId, tankId]
    );
  }
  return fetchTanksForActivityIds(client, [operationalActivityId]).then(
    (m) => m.get(Number(operationalActivityId)) || []
  );
}

async function fetchTanksForActivityIds(q, activityIds) {
  if (!activityIds.length) return new Map();
  const r = await q.query(
    `SELECT cat.operational_activity_id, t.id, t.code, t.name
     FROM operation_cargo_activity_tanks cat
     JOIN master_tanks t ON t.id = cat.tank_id
     WHERE cat.operational_activity_id = ANY($1::bigint[])
     ORDER BY cat.operational_activity_id ASC, t.sort_order ASC, LOWER(t.code) ASC, t.id ASC`,
    [activityIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    const aid = Number(row.operational_activity_id);
    if (!map.has(aid)) map.set(aid, []);
    map.get(aid).push({
      id: String(row.id),
      code: row.code,
      name: row.name ?? null,
    });
  }
  return map;
}

async function fetchCargoLoadLinesForActivityIds(q, activityIds) {
  if (!activityIds.length) return new Map();
  const r = await q.query(
    `SELECT id, operational_activity_id, line_order, qty, started_at, ended_at,
            atg_mass_delta, atg_mass_detail, atg_mass_computed_at
     FROM operation_cargo_load_lines
     WHERE operational_activity_id = ANY($1::bigint[])
     ORDER BY operational_activity_id ASC, line_order ASC, id ASC`,
    [activityIds]
  );
  const lineIds = r.rows.map((row) => Number(row.id));
  const tankMap = await fetchTanksForLoadLineIds(q, lineIds);
  const map = new Map();
  for (const row of r.rows) {
    const aid = Number(row.operational_activity_id);
    if (!map.has(aid)) map.set(aid, []);
    const tanks = tankMap.get(Number(row.id)) || [];
    map.get(aid).push(mapCargoLoadLineRow(row, tanks));
  }
  return map;
}

function unionTanksFromLines(cargoLoadLines) {
  const seen = new Set();
  const tanks = [];
  for (const ln of cargoLoadLines || []) {
    for (const tk of ln.tanks || []) {
      if (!seen.has(tk.id)) {
        seen.add(tk.id);
        tanks.push(tk);
      }
    }
  }
  return tanks;
}

function toRow(r, cargoLoadLines, legacyTanks) {
  const base = {
    id: String(r.id),
    operationId: r.operation_id,
    entryType: r.entry_type,
    milestoneKey: r.milestone_key,
    subStepTitle: r.sub_step_title ?? null,
    remark: r.remark ?? null,
    reason: r.reason ?? null,
    startAt: r.start_at ?? null,
    endAt: r.end_at ?? null,
    markedAt: r.marked_at ?? null,
    cargoHandlingMethodId: r.cargo_handling_method_id ?? null,
    cargoHandlingMethodName: r.cargo_handling_method_name ?? null,
    cargoMovedQty: r.cargo_moved_qty != null && r.cargo_moved_qty !== '' ? Number(r.cargo_moved_qty) : null,
    atgFlowRateTph:
      r.atg_flow_rate_tph != null && r.atg_flow_rate_tph !== '' ? Number(r.atg_flow_rate_tph) : null,
    atgRateDetail: r.atg_rate_detail ?? null,
    atgRateComputedAt: r.atg_rate_computed_at ?? null,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
  if (Array.isArray(cargoLoadLines)) {
    base.cargoLoadLines = cargoLoadLines;
    const union = unionTanksFromLines(cargoLoadLines);
    if (union.length > 0) {
      base.tanks = union;
      base.tankIds = union.map((t) => t.id);
    } else if (Array.isArray(legacyTanks) && legacyTanks.length > 0) {
      base.tanks = legacyTanks;
      base.tankIds = legacyTanks.map((t) => t.id);
    }
  } else if (Array.isArray(legacyTanks) && legacyTanks.length > 0) {
    base.tanks = legacyTanks;
    base.tankIds = legacyTanks.map((t) => t.id);
  }
  return base;
}

async function softDeleteMilestoneNaFor(operationId, milestoneKey, client = null) {
  const q = `UPDATE operation_operational_activities
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE operation_id = $1 AND milestone_key = $2 AND entry_type = 'milestone_na' AND deleted_at IS NULL`;
  const args = [operationId, milestoneKey];
  if (client) await client.query(q, args);
  else await pool.query(q, args);
}

/** GET /operations/:operationId/operational-activities */
router.get('/operations/:operationId/operational-activities', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationAccess(operationId, req);
  const r = await pool.query(
    `SELECT oa.id, oa.operation_id, oa.entry_type, oa.milestone_key, oa.sub_step_title, oa.remark, oa.reason,
            oa.start_at, oa.end_at, oa.marked_at, oa.created_at, oa.updated_at,
            oa.cargo_handling_method_id, oa.cargo_moved_qty,
            oa.atg_flow_rate_tph, oa.atg_rate_detail, oa.atg_rate_computed_at,
            mhm.name AS cargo_handling_method_name
     FROM operation_operational_activities oa
     LEFT JOIN master_cargo_handling_methods mhm
       ON mhm.id = oa.cargo_handling_method_id
      AND mhm.deleted_at IS NULL
     WHERE oa.operation_id = $1 AND oa.deleted_at IS NULL
     ORDER BY
      CASE oa.entry_type WHEN 'milestone_na' THEN 0 ELSE 1 END,
      COALESCE(oa.start_at, oa.marked_at, oa.created_at) ASC NULLS LAST,
      oa.id ASC`,
    [operationId]
  );
  const cargoActIds = r.rows
    .filter((x) => x.entry_type === 'activity' && x.milestone_key === 'cargo_operations')
    .map((x) => Number(x.id));
  const [lineMap, tankMap] = await Promise.all([
    fetchCargoLoadLinesForActivityIds(pool, cargoActIds),
    fetchTanksForActivityIds(pool, cargoActIds),
  ]);
  res.json({
    entries: r.rows.map((row) =>
      row.entry_type === 'activity' && row.milestone_key === 'cargo_operations'
        ? toRow(row, lineMap.get(Number(row.id)) || [], tankMap.get(Number(row.id)) || [])
        : toRow(row)
    ),
  });
});

/** POST /operations/:operationId/operational-activities */
router.post('/operations/:operationId/operational-activities', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationAccess(operationId, req);

  const body = req.body || {};
  const entryType = String(body.entryType || body.entry_type || '').trim();
  const milestoneKey = String(body.milestoneKey || body.milestone_key || '').trim();

  if (!['activity', 'milestone_na'].includes(entryType)) {
    return res.status(400).json({ error: 'entryType must be activity or milestone_na' });
  }
  if (!MILESTONE_KEYS.has(milestoneKey)) {
    return res.status(400).json({ error: 'Invalid milestoneKey' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (entryType === 'activity') {
      const scheduleTz = await loadOperationScheduleTimezone(client, operationId);
      const remark = String(body.remark ?? '').trim();
      const subStepTitle = body.subStepTitle != null ? String(body.subStepTitle).trim() : '';
      const startAt = body.startAt || body.start_at;
      const endAt = body.endAt || body.end_at;
      if (!remark) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'remark is required for activity' });
      }
      if (!startAt) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'startAt is required for activity' });
      }
      const startIso = parseScheduleInstantToIso(startAt, scheduleTz);
      if (startIso === undefined || startIso === null) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid startAt' });
      }
      const ta = new Date(startIso);
      let tbIso = null;
      if (milestoneAllowsNullEnd(milestoneKey)) {
        if (endAt != null && endAt !== '') {
          const endParsed = parseScheduleInstantToIso(endAt, scheduleTz);
          if (endParsed === undefined || endParsed === null) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid endAt' });
          }
          const tb = new Date(endParsed);
          if (Number.isNaN(tb.getTime()) || tb < ta) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid endAt' });
          }
          tbIso = endParsed;
        }
      } else {
        if (!endAt) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'startAt and endAt are required for activity' });
        }
        const endParsed = parseScheduleInstantToIso(endAt, scheduleTz);
        if (endParsed === undefined || endParsed === null) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid endAt' });
        }
        const tb = new Date(endParsed);
        if (Number.isNaN(tb.getTime()) || tb < ta) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid startAt/endAt' });
        }
        tbIso = endParsed;
      }

      const linePack = await parseValidateCargoLoadLines(
        client,
        body,
        milestoneKey,
        scheduleTz,
        startIso,
        operationId,
        null
      );
      if (!linePack.ok) {
        await client.query('ROLLBACK');
        return res.status(linePack.status).json({ error: linePack.error });
      }

      let activityCargoHandlingMethodId = null;
      try {
        activityCargoHandlingMethodId = await resolveActivityCargoHandlingMethodId(
          client,
          operationId,
          milestoneKey
        );
      } catch (e) {
        await client.query('ROLLBACK');
        const status = Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400;
        return res.status(status).json({ error: e.message || 'Could not resolve cargo handling method' });
      }

      await softDeleteMilestoneNaFor(operationId, milestoneKey, client);

      const ins = await client.query(
        `INSERT INTO operation_operational_activities
         (operation_id, entry_type, milestone_key, sub_step_title, remark, start_at, end_at, cargo_handling_method_id, cargo_moved_qty)
         VALUES ($1,'activity',$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at, cargo_handling_method_id, cargo_moved_qty`,
        [
          operationId,
          milestoneKey,
          subStepTitle || null,
          remark,
          startIso,
          tbIso,
          activityCargoHandlingMethodId,
          null,
        ]
      );
      const row = ins.rows[0];
      let savedLines = null;
      const commodityType = await loadCommodityTypeForOperation(client, operationId);
      if (milestoneKey === 'cargo_operations' && linePack.lines?.length) {
        savedLines = await insertCargoLoadLines(client, row.id, linePack.lines, {
          commodityType: commodityType || 'Liquid',
        });
      }
      if (milestoneKey === 'cargo_operations') {
        await replaceCargoActivityTanks(client, row.id, []);
      }
      await promoteDockedToInProgressIfDocked(client, operationId);
      await client.query('COMMIT');
      if (row.cargo_handling_method_id) {
        const m = await pool.query(
          `SELECT name FROM master_cargo_handling_methods WHERE id = $1 AND deleted_at IS NULL`,
          [row.cargo_handling_method_id]
        );
        row.cargo_handling_method_name = m.rows[0]?.name ?? null;
      }
      writeActivityLog({
        pageKey: 'loading',
        action: 'add',
        entityType: 'Operational activity',
        entityId: String(operationId),
        entityLabel: milestoneKey,
        summary: `Added operational activity (${milestoneKey})`,
        meta: { operationId, entryId: row.id },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      return res.status(201).json(
        milestoneKey === 'cargo_operations'
          ? toRow(row, savedLines || [], [])
          : toRow(row)
      );
    }

    // milestone_na
    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'reason is required for milestone_na' });
    }
    const markedAt = body.markedAt || body.marked_at ? new Date(body.markedAt || body.marked_at) : new Date();
    if (Number.isNaN(markedAt.getTime())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid markedAt' });
    }

    const ex = await client.query(
      `SELECT id FROM operation_operational_activities
       WHERE operation_id = $1 AND milestone_key = $2 AND entry_type = 'milestone_na' AND deleted_at IS NULL`,
      [operationId, milestoneKey]
    );

    let row;
    if (ex.rows[0]) {
      const up = await client.query(
        `UPDATE operation_operational_activities SET
           reason = $1, marked_at = $2, updated_at = NOW()
         WHERE id = $3 AND deleted_at IS NULL
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [reason, markedAt.toISOString(), ex.rows[0].id]
      );
      row = up.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO operation_operational_activities
         (operation_id, entry_type, milestone_key, reason, marked_at)
         VALUES ($1,'milestone_na',$2,$3,$4)
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at`,
        [operationId, milestoneKey, reason, markedAt.toISOString()]
      );
      row = ins.rows[0];
    }
    await promoteDockedToInProgressIfDocked(client, operationId);
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: 'loading',
      action: ex.rows[0] ? 'update' : 'add',
      entityType: 'Operational milestone N/A',
      entityId: String(operationId),
      entityLabel: milestoneKey,
      summary: `${ex.rows[0] ? 'Updated' : 'Marked'} operational milestone N/A (${milestoneKey})`,
      meta: { operationId, entryId: row.id },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(ex.rows[0] ? 200 : 201).json(toRow(row));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

/** PUT /operations/:operationId/operational-activities/:entryId */
router.put('/operations/:operationId/operational-activities/:entryId', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  const entryId = parseInt(req.params.entryId, 10);
  if (operationId == null || Number.isNaN(entryId)) {
    return res.status(400).json({ error: 'Invalid operationId or entryId' });
  }
  await assertOperationAccess(operationId, req);
  const cur = await pool.query(
    `SELECT * FROM operation_operational_activities
     WHERE id = $1 AND operation_id = $2 AND deleted_at IS NULL`,
    [entryId, operationId]
  );
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });

  const row0 = cur.rows[0];
  const body = req.body || {};

  if (row0.entry_type === 'activity') {
    const milestoneKey = String(body.milestoneKey || body.milestone_key || row0.milestone_key).trim();
    if (!MILESTONE_KEYS.has(milestoneKey)) {
      return res.status(400).json({ error: 'Invalid milestoneKey' });
    }
    const remark = body.remark != null ? String(body.remark).trim() : row0.remark;
    const subStepTitle = body.subStepTitle != null ? String(body.subStepTitle).trim() : row0.sub_step_title;
    const startAt = body.startAt || body.start_at || row0.start_at;
    let endAt = row0.end_at;
    if (Object.prototype.hasOwnProperty.call(body, 'endAt')) endAt = body.endAt;
    else if (Object.prototype.hasOwnProperty.call(body, 'end_at')) endAt = body.end_at;
    if (!remark) return res.status(400).json({ error: 'remark is required' });
    const scheduleTz = await loadOperationScheduleTimezone(pool, operationId);
    const startIso = parseScheduleInstantToIso(startAt, scheduleTz);
    if (startIso === undefined || startIso === null) return res.status(400).json({ error: 'Invalid startAt' });
    const ta = new Date(startIso);
    let tbIso = null;
    if (milestoneAllowsNullEnd(milestoneKey)) {
      if (endAt != null && endAt !== '') {
        const endParsed = parseScheduleInstantToIso(endAt, scheduleTz);
        if (endParsed === undefined || endParsed === null) return res.status(400).json({ error: 'Invalid endAt' });
        const tb = new Date(endParsed);
        if (Number.isNaN(tb.getTime()) || tb < ta) return res.status(400).json({ error: 'Invalid endAt' });
        tbIso = endParsed;
      }
    } else {
      const endParsed = parseScheduleInstantToIso(endAt, scheduleTz);
      if (endParsed === undefined || endParsed === null) return res.status(400).json({ error: 'Invalid endAt' });
      const tb = new Date(endParsed);
      if (Number.isNaN(tb.getTime()) || tb < ta) return res.status(400).json({ error: 'Invalid startAt/endAt' });
      tbIso = endParsed;
    }

    let linePack = { ok: true, lines: null };
    if (milestoneKey === 'cargo_operations') {
      linePack = await parseValidateCargoLoadLines(pool, body, milestoneKey, scheduleTz, startIso, operationId, entryId);
      if (!linePack.ok) {
        return res.status(linePack.status).json({ error: linePack.error });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (milestoneKey !== row0.milestone_key) {
        await softDeleteMilestoneNaFor(operationId, milestoneKey, client);
      }

      let putActivityCargoHandlingMethodId = null;
      try {
        putActivityCargoHandlingMethodId = await resolveActivityCargoHandlingMethodId(
          client,
          operationId,
          milestoneKey
        );
      } catch (e) {
        await client.query('ROLLBACK');
        const status = Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400;
        return res.status(status).json({ error: e.message || 'Could not resolve cargo handling method' });
      }

      const up = await client.query(
        `UPDATE operation_operational_activities SET
           milestone_key = $1,
           sub_step_title = $2,
           remark = $3,
           start_at = $4,
           end_at = $5,
           cargo_handling_method_id = $6,
           cargo_moved_qty = $7,
           updated_at = NOW()
         WHERE id = $8 AND operation_id = $9 AND entry_type = 'activity' AND deleted_at IS NULL
         RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                   start_at, end_at, marked_at, created_at, updated_at, cargo_handling_method_id, cargo_moved_qty`,
        [
          milestoneKey,
          subStepTitle || null,
          remark,
          startIso,
          tbIso,
          putActivityCargoHandlingMethodId,
          null,
          entryId,
          operationId,
        ]
      );
      let savedLinesPut = null;
      const commodityTypePut = await loadCommodityTypeForOperation(client, operationId);
      if (milestoneKey === 'cargo_operations' && linePack.lines?.length) {
        savedLinesPut = await replaceCargoLoadLines(client, entryId, linePack.lines, {
          commodityType: commodityTypePut || 'Liquid',
        });
      }
      if (milestoneKey === 'cargo_operations') {
        await replaceCargoActivityTanks(client, entryId, []);
      } else if (row0.milestone_key === 'cargo_operations' && milestoneKey !== 'cargo_operations') {
        await client.query(`DELETE FROM operation_cargo_load_lines WHERE operational_activity_id = $1`, [entryId]);
        await client.query(`DELETE FROM operation_cargo_activity_tanks WHERE operational_activity_id = $1`, [entryId]);
      }
      await promoteDockedToInProgressIfDocked(client, operationId);
      await client.query('COMMIT');
      const row = up.rows[0];
      if (row.cargo_handling_method_id) {
        const m = await pool.query(
          `SELECT name FROM master_cargo_handling_methods WHERE id = $1 AND deleted_at IS NULL`,
          [row.cargo_handling_method_id]
        );
        row.cargo_handling_method_name = m.rows[0]?.name ?? null;
      }
      writeActivityLog({
        pageKey: 'loading',
        action: 'update',
        entityType: 'Operational activity',
        entityId: String(operationId),
        entityLabel: milestoneKey,
        summary: `Updated operational activity (${milestoneKey})`,
        meta: { operationId, entryId },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      return res.json(
        milestoneKey === 'cargo_operations'
          ? toRow(row, savedLinesPut || [], [])
          : toRow(row)
      );
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // milestone_na — only reason / marked_at
  const reason = body.reason != null ? String(body.reason).trim() : row0.reason;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  let markedAt = row0.marked_at;
  if (body.markedAt || body.marked_at) {
    const d = new Date(body.markedAt || body.marked_at);
    if (!Number.isNaN(d.getTime())) markedAt = d.toISOString();
  }
  const clientNa = await pool.connect();
  try {
    await clientNa.query('BEGIN');
    const up = await clientNa.query(
      `UPDATE operation_operational_activities SET reason = $1, marked_at = $2, updated_at = NOW()
       WHERE id = $3 AND operation_id = $4 AND entry_type = 'milestone_na' AND deleted_at IS NULL
       RETURNING id, operation_id, entry_type, milestone_key, sub_step_title, remark, reason,
                 start_at, end_at, marked_at, created_at, updated_at`,
      [reason, markedAt, entryId, operationId]
    );
    await promoteDockedToInProgressIfDocked(clientNa, operationId);
    await clientNa.query('COMMIT');
    writeActivityLog({
      pageKey: 'loading',
      action: 'update',
      entityType: 'Operational milestone N/A',
      entityId: String(operationId),
      entityLabel: row0.milestone_key,
      summary: `Updated operational milestone N/A (${row0.milestone_key})`,
      meta: { operationId, entryId },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.json(toRow(up.rows[0]));
  } catch (e) {
    await clientNa.query('ROLLBACK');
    throw e;
  } finally {
    clientNa.release();
  }
});

/** DELETE /operations/:operationId/operational-activities/:entryId */
router.delete('/operations/:operationId/operational-activities/:entryId', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  const entryId = parseInt(req.params.entryId, 10);
  if (operationId == null || Number.isNaN(entryId)) {
    return res.status(400).json({ error: 'Invalid operationId or entryId' });
  }
  await assertOperationAccess(operationId, req);
  const r = await pool.query(
    `UPDATE operation_operational_activities SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND operation_id = $2 AND deleted_at IS NULL
     RETURNING entry_type, milestone_key`,
    [entryId, operationId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
  writeActivityLog({
    pageKey: 'loading',
    action: 'delete',
    entityType: r.rows[0].entry_type === 'milestone_na' ? 'Operational milestone N/A' : 'Operational activity',
    entityId: String(operationId),
    entityLabel: r.rows[0].milestone_key,
    summary: `Deleted operational entry (${r.rows[0].milestone_key})`,
    meta: { operationId, entryId },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

/** GET /operations/:operationId/activity-timeline */
router.get('/operations/:operationId/activity-timeline', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationAccess(operationId, req);

  const [sp, opAct] = await Promise.all([
    pool.query(
      `SELECT sp.id, sp.operation_id, sp.phase, sp.sub_process_key, sp.status, sp.occurred_at, sp.start_at, sp.end_at,
              sp.skip_reason, sp.remark, sp.updated_at, sp.created_at,
              COALESCE(
                doc.j,
                '[]'::jsonb
              ) AS documents_json
       FROM operation_sub_processes sp
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', d.id,
                    'name', d.original_name,
                    'url', '/api/v1/sub-process-documents/' || d.id::text || '/download',
                    'mimeType', d.mime_type,
                    'createdAt', d.created_at
                  )
                  ORDER BY d.created_at ASC, d.id ASC
                ) AS j
         FROM operation_sub_process_documents d
         WHERE d.sub_process_id = sp.id AND d.deleted_at IS NULL
       ) doc ON TRUE
       WHERE sp.operation_id = $1 AND sp.deleted_at IS NULL
       ORDER BY COALESCE(sp.start_at, sp.occurred_at, sp.updated_at, sp.created_at) ASC NULLS LAST, sp.id ASC`,
      [operationId]
    ),
    pool.query(
      `SELECT oa.id, oa.entry_type, oa.milestone_key, oa.sub_step_title, oa.remark, oa.reason,
              oa.start_at, oa.end_at, oa.marked_at, oa.created_at, oa.cargo_handling_method_id,
              oa.cargo_moved_qty,
              mhm.name AS cargo_handling_method_name,
              COALESCE(cl.cnt, 0)::int AS cargo_load_line_count,
              cl.total_qty,
              cl.last_line_ended_at,
              COALESCE(ll.lines_json, '[]'::jsonb) AS cargo_load_lines_json,
              COALESCE(tk.tanks_json, '[]'::jsonb) AS cargo_tanks_json
       FROM operation_operational_activities oa
       LEFT JOIN master_cargo_handling_methods mhm
         ON mhm.id = oa.cargo_handling_method_id
        AND mhm.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt,
                SUM(l.qty)::numeric AS total_qty,
                MAX(l.ended_at) AS last_line_ended_at
         FROM operation_cargo_load_lines l
         WHERE l.operational_activity_id = oa.id
       ) cl ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'lineOrder', l.line_order,
                    'qty', l.qty,
                    'startedAt', l.started_at,
                    'endedAt', l.ended_at,
                    'atgMassDelta', l.atg_mass_delta,
                    'atgMassDetail', l.atg_mass_detail,
                    'atgMassComputedAt', l.atg_mass_computed_at,
                    'tanks', COALESCE(lt.tanks_json, '[]'::jsonb)
                  )
                  ORDER BY l.line_order ASC, l.id ASC
                ) AS lines_json
         FROM operation_cargo_load_lines l
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
                    jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name)
                    ORDER BY t.sort_order ASC, LOWER(t.code) ASC, t.id ASC
                  ) AS tanks_json
           FROM operation_cargo_load_line_tanks clt
           JOIN master_tanks t ON t.id = clt.tank_id
           WHERE clt.load_line_id = l.id
         ) lt ON TRUE
         WHERE l.operational_activity_id = oa.id
       ) ll ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', t.id,
                    'code', t.code,
                    'name', t.name
                  )
                  ORDER BY t.sort_order ASC, LOWER(t.code) ASC, t.id ASC
                ) AS tanks_json
         FROM operation_cargo_activity_tanks cat
         JOIN master_tanks t ON t.id = cat.tank_id
         WHERE cat.operational_activity_id = oa.id
       ) tk ON TRUE
       WHERE oa.operation_id = $1 AND oa.deleted_at IS NULL`,
      [operationId]
    ),
  ]);

  const events = [];

  for (const r of sp.rows) {
    const phase = r.phase;
    const key = r.sub_process_key;
    const sortTs = r.start_at || r.occurred_at || r.updated_at || r.created_at;
    let documents = [];
    const dj = r.documents_json;
    if (dj != null && Array.isArray(dj)) {
      documents = dj.map((x) => ({
        id: x.id,
        name: x.name ?? null,
        url: x.url ?? null,
        mimeType: x.mimeType ?? null,
        createdAt: x.createdAt ?? null,
      }));
    }
    events.push({
      id: `sp-${r.id}`,
      source: 'sub_process',
      phase,
      subProcessKey: key,
      title: titleForSubProcessKey(key),
      status: r.status ?? null,
      skipReason: r.skip_reason ?? null,
      remark: r.remark ?? null,
      occurredAt: r.occurred_at ?? null,
      startAt: r.start_at ?? r.occurred_at ?? null,
      endAt: r.end_at ?? null,
      sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
      documents,
    });
  }

  for (const r of opAct.rows) {
    if (r.entry_type === 'activity') {
      const sortTs = r.start_at || r.created_at;
      const lineCount = Number(r.cargo_load_line_count || 0);
      const totalFromLines = r.total_qty != null ? Number(r.total_qty) : null;
      const lastLineEndedAt = r.last_line_ended_at ?? null;
      let cargoRatePerHour = null;
      if (r.milestone_key === 'cargo_operations' && r.start_at) {
        if (lineCount > 0 && lastLineEndedAt != null && totalFromLines != null) {
          const ms = new Date(lastLineEndedAt).getTime() - new Date(r.start_at).getTime();
          const hours = ms / 3600000;
          if (hours > 1e-9) cargoRatePerHour = totalFromLines / hours;
        } else if (
          lineCount === 0 &&
          r.cargo_moved_qty != null &&
          r.end_at
        ) {
          const ms = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
          const hours = ms / 3600000;
          if (hours > 0) cargoRatePerHour = Number(r.cargo_moved_qty) / hours;
        }
      }
      const cargoMovedQty =
        lineCount > 0 && totalFromLines != null
          ? totalFromLines
          : r.cargo_moved_qty != null
            ? Number(r.cargo_moved_qty)
            : null;
      const rawLines = Array.isArray(r.cargo_load_lines_json) ? r.cargo_load_lines_json : [];
      const cargoLoadLines = rawLines.map((l) => {
        const rawLineTanks = Array.isArray(l.tanks) ? l.tanks : [];
        const lineTanks = rawLineTanks.map((t) => ({
          id: String(t.id),
          code: t.code ?? null,
          name: t.name ?? null,
        }));
        return {
          lineOrder: l.lineOrder ?? null,
          qty: l.qty != null ? Number(l.qty) : null,
          startedAt: l.startedAt ? new Date(l.startedAt).toISOString() : null,
          endedAt: l.endedAt ? new Date(l.endedAt).toISOString() : null,
          atgMassDelta: l.atgMassDelta != null ? Number(l.atgMassDelta) : null,
          atgMassDetail: l.atgMassDetail ?? null,
          atgMassComputedAt: l.atgMassComputedAt ?? null,
          tanks: lineTanks,
          tankIds: lineTanks.map((t) => t.id),
        };
      });
      const unionFromLines = unionTanksFromLines(cargoLoadLines);
      const rawTanks = Array.isArray(r.cargo_tanks_json) ? r.cargo_tanks_json : [];
      const legacyTanks = rawTanks.map((t) => ({
        id: String(t.id),
        code: t.code ?? null,
        name: t.name ?? null,
      }));
      const tanks = unionFromLines.length > 0 ? unionFromLines : legacyTanks;
      events.push({
        id: `op-${r.id}`,
        source: 'operational_activity',
        phase: 'Operational',
        milestoneKey: r.milestone_key,
        title: operationalActivityTitle(r.milestone_key),
        subStepTitle: r.sub_step_title ?? null,
        cargoHandlingMethodId: r.cargo_handling_method_id ?? null,
        cargoHandlingMethodName: r.cargo_handling_method_name ?? null,
        remark: r.remark ?? null,
        occurredAt: null,
        startAt: r.start_at ?? null,
        endAt: r.end_at ?? null,
        cargoMovedQty,
        cargoLoadLineCount: lineCount,
        cargoLastLineEndedAt: lastLineEndedAt ? new Date(lastLineEndedAt).toISOString() : null,
        cargoRatePerHour,
        cargoLoadLines,
        tanks,
        tankIds: tanks.map((t) => t.id),
        sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
        documents: [],
      });
    } else {
      const sortTs = r.marked_at || r.created_at;
      events.push({
        id: `op-${r.id}`,
        source: 'operational_milestone_na',
        phase: 'Operational',
        milestoneKey: r.milestone_key,
        title: `${operationalActivityTitle(r.milestone_key)} · N/A`,
        reason: r.reason ?? null,
        occurredAt: null,
        startAt: null,
        endAt: null,
        sortAt: sortTs ? new Date(sortTs).toISOString() : new Date(r.created_at).toISOString(),
        documents: [],
      });
    }
  }

  events.sort((a, b) => {
    const ta = new Date(a.sortAt).getTime();
    const tb = new Date(b.sortAt).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  res.json({ events });
});

export default router;
