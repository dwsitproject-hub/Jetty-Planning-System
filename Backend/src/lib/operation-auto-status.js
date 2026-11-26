/**
 * Automatic promotions for operations.status (at-berth hub saves).
 * Use inside an existing transaction with the same `client`.
 */

/** Final Post-Checking steps: saving one promotes the operation to POST_OPS. */
export const POST_CHECK_AUTO_KEYS = new Set([
  'final_inspection',
  'final_tank_inspection',
  'final_hold_inspection',
  'final_sounding',
]);

/**
 * @param {import('pg').PoolClient} client
 * @param {number} operationId
 * @returns {Promise<{ promoted: boolean }>}
 */
export async function promoteDockedToInProgressIfDocked(client, operationId) {
  const r = await client.query(
    `UPDATE operations
     SET status = 'IN_PROGRESS', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL AND status = 'DOCKED'
     RETURNING id`,
    [operationId]
  );
  return { promoted: r.rowCount > 0 };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} operationId
 * @returns {Promise<{ promoted: boolean }>}
 */
export async function promoteInProgressToPostOpsIfInProgress(client, operationId) {
  const r = await client.query(
    `UPDATE operations
     SET status = 'POST_OPS',
         completion_percent = 100,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL AND status = 'IN_PROGRESS'
     RETURNING id`,
    [operationId]
  );
  return { promoted: r.rowCount > 0 };
}

/**
 * After an Operational save: DOCKED → IN_PROGRESS, then → POST_OPS when a final
 * Post-Checking step was already saved (e.g. second SI on a call filled out of order).
 * @param {import('pg').PoolClient} client
 * @param {number} operationId
 * @returns {Promise<{ promoted: boolean, postOps: boolean }>}
 */
export async function promoteAfterOperationalSave(client, operationId) {
  const { promoted } = await promoteDockedToInProgressIfDocked(client, operationId);
  const r = await client.query(
    `UPDATE operations o
     SET status = 'POST_OPS',
         completion_percent = 100,
         updated_at = NOW()
     WHERE o.id = $1 AND o.deleted_at IS NULL AND o.status = 'IN_PROGRESS'
       AND EXISTS (
         SELECT 1 FROM operation_sub_processes sp
         WHERE sp.operation_id = o.id AND sp.deleted_at IS NULL
           AND sp.phase = 'Post-Checking' AND sp.sub_process_key = ANY($2::text[])
       )
     RETURNING o.id`,
    [operationId, [...POST_CHECK_AUTO_KEYS]]
  );
  return { promoted: promoted || r.rowCount > 0, postOps: r.rowCount > 0 };
}
