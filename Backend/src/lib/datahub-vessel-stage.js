/**
 * Stage DataHub vessel sync runs (manual pull or inbound webhook).
 */
import { COMPARED_COLUMNS, buildSyncPlan } from './datahub-vessel-sync.js';

/**
 * @param {import('pg').PoolClient} client inside a transaction
 */
export async function insertStagedVesselSyncRun(
  client,
  {
    items,
    summary,
    source = 'manual',
    webhookDeliveryId = null,
    createdBy = null,
    preapproveChanges = true,
  }
) {
  const runRes = await client.query(
    `INSERT INTO datahub_vessel_sync_runs (
       status, hub_record_count, new_count, changed_count, unchanged_count,
       finished_at, created_by, source, webhook_delivery_id
     ) VALUES ('staged', $1, $2, $3, $4, NOW(), $5, $6, $7)
     RETURNING id`,
    [
      summary.hubRecordCount,
      summary.newCount,
      summary.changedCount,
      summary.unchangedCount,
      createdBy,
      source,
      webhookDeliveryId,
    ]
  );
  const runId = runRes.rows[0].id;

  for (const item of items) {
    let decision = 'pending';
    if (preapproveChanges) {
      decision = item.diffKind === 'unchanged' ? 'rejected' : 'approved';
    }
    await client.query(
      `INSERT INTO datahub_vessel_sync_items (
         run_id, vessel_id, hub_code, vessel_name, diff_kind, payload, field_diff, decision
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        runId,
        item.vesselId,
        item.hubCode,
        item.vesselName,
        item.diffKind,
        JSON.stringify({
          values: item.values,
          hubCode: item.hubCode,
          hubRecordId: item.hubRecordId,
          hubVersion: item.hubVersion,
          hubUpdatedAt: item.hubUpdatedAt,
        }),
        JSON.stringify(item.fieldDiff),
        decision,
      ]
    );
  }

  return Number(runId);
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {Array} hubVessels normalized hub records
 * @param {object} opts
 * @returns {Promise<{ runId: number | null, summary: object, items: Array }>}
 */
export async function stageVesselsFromHub(db, hubVessels, opts = {}) {
  const {
    source = 'manual',
    webhookDeliveryId = null,
    createdBy = null,
    preapproveChanges = true,
  } = opts;

  const localRows = await db.query(
    `SELECT id, hub_code, ${COMPARED_COLUMNS.join(', ')}
     FROM master_vessels WHERE deleted_at IS NULL`
  );
  const { items, summary } = buildSyncPlan(hubVessels, localRows.rows);

  const actionable = items.filter((i) => i.diffKind === 'new' || i.diffKind === 'changed');
  if (actionable.length === 0) {
    return { runId: null, summary, items };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const runId = await insertStagedVesselSyncRun(client, {
      items,
      summary,
      source,
      webhookDeliveryId,
      createdBy,
      preapproveChanges,
    });
    await client.query('COMMIT');
    return { runId, summary, items: actionable };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
