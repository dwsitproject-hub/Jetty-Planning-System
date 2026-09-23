/**
 * Push a local master_vessels row to DataHub (Pattern A inbound).
 *
 * Contract: Docs/Guide/DATAHUB_CLIENT_INTEGRATION.md §8–9.
 */
import {
  HUB_FIELD_TO_COLUMN,
  normalizeHubVessel,
  postInboundVessel,
  putInboundVessel,
} from './datahub-client.js';
import { applyHubLinkage, hubRecordToLinkage } from './datahub-vessel-linkage.js';
import { diffVesselFields } from './datahub-vessel-sync.js';
import { getEffectiveDataHubConfig, updateDataHubSyncHealth } from './datahub-config.js';

/** Local column -> hub field (inverse of HUB_FIELD_TO_COLUMN). */
export const COLUMN_TO_HUB_FIELD = Object.fromEntries(
  Object.entries(HUB_FIELD_TO_COLUMN).map(([hub, col]) => [col, hub])
);

const NUMERIC_COLUMNS = new Set([
  'vessel_capacity_mt',
  'vessel_gross_tonnage',
  'vessel_draft',
]);

function toCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function field(row, snake) {
  if (row == null) return null;
  const v = row[snake] ?? row[toCamel(snake)];
  return v === undefined ? null : v;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a DB/API vessel row to the canonical hub payload.
 * @param {object} row snake_case or camelCase local row
 * @param {{ includeCode?: boolean }} [options]
 */
export function localVesselToHubPayload(row, { includeCode = false } = {}) {
  const payload = {};
  const hubCode = str(field(row, 'hub_code'));
  if (includeCode && hubCode) payload.code = hubCode;

  for (const [column, hubKey] of Object.entries(COLUMN_TO_HUB_FIELD)) {
    const raw = field(row, column);
    if (column === 'vessel_name') {
      const name = str(raw);
      if (name) payload[hubKey] = name;
      continue;
    }
    if (column === 'heater') {
      if (raw != null) payload[hubKey] = Boolean(raw);
      continue;
    }
    if (NUMERIC_COLUMNS.has(column)) {
      const n = num(raw);
      if (n != null) payload[hubKey] = n;
      continue;
    }
    const s = str(raw);
    if (s != null) payload[hubKey] = s;
  }

  if (!payload.Vessel_Name) {
    throw new Error('Vessel_Name is required to push to DataHub');
  }
  return payload;
}

function linkageFromInboundBody(body) {
  const record = body?.record ?? null;
  const fromRecord = hubRecordToLinkage(record);
  if (fromRecord) return fromRecord;
  const code = str(body?.code);
  if (!code) return null;
  return { hubCode: code, hubRecordId: null, hubVersion: null, hubUpdatedAt: null };
}

function localRowForDiff(row) {
  const out = {};
  for (const col of Object.values(HUB_FIELD_TO_COLUMN)) {
    out[col] = field(row, col);
  }
  return out;
}

function hubValuesFromRecord(record) {
  const normalized = normalizeHubVessel(record);
  return normalized?.values ?? {};
}

/**
 * Push one vessel to DataHub. Does not write to the database.
 * @param {{ baseUrl: string, publicKey: string, privateKey: string }} cfg
 * @param {object} localRow DB row (snake_case)
 */
export async function pushVesselToDataHub(cfg, localRow, fetchImpl = fetch) {
  const hubCode = str(field(localRow, 'hub_code'));
  const payload = localVesselToHubPayload(localRow, { includeCode: Boolean(hubCode) });

  if (hubCode) {
    const { httpStatus, body } = await putInboundVessel(cfg, hubCode, payload, fetchImpl);
    const linkage = linkageFromInboundBody(body);
    return {
      ok: true,
      httpStatus,
      status: body?.status ?? (httpStatus === 200 ? 'updated' : 'unknown'),
      code: linkage?.hubCode ?? hubCode,
      inboundId: body?.inboundId ?? null,
      linkage,
      message: body?.status ?? 'updated',
    };
  }

  const { httpStatus, body } = await postInboundVessel(cfg, payload, fetchImpl);
  const linkage = linkageFromInboundBody(body);

  if (httpStatus === 409 && linkage) {
    const hubValues = hubValuesFromRecord(body?.record);
    const diff = diffVesselFields(localRowForDiff(localRow), hubValues);
    if (Object.keys(diff).length > 0) {
      const putPayload = localVesselToHubPayload(localRow, { includeCode: true });
      putPayload.code = linkage.hubCode;
      const putResult = await putInboundVessel(cfg, linkage.hubCode, putPayload, fetchImpl);
      const putLinkage = linkageFromInboundBody(putResult.body) ?? linkage;
      return {
        ok: true,
        httpStatus: putResult.httpStatus,
        status: putResult.body?.status ?? 'updated',
        code: putLinkage.hubCode,
        inboundId: putResult.body?.inboundId ?? body?.inboundId ?? null,
        linkage: putLinkage,
        message: 'duplicate_linked_then_updated',
        priorStatus: 'duplicate',
      };
    }
    return {
      ok: true,
      httpStatus,
      status: body?.status ?? 'duplicate',
      code: linkage.hubCode,
      inboundId: body?.inboundId ?? null,
      linkage,
      message: 'duplicate_linked',
    };
  }

  if (httpStatus === 201 || httpStatus === 200) {
    return {
      ok: true,
      httpStatus,
      status: body?.status ?? (httpStatus === 201 ? 'created' : 'updated'),
      code: linkage?.hubCode ?? str(body?.code),
      inboundId: body?.inboundId ?? null,
      linkage,
      message: body?.status ?? (httpStatus === 201 ? 'created' : 'updated'),
    };
  }

  return {
    ok: false,
    httpStatus,
    status: body?.status ?? 'failed',
    code: linkage?.hubCode ?? null,
    inboundId: body?.inboundId ?? null,
    linkage,
    message: body?.message || body?.error || `Unexpected HTTP ${httpStatus}`,
  };
}

/**
 * After a local save, push to DataHub when integration is enabled.
 * Local row is never rolled back on push failure.
 *
 * @param {import('pg').Pool} pool
 * @param {object} localRow DB row with id
 * @param {number|null} actorId
 */
export async function tryPushAfterSave(pool, localRow, actorId = null, fetchImpl = fetch) {
  const cfg = await getEffectiveDataHubConfig(pool);
  if (!cfg.enabled) {
    return { ok: false, skipped: true, reason: 'integration_disabled' };
  }
  if (!cfg.baseUrl || !cfg.publicKey || !cfg.privateKey) {
    return { ok: false, skipped: true, reason: 'integration_not_configured' };
  }

  try {
    const result = await pushVesselToDataHub(cfg, localRow, fetchImpl);
    if (result.ok && result.linkage?.hubCode) {
      await applyHubLinkage(pool, Number(localRow.id), result.linkage, actorId);
      await updateDataHubSyncHealth(pool, { ok: true });
      return {
        ok: true,
        skipped: false,
        status: result.status,
        code: result.linkage.hubCode,
        httpStatus: result.httpStatus,
        message: result.message,
        priorStatus: result.priorStatus ?? null,
      };
    }
    if (result.ok) {
      await updateDataHubSyncHealth(pool, { ok: true });
      return {
        ok: true,
        skipped: false,
        status: result.status,
        code: result.code,
        httpStatus: result.httpStatus,
        message: result.message,
      };
    }
    await updateDataHubSyncHealth(pool, { ok: false, error: result.message });
    return {
      ok: false,
      skipped: false,
      error: result.message,
      httpStatus: result.httpStatus,
      status: result.status,
    };
  } catch (e) {
    const error = e?.message || 'DataHub push failed';
    await updateDataHubSyncHealth(pool, { ok: false, error }).catch(() => {});
    return {
      ok: false,
      skipped: false,
      error,
      httpStatus: e?.status ?? null,
    };
  }
}
