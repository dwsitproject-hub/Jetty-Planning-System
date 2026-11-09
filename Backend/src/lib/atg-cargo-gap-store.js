/**
 * ATG cargo gap persistence: acknowledgements and resync/ack audit history (activity_logs).
 */

export const RESYNC_ENTITY_TYPE = 'AtgOperationRecovery';
export const ACK_ENTITY_TYPE = 'AtgCargoGapAck';

/**
 * @param {import('pg').Pool} db
 * @param {number[]} operationIds
 * @returns {Promise<Map<string, { reason: string, acknowledgedAt: string, acknowledgedBy: string|null }>>}
 */
export async function loadAcknowledgements(db, operationIds) {
  const map = new Map();
  if (!operationIds?.length) return map;
  const r = await db.query(
    `SELECT a.gap_key, a.reason, a.acknowledged_at, u.username
     FROM atg_cargo_gap_acknowledgements a
     LEFT JOIN users u ON u.id = a.acknowledged_by
     WHERE a.operation_id = ANY($1::bigint[])`,
    [operationIds]
  );
  for (const row of r.rows) {
    map.set(row.gap_key, {
      reason: row.reason,
      acknowledgedAt: new Date(row.acknowledged_at).toISOString(),
      acknowledgedBy: row.username ?? null,
    });
  }
  return map;
}

/**
 * @param {import('pg').Pool} db
 * @param {{ operationId: number, gapKeys: string[], reason: string, userId: number|null }} input
 * @returns {Promise<string[]>} gap keys newly acknowledged
 */
export async function acknowledgeGaps(db, { operationId, gapKeys, reason, userId }) {
  const r = await db.query(
    `INSERT INTO atg_cargo_gap_acknowledgements (operation_id, gap_key, reason, acknowledged_by)
     SELECT $1, k, $3, $4 FROM unnest($2::text[]) AS k
     ON CONFLICT (gap_key) DO NOTHING
     RETURNING gap_key`,
    [operationId, gapKeys, reason, userId]
  );
  return r.rows.map((row) => row.gap_key);
}

/**
 * @param {import('pg').Pool} db
 * @param {{ operationId: number, gapKeys: string[] }} input
 * @returns {Promise<string[]>} gap keys reopened
 */
export async function reopenGaps(db, { operationId, gapKeys }) {
  const r = await db.query(
    `DELETE FROM atg_cargo_gap_acknowledgements
     WHERE operation_id = $1 AND gap_key = ANY($2::text[])
     RETURNING gap_key`,
    [operationId, gapKeys]
  );
  return r.rows.map((row) => row.gap_key);
}

function mapResyncRow(row) {
  const meta = row.meta_json || {};
  return {
    at: new Date(row.created_at).toISOString(),
    by: row.actor_username ?? null,
    outcome: meta.outcome ?? null,
    samplesInserted: meta.samplesInserted ?? 0,
    gapsBefore: (meta.gapsBefore || []).length,
    gapsAfter: (meta.gapsAfter || []).length,
  };
}

/**
 * Latest non-dry-run resync per operation.
 * @param {import('pg').Pool} db
 * @param {number[]} operationIds
 */
export async function loadLastResyncByOperation(db, operationIds) {
  const map = new Map();
  if (!operationIds?.length) return map;
  const r = await db.query(
    `SELECT DISTINCT ON (entity_id) entity_id, created_at, actor_username, meta_json
     FROM activity_logs
     WHERE deleted_at IS NULL
       AND entity_type = $1
       AND entity_id = ANY($2::text[])
       AND COALESCE(meta_json->>'dryRun', 'false') <> 'true'
     ORDER BY entity_id, created_at DESC, id DESC`,
    [RESYNC_ENTITY_TYPE, operationIds.map(String)]
  );
  for (const row of r.rows) map.set(Number(row.entity_id), mapResyncRow(row));
  return map;
}

/**
 * Resync, preview and acknowledgement entries for one operation, newest first.
 * @param {import('pg').Pool} db
 * @param {number} operationId
 * @param {number} [limit]
 */
export async function loadGapHistory(db, operationId, limit = 20) {
  const r = await db.query(
    `SELECT id, entity_type, summary, meta_json, actor_username, created_at
     FROM activity_logs
     WHERE deleted_at IS NULL
       AND entity_type = ANY($1::text[])
       AND entity_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [[RESYNC_ENTITY_TYPE, ACK_ENTITY_TYPE], String(operationId), limit]
  );
  return r.rows.map((row) => {
    const meta = row.meta_json || {};
    return {
      id: Number(row.id),
      kind: meta.kind ?? null,
      summary: row.summary,
      outcome: meta.outcome ?? null,
      reason: meta.reason ?? null,
      by: row.actor_username ?? null,
      at: new Date(row.created_at).toISOString(),
    };
  });
}
