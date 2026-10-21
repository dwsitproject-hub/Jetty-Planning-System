/**
 * Shared DataHub staging + apply for vessel, incoterm, and commodity.
 */
import { insertStagedSyncRun, applyStagedSyncRunByEntity } from './datahub-vessel-stage.js';
import {
  buildEntitySyncPlan,
  fetchHubRecords,
  loadLocalRows,
  stagedItemsForInsert,
  DATAHUB_ENTITY_TYPES,
} from './datahub-master-sync-config.js';

export { DATAHUB_ENTITY_TYPES };

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {'vessel'|'incoterm'|'commodity'} entityType
 * @param {Array} hubRecords
 * @param {object} opts
 */
export async function stageEntityFromHub(db, entityType, hubRecords, opts = {}) {
  if (!DATAHUB_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unsupported entity type: ${entityType}`);
  }

  const localLoad = await loadLocalRows(entityType, db);
  const localRows = entityType === 'commodity' ? localLoad.rows : localLoad;
  const { items, summary: planSummary } = await buildEntitySyncPlan(entityType, hubRecords, localLoad);
  let summary = planSummary;
  if (opts.skippedNotUse != null && Number(opts.skippedNotUse) > 0) {
    summary = { ...summary, skippedNotUse: Number(opts.skippedNotUse) };
  }

  const actionable = items.filter((i) => i.diffKind === 'new' || i.diffKind === 'changed');
  if (actionable.length === 0) {
    return { runId: null, summary, items };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const runId = await insertStagedSyncRun(client, {
      entityType,
      items: stagedItemsForInsert(entityType, items),
      summary,
      source: opts.source ?? 'manual',
      webhookDeliveryId: opts.webhookDeliveryId ?? null,
      createdBy: opts.createdBy ?? null,
      preapproveChanges: opts.preapproveChanges !== false,
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

/**
 * Pull from DHM and stage (manual sync entry point).
 */
export async function pullAndStageEntity(db, entityType, cfg, opts = {}) {
  const hubFetch = await fetchHubRecords(entityType, cfg, db);
  const hubRecords = Array.isArray(hubFetch) ? hubFetch : hubFetch.records;
  const skippedNotUse =
    hubFetch && !Array.isArray(hubFetch) && hubFetch.skippedNotUse != null
      ? Number(hubFetch.skippedNotUse)
      : 0;
  return stageEntityFromHub(db, entityType, hubRecords, { ...opts, skippedNotUse });
}

export async function applyStagedEntitySyncRun(db, runId, actorUserId = null) {
  return applyStagedSyncRunByEntity(db, runId, actorUserId);
}

/** @deprecated use stageEntityFromHub */
export async function stageVesselsFromHub(db, hubVessels, opts = {}) {
  return stageEntityFromHub(db, 'vessel', hubVessels, opts);
}

/** @deprecated use applyStagedEntitySyncRun */
export async function applyStagedVesselSyncRun(db, runId, actorUserId = null) {
  return applyStagedEntitySyncRun(db, runId, actorUserId);
}
