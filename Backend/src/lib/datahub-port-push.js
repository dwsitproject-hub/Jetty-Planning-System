/**
 * Push JPS port rows to DataHub port_master (inbound POST/PUT).
 * Not wired to Master – Port save in v1; used by scripts / one-off bulk push.
 */
import { postInboundEntity, putInboundEntity } from './datahub-client.js';
import { hubRecordToLinkage } from './datahub-vessel-linkage.js';
import { getEffectiveDataHubConfig, updateDataHubSyncHealth } from './datahub-config.js';
import { pool } from '../db.js';

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function linkageFromInboundBody(body) {
  const fromRecord = hubRecordToLinkage(body?.record ?? null);
  if (fromRecord) return fromRecord;
  const code = str(body?.code);
  if (!code) return null;
  return { hubCode: code, hubRecordId: null, hubVersion: null, hubUpdatedAt: null };
}

/**
 * @param {object} row local port or { name, unlocode, country, isActive, hubCode, hubSiteId }
 * @param {string} siteId DHM site code (SITE-NNNN) — required on create
 */
export function localPortToHubPayload(row, siteId) {
  const name = str(row.name);
  if (!name) throw new Error('Port name is required to push to DataHub');
  const site = str(siteId ?? row.hub_site_id ?? row.hubSiteId);
  if (!site) throw new Error('site_id is required for port_master inbound (DHM site code, e.g. SITE-0001)');
  const payload = {
    name,
    site_id: site,
    is_active: row.is_active !== false && row.isActive !== false,
  };
  const unlocode = str(row.unlocode);
  const country = str(row.country);
  if (unlocode) payload.unlocode = unlocode;
  if (country) payload.country = country;
  const hubCode = str(row.hub_code ?? row.hubCode);
  return { payload, hubCode };
}

export async function pushPortToDataHub(cfg, localRow, siteId, fetchImpl = fetch) {
  const { payload, hubCode } = localPortToHubPayload(localRow, siteId);
  if (hubCode) {
    const { httpStatus, body } = await putInboundEntity(cfg, 'port_master', hubCode, payload, fetchImpl);
    return { ok: httpStatus === 200 || httpStatus === 201, httpStatus, linkage: linkageFromInboundBody(body), message: body?.status ?? 'updated' };
  }
  const { httpStatus, body } = await postInboundEntity(cfg, 'port_master', payload, fetchImpl);
  const linkage = linkageFromInboundBody(body);
  if (httpStatus === 201 || httpStatus === 200) {
    return { ok: true, httpStatus, linkage, message: body?.status ?? 'created' };
  }
  if (httpStatus === 409 && linkage) {
    return { ok: true, httpStatus, linkage, message: 'duplicate_linked' };
  }
  return {
    ok: false,
    httpStatus,
    message: body?.message || body?.error || `Unexpected HTTP ${httpStatus}`,
  };
}

async function applyPortHubLinkage(portId, linkage, siteId, actorId = null) {
  if (!linkage?.hubCode) return;
  const site = str(siteId);
  await pool.query(
    `UPDATE ports SET
       hub_code = $1,
       hub_record_id = COALESCE($2, hub_record_id),
       hub_version = COALESCE($3, hub_version),
       hub_updated_at = COALESCE($4::timestamptz, hub_updated_at),
       hub_site_id = COALESCE(hub_site_id, $6),
       updated_by = COALESCE($5, updated_by),
       updated_at = NOW()
     WHERE id = $7 AND deleted_at IS NULL`,
    [
      linkage.hubCode,
      linkage.hubRecordId ?? null,
      linkage.hubVersion ?? null,
      linkage.hubUpdatedAt ?? null,
      actorId,
      site,
      portId,
    ]
  );
}

export async function tryPushPortAfterSave(localRow, siteId, actorId = null, fetchImpl = fetch) {
  const cfg = await getEffectiveDataHubConfig(pool);
  if (!cfg?.enabled) return { skipped: true, reason: 'datahub_disabled' };
  try {
    const result = await pushPortToDataHub(cfg, localRow, siteId, fetchImpl);
    if (result.ok && result.linkage && localRow?.id != null) {
      await applyPortHubLinkage(localRow.id, result.linkage, siteId, actorId);
    }
    await updateDataHubSyncHealth(pool, result.ok ? 'ok' : 'error', result.message ?? null);
    return result;
  } catch (e) {
    await updateDataHubSyncHealth(pool, 'error', e.message);
    throw e;
  }
}
