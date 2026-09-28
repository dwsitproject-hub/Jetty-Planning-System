/**
 * DataHub master sync entity registry (vessel, incoterm, commodity).
 */
import {
  fetchAllSyncRecords,
  fetchAllVessels,
  normalizeHubCommodity,
  normalizeHubIncoterm,
} from './datahub-client.js';
import { COMPARED_COLUMNS, buildSyncPlan } from './datahub-vessel-sync.js';
import { buildIncotermSyncPlan, toStagedItemRow as incotermToStaged } from './datahub-incoterm-sync.js';
import { buildCommoditySyncPlan, toStagedItemRow as commodityToStaged } from './datahub-commodity-sync.js';
import { applyVesselItem } from './datahub-vessel-apply.js';
import { applyIncotermItem } from './datahub-incoterm-apply.js';
import { applyCommodityItem } from './datahub-commodity-apply.js';

/** @typedef {'vessel'|'incoterm'|'commodity'} DataHubEntityType */

export const DATAHUB_ENTITY_TYPES = new Set(['vessel', 'incoterm', 'commodity']);

/**
 * @param {DataHubEntityType} entityType
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function fetchHubRecords(entityType, cfg, db) {
  if (entityType === 'vessel') {
    return fetchAllVessels(cfg);
  }
  if (entityType === 'incoterm') {
    return fetchAllSyncRecords(cfg, 'incoterm', normalizeHubIncoterm);
  }
  if (entityType === 'commodity') {
    return fetchAllSyncRecords(cfg, 'commodity', normalizeHubCommodity);
  }
  throw new Error(`Unknown entity type: ${entityType}`);
}

/**
 * @param {DataHubEntityType} entityType
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadLocalRows(entityType, db) {
  if (entityType === 'vessel') {
    const r = await db.query(
      `SELECT id, hub_code, ${COMPARED_COLUMNS.join(', ')}
       FROM master_vessels WHERE deleted_at IS NULL`
    );
    return r.rows;
  }
  if (entityType === 'incoterm') {
    const r = await db.query(
      `SELECT id, hub_code, code, long_name, description
       FROM si_trade_terms WHERE deleted_at IS NULL`
    );
    return r.rows;
  }
  if (entityType === 'commodity') {
    const metrics = await db.query(`SELECT id, code FROM metric WHERE deleted_at IS NULL`);
    const metricIdByCode = {};
    for (const m of metrics.rows) {
      metricIdByCode[String(m.code).toUpperCase()] = Number(m.id);
    }
    const r = await db.query(
      `SELECT id, hub_code, name, short_name, commodity_type, kl_to_mt_factor, default_metric_id, hs_code
       FROM si_commodities WHERE deleted_at IS NULL`
    );
    return { rows: r.rows, metricIdByCode };
  }
  throw new Error(`Unknown entity type: ${entityType}`);
}

/**
 * @param {DataHubEntityType} entityType
 */
export async function buildEntitySyncPlan(entityType, hubRecords, localLoad) {
  if (entityType === 'vessel') {
    const { items, summary } = buildSyncPlan(hubRecords, localLoad);
    return {
      items: items.map((i) => ({
        localId: i.vesselId,
        label: i.vesselName,
        hubCode: i.hubCode,
        hubRecordId: i.hubRecordId,
        hubVersion: i.hubVersion,
        hubUpdatedAt: i.hubUpdatedAt,
        diffKind: i.diffKind,
        values: i.values,
        fieldDiff: i.fieldDiff,
      })),
      summary,
    };
  }
  if (entityType === 'incoterm') {
    const { items, summary } = buildIncotermSyncPlan(hubRecords, localLoad);
    return { items, summary };
  }
  if (entityType === 'commodity') {
    const { rows, metricIdByCode } = localLoad;
    return buildCommoditySyncPlan(hubRecords, rows, metricIdByCode);
  }
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function stagedItemsForInsert(entityType, items) {
  if (entityType === 'vessel') {
    return items.map((i) => ({
      vesselId: i.localId ?? i.vesselId,
      vesselName: i.label ?? i.vesselName,
      hubCode: i.hubCode,
      diffKind: i.diffKind,
      values: i.values,
      fieldDiff: i.fieldDiff,
      hubRecordId: i.hubRecordId,
      hubVersion: i.hubVersion,
      hubUpdatedAt: i.hubUpdatedAt,
    }));
  }
  const mapFn = entityType === 'incoterm' ? incotermToStaged : commodityToStaged;
  return items.map(mapFn);
}

/**
 * @param {DataHubEntityType} entityType
 */
export async function applyEntityItem(entityType, db, item, actorId, opts) {
  if (entityType === 'vessel') return applyVesselItem(db, item, actorId, opts);
  if (entityType === 'incoterm') return applyIncotermItem(db, item, actorId, opts);
  if (entityType === 'commodity') return applyCommodityItem(db, item, actorId, opts);
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entityPageKey(entityType) {
  if (entityType === 'vessel') return 'master-vessel';
  if (entityType === 'incoterm') return 'master-si-term';
  if (entityType === 'commodity') return 'master-si-commodity';
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entityActivityLabel(entityType) {
  if (entityType === 'vessel') return 'Vessel';
  if (entityType === 'incoterm') return 'Trade term';
  if (entityType === 'commodity') return 'Commodity';
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entitySyncErrorLabel(entityType) {
  if (entityType === 'vessel') return 'Failed to read the DataHub vessel master';
  if (entityType === 'incoterm') return 'Failed to read the DataHub incoterm master';
  if (entityType === 'commodity') return 'Failed to read the DataHub commodity master';
  return 'Failed to read DataHub master';
}
