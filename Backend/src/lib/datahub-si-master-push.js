/**
 * Push SI master rows (incoterm, commodity) to DataHub inbound API.
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
  const record = body?.record ?? null;
  const fromRecord = hubRecordToLinkage(record);
  if (fromRecord) return fromRecord;
  const code = str(body?.code);
  if (!code) return null;
  return { hubCode: code, hubRecordId: null, hubVersion: null, hubUpdatedAt: null };
}

async function applySiHubLinkage(table, rowId, linkage, actorId) {
  if (!linkage?.hubCode) return;
  await pool.query(
    `UPDATE ${table} SET
       hub_code = $1,
       hub_record_id = COALESCE($2, hub_record_id),
       hub_version = COALESCE($3, hub_version),
       hub_updated_at = COALESCE($4::timestamptz, hub_updated_at),
       updated_by = COALESCE($5, updated_by),
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL`,
    [
      linkage.hubCode,
      linkage.hubRecordId ?? null,
      linkage.hubVersion ?? null,
      linkage.hubUpdatedAt ?? null,
      actorId,
      rowId,
    ]
  );
}

export function localIncotermToHubPayload(row) {
  const name = str(row.code ?? row.value);
  if (!name) throw new Error('Incoterm short name (Term) is required to push to DataHub');
  const payload = { name };
  const desc = str(row.description);
  if (desc) payload.description = desc;
  const longName = str(row.long_name ?? row.longName);
  if (longName) payload.long_name = longName;
  const hubCode = str(row.hub_code ?? row.hubCode);
  if (hubCode) payload.code = hubCode;
  return { payload, hubCode };
}

export async function pushIncotermToDataHub(cfg, localRow, fetchImpl = fetch) {
  const { payload, hubCode } = localIncotermToHubPayload(localRow);
  if (hubCode) {
    const { httpStatus, body } = await putInboundEntity(cfg, 'incoterm', hubCode, payload, fetchImpl);
    return { ok: true, httpStatus, linkage: linkageFromInboundBody(body), message: body?.status ?? 'updated' };
  }
  const { httpStatus, body } = await postInboundEntity(cfg, 'incoterm', payload, fetchImpl);
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

export async function tryPushIncotermAfterSave(localRow, actorId = null, fetchImpl = fetch) {
  const cfg = await getEffectiveDataHubConfig(pool);
  if (!cfg.enabled || !cfg.baseUrl || !cfg.publicKey || !cfg.privateKey) {
    return { ok: false, skipped: true, reason: 'integration_disabled' };
  }
  try {
    const result = await pushIncotermToDataHub(cfg, localRow, fetchImpl);
    if (result.ok && result.linkage?.hubCode) {
      await applySiHubLinkage('si_trade_terms', Number(localRow.id), result.linkage, actorId);
    }
    if (result.ok) await updateDataHubSyncHealth(pool, { ok: true });
    else await updateDataHubSyncHealth(pool, { ok: false, error: result.message });
    return result.ok
      ? { ok: true, skipped: false, code: result.linkage?.hubCode, message: result.message }
      : { ok: false, skipped: false, error: result.message };
  } catch (e) {
    const error = e?.message || 'DataHub push failed';
    await updateDataHubSyncHealth(pool, { ok: false, error }).catch(() => {});
    return { ok: false, skipped: false, error };
  }
}

export async function tryPushCommodityAfterSave(localRow, actorId = null, fetchImpl = fetch) {
  const cfg = await getEffectiveDataHubConfig(pool);
  if (!cfg.enabled || !cfg.baseUrl || !cfg.publicKey || !cfg.privateKey) {
    return { ok: false, skipped: true, reason: 'integration_disabled' };
  }
  try {
    const metricCode = str(localRow.default_metric_code ?? localRow.defaultMetricCode);
    const payload = { name: str(localRow.name ?? localRow.value) };
    if (!payload.name) throw new Error('Commodity name is required');
    if (localRow.hs_code ?? localRow.hsCode) payload.hs_code = str(localRow.hs_code ?? localRow.hsCode);
    const shortName = str(localRow.short_name ?? localRow.shortName);
    if (shortName) payload.short_name = shortName.toUpperCase();
    const ct = localRow.commodity_type ?? localRow.commodityType;
    if (ct === 'Solid' || ct === 'Liquid') payload.type = ct;
    if (metricCode) payload.uom = metricCode.toUpperCase() === 'KL' ? 'KL' : 'MT';
    const hubCode = str(localRow.hub_code ?? localRow.hubCode);
    if (hubCode) payload.code = hubCode;

    let httpStatus;
    let body;
    if (hubCode) {
      ({ httpStatus, body } = await putInboundEntity(cfg, 'commodity', hubCode, payload, fetchImpl));
    } else {
      ({ httpStatus, body } = await postInboundEntity(cfg, 'commodity', payload, fetchImpl));
    }
    const linkage = linkageFromInboundBody(body);
    if ((httpStatus === 201 || httpStatus === 200 || httpStatus === 409) && linkage) {
      await applySiHubLinkage('si_commodities', Number(localRow.id), linkage, actorId);
      await updateDataHubSyncHealth(pool, { ok: true });
      return { ok: true, skipped: false, code: linkage.hubCode, message: body?.status ?? 'ok' };
    }
    const msg = body?.message || body?.error || `Unexpected HTTP ${httpStatus}`;
    await updateDataHubSyncHealth(pool, { ok: false, error: msg });
    return { ok: false, skipped: false, error: msg };
  } catch (e) {
    const error = e?.message || 'DataHub push failed';
    await updateDataHubSyncHealth(pool, { ok: false, error }).catch(() => {});
    return { ok: false, skipped: false, error };
  }
}
