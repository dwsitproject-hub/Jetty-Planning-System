/**
 * Shared DataHub staging + apply for vessel, incoterm, and commodity.
 */
import { fetchHubRecordByCode } from './datahub-client.js';
import { insertStagedSyncRun, applyStagedSyncRunByEntity } from './datahub-vessel-stage.js';
import {
  buildEntitySyncPlan,
  fetchHubRecords,
  loadLocalHubCode,
  loadLocalRows,
  stagedItemsForInsert,
  DATAHUB_ENTITY_TYPES,
} from './datahub-master-sync-config.js';

export { DATAHUB_ENTITY_TYPES };

function sameHubCode(left, right) {
  const a = String(left ?? '').trim().toUpperCase();
  const b = String(right ?? '').trim().toUpperCase();
  return a !== '' && a === b;
}

/**
 * Keep the one hub row the user asked for. Drops the commodity local-only sweep
 * and any other catalog rows that a full plan would include.
 */
export function scopePlanToHubCode(items, summary, hubCode) {
  const kept = (items ?? []).filter((item) => !item.localOnly && sameHubCode(item.hubCode, hubCode));
  return {
    items: kept,
    summary: {
      ...summary,
      hubRecordCount: kept.length,
      newCount: kept.filter((item) => item.diffKind === 'new').length,
      changedCount: kept.filter((item) => item.diffKind === 'changed').length,
      unchangedCount: kept.filter((item) => item.diffKind === 'unchanged').length,
      localUnchangedCount: 0,
      nameConflictCount: kept.filter((item) => item.nameConflict?.matches?.length).length,
    },
  };
}

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
  const plan = await buildEntitySyncPlan(entityType, hubRecords, localLoad);
  let items = plan.items;
  let summary = plan.summary;
  if (opts.skippedNotUse != null && Number(opts.skippedNotUse) > 0) {
    summary = { ...summary, skippedNotUse: Number(opts.skippedNotUse) };
  }
  if (opts.onlyHubCode) {
    const scoped = scopePlanToHubCode(items, summary, opts.onlyHubCode);
    items = scoped.items;
    summary = scoped.summary;
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

/**
 * Pull one linked master row by its hub code and stage that diff only.
 */
export async function pullAndStageLocalRecord(db, entityType, cfg, localId, opts = {}) {
  const { hubCode } = await loadLocalHubCode(entityType, db, localId);
  const hub = await fetchHubRecordByCode(cfg, entityType, hubCode);
  if (hub.isDeleted) {
    const err = new Error(`DataHub has no active record for hub code ${hubCode}.`);
    err.status = 404;
    throw err;
  }
  return stageEntityFromHub(db, entityType, [hub], {
    ...opts,
    source: 'record',
    onlyHubCode: hubCode,
  });
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
