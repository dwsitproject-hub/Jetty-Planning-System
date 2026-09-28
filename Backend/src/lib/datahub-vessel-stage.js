/**
 * Stage DataHub vessel sync runs (manual pull or inbound webhook).
 */
import { COMPARED_COLUMNS, buildSyncPlan } from './datahub-vessel-sync.js';
import { applyEntityItem } from './datahub-master-sync-config.js';

/**
 * @param {import('pg').PoolClient} client inside a transaction
 * @param {{ entityType?: string, items, summary, source?, webhookDeliveryId?, createdBy?, preapproveChanges? }} params
 */
export async function insertStagedSyncRun(
  client,
  {
    entityType = 'vessel',
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
       finished_at, created_by, source, webhook_delivery_id, entity_type
     ) VALUES ('staged', $1, $2, $3, $4, NOW(), $5, $6, $7, $8)
     RETURNING id`,
    [
      summary.hubRecordCount,
      summary.newCount,
      summary.changedCount,
      summary.unchangedCount,
      createdBy,
      source,
      webhookDeliveryId,
      entityType,
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

/** Backward-compatible alias. */
export async function insertStagedVesselSyncRun(client, params) {
  return insertStagedSyncRun(client, { ...params, entityType: 'vessel' });
}

/**
 * Apply all approved items on a staged run.
 * @param {import('pg').Pool} db
 * @param {number} runId
 * @param {number | null} actorUserId
 */
export async function applyStagedSyncRunByEntity(db, runId, actorUserId = null) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const runRes = await client.query(
      `SELECT * FROM datahub_vessel_sync_runs WHERE id = $1 FOR UPDATE`,
      [runId]
    );
    if (runRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Sync run not found');
    }
    if (runRes.rows[0].status !== 'staged') {
      await client.query('ROLLBACK');
      throw new Error(`Sync run is already ${runRes.rows[0].status}`);
    }

    const entityType = runRes.rows[0].entity_type || 'vessel';
    const runSource = runRes.rows[0].source === 'webhook' ? 'webhook' : 'manual_sync';

    const approved = await client.query(
      `SELECT * FROM datahub_vessel_sync_items
       WHERE run_id = $1 AND decision = 'approved' AND applied_at IS NULL`,
      [runId]
    );

    let created = 0;
    let updated = 0;
    for (const item of approved.rows) {
      const { action } = await applyEntityItem(entityType, client, item, actorUserId, {
        applySource: runSource,
        applyRunId: runId,
      });
      if (action === 'created') created += 1;
      else updated += 1;
      await client.query(
        `UPDATE datahub_vessel_sync_items SET applied_at = NOW() WHERE id = $1`,
        [item.id]
      );
    }

    await client.query(
      `UPDATE datahub_vessel_sync_runs SET
         status = 'applied', applied_count = $1, applied_at = NOW(), applied_by = $2
       WHERE id = $3`,
      [created + updated, actorUserId ?? null, runId]
    );
    await client.query('COMMIT');
    return { created, updated, applied: created + updated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function applyStagedVesselSyncRun(db, runId, actorUserId = null) {
  return applyStagedSyncRunByEntity(db, runId, actorUserId);
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
    const runId = await insertStagedSyncRun(client, {
      entityType: 'vessel',
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
