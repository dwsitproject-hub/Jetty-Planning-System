/**
 * Soft-delete an operation and common dependent rows inside an open transaction.
 * @param {import('pg').PoolClient} client
 * @param {number} operationId
 */
export async function softDeleteOperationInTransaction(client, operationId) {
  await client.query(
    `UPDATE qc_documents SET deleted_at = NOW(), updated_at = NOW()
     WHERE qc_survey_id IN (SELECT id FROM qc_surveys WHERE operation_id = $1 AND deleted_at IS NULL)
     AND deleted_at IS NULL`,
    [operationId]
  );
  await client.query(
    `UPDATE qc_surveys SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
  await client.query(
    `UPDATE quantity_checks SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
  await client.query(
    `UPDATE operation_materials SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
  await client.query(
    `UPDATE operations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
}
