import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { recordWritePlan } from './sampling-commodity-qc.js';
import { getSiCommodityOptionsForOperation } from './si-commodity-options.js';

const KEY = `operation_id = $1 AND phase = 'Pre-Checking' AND sub_process_key = 'sampling' AND deleted_at IS NULL`;

function recordsOf(payload) {
  return Array.isArray(payload?.records) ? payload.records : [];
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** Lock the sampling row for the operation, creating an empty draft when none exists yet. */
async function lockSamplingRow(client, operationId, actorUserId) {
  const select = `SELECT id, payload_json FROM operation_sub_processes WHERE ${KEY} ORDER BY id DESC LIMIT 1 FOR UPDATE`;
  let found = await client.query(select, [operationId]);
  if (found.rows.length === 0) {
    await client.query(
      `INSERT INTO operation_sub_processes
         (operation_id, phase, sub_process_key, status, payload_json, created_by, updated_by)
       VALUES ($1, 'Pre-Checking', 'sampling', 'In Progress', '{"records":[]}'::jsonb, $2, $2)
       ON CONFLICT DO NOTHING`,
      [operationId, actorUserId]
    );
    found = await client.query(select, [operationId]);
  }
  return found.rows[0];
}

async function ensureCommodityRow(client, subProcessId, commodityId) {
  await client.query(
    `INSERT INTO sampling_commodity_qc (sub_process_id, commodity_id, remark, records_json)
     VALUES ($1, $2, '', '[]'::jsonb)
     ON CONFLICT (sub_process_id, commodity_id) WHERE deleted_at IS NULL DO NOTHING`,
    [subProcessId, commodityId]
  );
  const found = await client.query(
    `SELECT id, records_json FROM sampling_commodity_qc
     WHERE sub_process_id = $1 AND commodity_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [subProcessId, commodityId]
  );
  return found.rows[0];
}

/**
 * Read-modify-write one sampling record under a row lock.
 * `commodityId` writes that commodity's card. Without it, the legacy shared list is used.
 * @param {(records: object[], newId: () => string) => { records: object[], record: object }} mutate
 */
export async function mutateSamplingRecords(operationId, actorUserId, mutate, { commodityId = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockSamplingRow(client, operationId, actorUserId);
    const products = await getSiCommodityOptionsForOperation(client, operationId);
    const plan = recordWritePlan(commodityId, products.length);
    const targetId = plan.scope === 'commodity' ? Number(commodityId) : null;
    let result;
    if (targetId != null) {
      if (!products.some((p) => p.commodityId === targetId)) throw badRequest('Commodity is not on this shipping instruction');
      const card = await ensureCommodityRow(client, row.id, targetId);
      const current = Array.isArray(card.records_json) ? card.records_json : [];
      result = mutate(current, () => randomUUID());
      await client.query(
        `UPDATE sampling_commodity_qc
         SET records_json = $1::jsonb, updated_at = clock_timestamp()
         WHERE id = $2`,
        [JSON.stringify(result.records), card.id]
      );
    } else {
      result = mutate(recordsOf(row.payload_json), () => randomUUID());
    }
    const mirrorShared = plan.mirrorParent;
    const payload = mirrorShared
      ? { ...(row.payload_json ?? {}), records: result.records }
      : row.payload_json ?? {};
    const updated = await client.query(
      `UPDATE operation_sub_processes
       SET payload_json = $1::jsonb, updated_at = clock_timestamp(), updated_by = COALESCE($2::bigint, updated_by)
       WHERE id = $3
       RETURNING updated_at`,
      [JSON.stringify(payload), actorUserId, row.id]
    );
    await client.query('COMMIT');
    return { record: result.record, records: result.records, updatedAt: updated.rows[0].updated_at.toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
