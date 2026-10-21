/**
 * Diff DataHub commodity records against si_commodities.
 */
export const COMMODITY_COMPARED_COLUMNS = [
  'name',
  'hub_type',
  'kl_to_mt_factor',
  'default_metric_id',
  'hs_code',
  'material_code',
];

function normalizeHubCode(hubCode) {
  const s = String(hubCode ?? '').trim();
  return s || null;
}

function isLocalOnlyRow(row) {
  return !normalizeHubCode(row?.hub_code);
}

function normalizeForCompare(column, value) {
  if (value == null || value === '') return null;
  if (column === 'kl_to_mt_factor' || column === 'default_metric_id') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value).trim();
}

export function deriveShortNameFromCommodityName(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'X';
  if (words.length === 1) return words[0].slice(0, 10).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 10)
    .toUpperCase();
}

/** Map DHM / UI unit strings to JPS metric codes KL | MT. */
export function normalizeCommodityUomCode(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().toUpperCase();
  if (s === 'KL' || s.startsWith('KILO')) return 'KL';
  if (s === 'MT' || s === 'TON' || s === 'TONNE' || s.includes('METRIC')) return 'MT';
  return s.length <= 8 ? s : null;
}

export function extractHubCommodityUom(data) {
  if (!data || typeof data !== 'object') return null;
  const raw =
    data.uom ??
    data.UOM ??
    data.unit ??
    data.unit_of_measure ??
    data.unitOfMeasure ??
    data.default_uom;
  return normalizeCommodityUomCode(raw);
}

export function commodityTypeFromUom(uom) {
  return normalizeCommodityUomCode(uom) === 'KL' ? 'Liquid' : 'Solid';
}

/**
 * Expand hub values with JPS-only defaults for staging diff.
 * @param {object} hubValues from normalizeHubCommodity
 * @param {Record<string, number>} metricIdByCode KL, MT
 * @param {object|null} localRow existing row when linking
 */
export function expandCommodityValues(hubValues, metricIdByCode, localRow = null) {
  const uom = normalizeCommodityUomCode(hubValues?.uom);
  const uomPresent = uom != null;
  const metricCode = uomPresent && uom === 'KL' ? 'KL' : 'MT';
  const defaultMetricIdFromHub = uomPresent
    ? metricIdByCode[metricCode] ?? metricIdByCode.MT ?? null
    : null;

  const defaultMetricId =
    defaultMetricIdFromHub != null
      ? defaultMetricIdFromHub
      : localRow?.default_metric_id != null
        ? Number(localRow.default_metric_id)
        : null;

  return {
    name: hubValues?.name ?? null,
    hub_type: hubValues?.hub_type ?? null,
    kl_to_mt_factor:
      localRow?.kl_to_mt_factor != null ? Number(localRow.kl_to_mt_factor) : null,
    default_metric_id: defaultMetricId,
    hs_code: hubValues?.hs_code ?? null,
    material_code: hubValues?.material_code ?? null,
  };
}

function commodityNameKey(name) {
  const s = String(name ?? '').trim().toLowerCase();
  return s || null;
}

/**
 * Flag hub sync rows whose long name matches another local row or another row in this batch.
 * Does not block apply — warnings only (user may still approve duplicates).
 */
export function annotateCommodityNameConflicts(items, localRows) {
  const localsByName = new Map();
  for (const row of localRows ?? []) {
    const key = commodityNameKey(row?.name);
    if (!key) continue;
    const id = row.id != null ? Number(row.id) : null;
    if (id == null) continue;
    if (!localsByName.has(key)) localsByName.set(key, []);
    localsByName.get(key).push({
      id,
      hubCode: row.hub_code ?? null,
      name: String(row.name ?? '').trim(),
    });
  }

  const hubItems = (items ?? []).filter((i) => !i.localOnly);
  const batchByName = new Map();
  for (const item of hubItems) {
    const key = commodityNameKey(item.values?.name ?? item.label);
    if (!key) continue;
    if (!batchByName.has(key)) batchByName.set(key, []);
    batchByName.get(key).push(item);
  }

  let nameConflictCount = 0;
  for (const item of hubItems) {
    const key = commodityNameKey(item.values?.name ?? item.label);
    if (!key) continue;
    const selfId = item.localId != null ? Number(item.localId) : null;
    const selfHub = normalizeHubCode(item.hubCode);
    const matches = [];

    for (const local of localsByName.get(key) ?? []) {
      if (selfId != null && local.id === selfId) continue;
      matches.push({
        kind: 'local',
        id: local.id,
        hubCode: local.hubCode,
        name: local.name,
      });
    }

    for (const other of batchByName.get(key) ?? []) {
      if (other === item) continue;
      const otherHub = normalizeHubCode(other.hubCode);
      if (selfHub && otherHub && selfHub === otherHub) continue;
      matches.push({
        kind: 'batch',
        id: other.localId != null ? Number(other.localId) : null,
        hubCode: other.hubCode ?? null,
        name: String(other.values?.name ?? other.label ?? '').trim(),
      });
    }

    if (matches.length === 0) continue;
    nameConflictCount += 1;
    item.nameConflict = { matches };
  }

  return nameConflictCount;
}

export function diffCommodityFields(localRow, hubValues) {
  const diff = {};
  for (const column of COMMODITY_COMPARED_COLUMNS) {
    const from = normalizeForCompare(column, localRow?.[column]);
    const to = normalizeForCompare(column, hubValues?.[column]);
    if (from !== to) diff[column] = { from, to };
  }
  return diff;
}

/**
 * @param {Array} hubRecords
 * @param {Array} localRows
 * @param {Record<string, number>} metricIdByCode
 */
export function buildCommoditySyncPlan(hubRecords, localRows, metricIdByCode) {
  const byHubCode = new Map();
  for (const row of localRows ?? []) {
    const code = normalizeHubCode(row?.hub_code);
    if (code) byHubCode.set(code, row);
  }

  const items = [];
  const matchedLocalIds = new Set();
  let skippedDeleted = 0;

  for (const hub of hubRecords ?? []) {
    if (hub.isDeleted) {
      skippedDeleted += 1;
      continue;
    }
    if (!hub.values?.name) continue;

    const hubCode = normalizeHubCode(hub.hubCode);
    const local = hubCode ? byHubCode.get(hubCode) ?? null : null;
    const values = expandCommodityValues(hub.values, metricIdByCode, local);
    if (local?.id != null) matchedLocalIds.add(Number(local.id));

    if (!local) {
      items.push({
        localId: null,
        hubCode: hub.hubCode ?? null,
        hubRecordId: hub.hubRecordId ?? null,
        hubVersion: hub.hubVersion ?? null,
        hubUpdatedAt: hub.hubUpdatedAt ?? null,
        label: values.name,
        diffKind: 'new',
        values,
        fieldDiff: diffCommodityFields({}, values),
      });
      continue;
    }

    const fieldDiff = diffCommodityFields(local, values);
    const changed = Object.keys(fieldDiff).length > 0;

    items.push({
      localId: local.id != null ? Number(local.id) : null,
      hubCode: hub.hubCode ?? local.hub_code ?? null,
      hubRecordId: hub.hubRecordId ?? null,
      hubVersion: hub.hubVersion ?? null,
      hubUpdatedAt: hub.hubUpdatedAt ?? null,
      label: values.name,
      diffKind: changed ? 'changed' : 'unchanged',
      values,
      fieldDiff,
    });
  }

  for (const row of localRows ?? []) {
    if (!isLocalOnlyRow(row)) continue;
    const id = row.id != null ? Number(row.id) : null;
    if (id == null || matchedLocalIds.has(id)) continue;
    const label = String(row.name ?? row.short_name ?? '').trim() || `Commodity #${id}`;
    items.push({
      localId: id,
      hubCode: null,
      hubRecordId: null,
      hubVersion: null,
      hubUpdatedAt: null,
      label,
      diffKind: 'unchanged',
      values: {},
      fieldDiff: {},
      localOnly: true,
    });
  }

  const hubItems = items.filter((i) => !i.localOnly);
  const localUnchangedItems = items.filter((i) => i.localOnly);
  const nameConflictCount = annotateCommodityNameConflicts(items, localRows);

  const summary = {
    hubRecordCount: (hubRecords ?? []).length,
    newCount: hubItems.filter((i) => i.diffKind === 'new').length,
    changedCount: hubItems.filter((i) => i.diffKind === 'changed').length,
    unchangedCount: hubItems.filter((i) => i.diffKind === 'unchanged').length,
    localUnchangedCount: localUnchangedItems.length,
    skippedDeleted,
    nameConflictCount,
  };

  return { items, summary };
}

export function toStagedItemRow(item) {
  return {
    vesselId: item.localId,
    vesselName: item.label,
    hubCode: item.hubCode,
    diffKind: item.diffKind,
    values: item.values,
    fieldDiff: item.fieldDiff,
    hubRecordId: item.hubRecordId,
    hubVersion: item.hubVersion,
    hubUpdatedAt: item.hubUpdatedAt,
    localOnly: Boolean(item.localOnly),
    nameConflict: item.nameConflict ?? null,
  };
}

export function fromVesselShapedItem(item) {
  const payload = item.payload || {};
  return {
    localId: item.vessel_id != null ? Number(item.vessel_id) : null,
    label: item.vessel_name,
    hubCode: item.hub_code ?? payload.hubCode ?? null,
    values: payload.values ?? {},
    hubRecordId: payload.hubRecordId ?? null,
    hubVersion: payload.hubVersion ?? null,
    hubUpdatedAt: payload.hubUpdatedAt ?? null,
  };
}
