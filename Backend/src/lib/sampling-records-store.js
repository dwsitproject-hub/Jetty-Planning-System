import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';

const KEY = `operation_id = $1 AND phase = 'Pre-Checking' AND sub_process_key = 'sampling' AND deleted_at IS NULL`;

function recordsOf(payload) {
  return Array.isArray(payload?.records) ? payload.records : [];
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

/**
 * Read-modify-write one sampling record under a row lock, so concurrent editors
 * (QC menu, Loading hub) each keep the other's samples.
 * @param {(records: object[]) => { records: object[], record: object }} mutate pure operation
 * @returns {{ record: object, records: object[], updatedAt: string }}
 */
export async function mutateSamplingRecords(operationId, actorUserId, mutate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockSamplingRow(client, operationId, actorUserId);
    const result = mutate(recordsOf(row.payload_json), () => randomUUID());
    const payload = { ...(row.payload_json ?? {}), records: result.records };
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
