/**
 * Automatic promotions for operations.status (at-berth hub saves).
 * Use inside an existing transaction with the same `client`.
 */

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
     SET status = 'POST_OPS', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL AND status = 'IN_PROGRESS'
     RETURNING id`,
    [operationId]
  );
  return { promoted: r.rowCount > 0 };
}
