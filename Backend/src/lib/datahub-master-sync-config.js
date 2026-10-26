/**
 * DataHub master sync entity registry (vessel, incoterm, commodity, port_master, organization).
 */
import {
  fetchAllCommoditySyncRecords,
  fetchAllOrganizationSyncRecords,
  fetchAllSyncRecords,
  fetchAllVessels,
  normalizeHubCommodity,
  normalizeHubIncoterm,
  normalizeHubPortMaster,
} from './datahub-client.js';
import { COMPARED_COLUMNS, buildSyncPlan } from './datahub-vessel-sync.js';
import { buildIncotermSyncPlan, toStagedItemRow as incotermToStaged } from './datahub-incoterm-sync.js';
import { buildCommoditySyncPlan, toStagedItemRow as commodityToStaged } from './datahub-commodity-sync.js';
import { buildPortSyncPlan, toStagedItemRow as portToStaged } from './datahub-port-sync.js';
import { applyVesselItem } from './datahub-vessel-apply.js';
import { applyIncotermItem } from './datahub-incoterm-apply.js';
import { applyCommodityItem } from './datahub-commodity-apply.js';
import { applyPortItem } from './datahub-port-apply.js';
import { buildOrganizationSyncPlan, toStagedItemRow as organizationToStaged } from './datahub-organization-sync.js';
import { applyOrganizationItem } from './datahub-organization-apply.js';

/** @typedef {'vessel'|'incoterm'|'commodity'|'port_master'|'organization'} DataHubEntityType */

export const DATAHUB_ENTITY_TYPES = new Set(['vessel', 'incoterm', 'commodity', 'port_master', 'organization']);

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
    return fetchAllCommoditySyncRecords(cfg);
  }
  if (entityType === 'port_master') {
    return fetchAllSyncRecords(cfg, 'port_master', normalizeHubPortMaster);
  }
  if (entityType === 'organization') {
    return fetchAllOrganizationSyncRecords(cfg);
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
      `SELECT id, hub_code, name, short_name, commodity_type, hub_type, kl_to_mt_factor, default_metric_id, hs_code, material_code
       FROM si_commodities WHERE deleted_at IS NULL`
    );
    return { rows: r.rows, metricIdByCode };
  }
  if (entityType === 'port_master') {
    const r = await db.query(
      `SELECT id, hub_code, name, unlocode, country, is_active, hub_site_id
       FROM ports WHERE deleted_at IS NULL`
    );
    return r.rows;
  }
  if (entityType === 'organization') {
    const r = await db.query(
      `SELECT id, hub_code, name, short_name, company_code_sap, country, is_active
       FROM master_companies WHERE deleted_at IS NULL`
    );
    return r.rows;
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
  if (entityType === 'port_master') {
    const { items, summary } = buildPortSyncPlan(hubRecords, localLoad);
    return { items, summary };
  }
  if (entityType === 'organization') {
    const { items, summary } = buildOrganizationSyncPlan(hubRecords, localLoad);
    return { items, summary };
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
  if (entityType === 'incoterm') return items.map(incotermToStaged);
  if (entityType === 'port_master') return items.map(portToStaged);
  if (entityType === 'organization') return items.map(organizationToStaged);
  return items.map(commodityToStaged);
}

/**
 * @param {DataHubEntityType} entityType
 */
export async function applyEntityItem(entityType, db, item, actorId, opts) {
  if (entityType === 'vessel') return applyVesselItem(db, item, actorId, opts);
  if (entityType === 'incoterm') return applyIncotermItem(db, item, actorId, opts);
  if (entityType === 'commodity') return applyCommodityItem(db, item, actorId, opts);
  if (entityType === 'port_master') return applyPortItem(db, item, actorId, opts);
  if (entityType === 'organization') return applyOrganizationItem(db, item, actorId, opts);
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entityPageKey(entityType) {
  if (entityType === 'vessel') return 'master-vessel';
  if (entityType === 'incoterm') return 'master-si-term';
  if (entityType === 'commodity') return 'master-si-commodity';
  if (entityType === 'port_master') return 'master-port';
  if (entityType === 'organization') return 'master-company';
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entityActivityLabel(entityType) {
  if (entityType === 'vessel') return 'Vessel';
  if (entityType === 'incoterm') return 'Trade term';
  if (entityType === 'commodity') return 'Commodity';
  if (entityType === 'port_master') return 'Port';
  if (entityType === 'organization') return 'Company';
  throw new Error(`Unknown entity type: ${entityType}`);
}

export function entitySyncErrorLabel(entityType) {
  if (entityType === 'vessel') return 'Failed to read the DataHub vessel master';
  if (entityType === 'incoterm') return 'Failed to read the DataHub incoterm master';
  if (entityType === 'commodity') return 'Failed to read the DataHub commodity master';
  if (entityType === 'port_master') return 'Failed to read the DataHub port master';
  if (entityType === 'organization') return 'Failed to read the DataHub company master';
  return 'Failed to read DataHub master';
}

/** Map DHM errors to a clearer message + suggested HTTP status for API responses. */
export function formatDataHubSyncFailure(entityType, err) {
  const status = Number(err?.status);
  const raw = err?.message || entitySyncErrorLabel(entityType);
  const slug =
    entityType === 'port_master'
      ? 'port_master'
      : entityType === 'incoterm'
        ? 'incoterm'
        : entityType === 'commodity'
          ? 'commodity'
          : entityType === 'organization'
            ? 'company or organization'
            : 'vessel';

  if (status === 403 || /not permitted to call/i.test(raw)) {
    return {
      httpStatus: 403,
      error: raw,
      hint: `DataHub has not allowlisted "${slug}" for this JPS application (public key). Ask the DHM integrator to enable ${slug} read/sync (and inbound if you push) on the integration that matches Admin → DataHub keys, then retry.`,
    };
  }
  return { httpStatus: 502, error: raw, hint: null };
}
