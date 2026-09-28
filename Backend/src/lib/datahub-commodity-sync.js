/**
 * Diff DataHub commodity records against si_commodities.
 */
export const COMMODITY_COMPARED_COLUMNS = [
  'name',
  'short_name',
  'commodity_type',
  'kl_to_mt_factor',
  'default_metric_id',
  'hs_code',
];

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function shortNameKey(shortName) {
  return String(shortName || '').trim().toUpperCase();
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

export function commodityTypeFromUom(uom) {
  return String(uom ?? '').trim().toUpperCase() === 'KL' ? 'Liquid' : 'Solid';
}

/**
 * Expand hub values with JPS-only defaults for staging diff.
 * @param {object} hubValues from normalizeHubCommodity
 * @param {Record<string, number>} metricIdByCode KL, MT
 * @param {object|null} localRow existing row when linking
 */
export function expandCommodityValues(hubValues, metricIdByCode, localRow = null) {
  const uom = hubValues?.uom;
  const uomPresent = uom != null && String(uom).trim() !== '';
  const metricCode = uomPresent && String(uom).trim().toUpperCase() === 'KL' ? 'KL' : 'MT';
  const defaultMetricIdFromHub = uomPresent
    ? metricIdByCode[metricCode] ?? metricIdByCode.MT ?? null
    : null;

  const hubShort =
    hubValues?.short_name != null && String(hubValues.short_name).trim()
      ? String(hubValues.short_name).trim().toUpperCase()
      : null;
  const shortName = hubShort ?? deriveShortNameFromCommodityName(hubValues?.name);

  const hubType = hubValues?.commodity_type;
  const commodityType =
    hubType === 'Solid' || hubType === 'Liquid' ? hubType : commodityTypeFromUom(uom);

  const defaultMetricId =
    defaultMetricIdFromHub != null
      ? defaultMetricIdFromHub
      : localRow?.default_metric_id != null
        ? Number(localRow.default_metric_id)
        : null;

  return {
    name: hubValues?.name ?? null,
    short_name: shortName,
    commodity_type: commodityType,
    kl_to_mt_factor:
      localRow?.kl_to_mt_factor != null ? Number(localRow.kl_to_mt_factor) : null,
    default_metric_id: defaultMetricId,
    hs_code: hubValues?.hs_code ?? null,
  };
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
  const byShortName = new Map();
  const byName = new Map();
  for (const row of localRows ?? []) {
    if (row?.hub_code) byHubCode.set(String(row.hub_code), row);
    if (row?.short_name) byShortName.set(shortNameKey(row.short_name), row);
    if (row?.name) byName.set(nameKey(row.name), row);
  }

  const items = [];
  let skippedDeleted = 0;

  for (const hub of hubRecords ?? []) {
    if (hub.isDeleted) {
      skippedDeleted += 1;
      continue;
    }
    if (!hub.values?.name) continue;

    const preValues = expandCommodityValues(hub.values, metricIdByCode, null);
    const local =
      (hub.hubCode ? byHubCode.get(String(hub.hubCode)) : null) ??
      (preValues.short_name ? byShortName.get(preValues.short_name) : null) ??
      byName.get(nameKey(hub.values.name)) ??
      null;

    const values = expandCommodityValues(hub.values, metricIdByCode, local);

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
    const linkChanged = Boolean(hub.hubCode) && String(local.hub_code ?? '') !== String(hub.hubCode);
    const changed = Object.keys(fieldDiff).length > 0 || linkChanged;

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

  const summary = {
    hubRecordCount: (hubRecords ?? []).length,
    newCount: items.filter((i) => i.diffKind === 'new').length,
    changedCount: items.filter((i) => i.diffKind === 'changed').length,
    unchangedCount: items.filter((i) => i.diffKind === 'unchanged').length,
    skippedDeleted,
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
