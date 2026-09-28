/**
 * Diff DataHub incoterm records against si_trade_terms.
 */
export const INCOTERM_COMPARED_COLUMNS = ['code', 'long_name', 'description'];

function codeKey(code) {
  return String(code || '').trim().toUpperCase();
}

function normalizeForCompare(column, value) {
  if (value == null || value === '') return null;
  return String(value).trim();
}

export function diffIncotermFields(localRow, hubValues) {
  const diff = {};
  for (const column of INCOTERM_COMPARED_COLUMNS) {
    const from = normalizeForCompare(column, localRow?.[column]);
    const to = normalizeForCompare(column, hubValues?.[column]);
    if (from !== to) diff[column] = { from, to };
  }
  return diff;
}

/**
 * @param {Array} hubRecords normalized incoterm hub records
 * @param {Array} localRows from si_trade_terms
 */
export function buildIncotermSyncPlan(hubRecords, localRows) {
  const byHubCode = new Map();
  const byCode = new Map();
  for (const row of localRows ?? []) {
    if (row?.hub_code) byHubCode.set(String(row.hub_code), row);
    if (row?.code) byCode.set(codeKey(row.code), row);
  }

  const items = [];
  let skippedDeleted = 0;

  for (const hub of hubRecords ?? []) {
    if (hub.isDeleted) {
      skippedDeleted += 1;
      continue;
    }
    const termCode = hub.values?.code;
    if (!termCode) continue;

    const local =
      (hub.hubCode ? byHubCode.get(String(hub.hubCode)) : null) ??
      byCode.get(codeKey(termCode)) ??
      null;

    if (!local) {
      items.push({
        localId: null,
        hubCode: hub.hubCode ?? null,
        hubRecordId: hub.hubRecordId ?? null,
        hubVersion: hub.hubVersion ?? null,
        hubUpdatedAt: hub.hubUpdatedAt ?? null,
        label: termCode,
        diffKind: 'new',
        values: hub.values,
        fieldDiff: diffIncotermFields({}, hub.values),
      });
      continue;
    }

    const fieldDiff = diffIncotermFields(local, hub.values);
    const linkChanged = Boolean(hub.hubCode) && String(local.hub_code ?? '') !== String(hub.hubCode);
    const changed = Object.keys(fieldDiff).length > 0 || linkChanged;

    items.push({
      localId: local.id != null ? Number(local.id) : null,
      hubCode: hub.hubCode ?? local.hub_code ?? null,
      hubRecordId: hub.hubRecordId ?? null,
      hubVersion: hub.hubVersion ?? null,
      hubUpdatedAt: hub.hubUpdatedAt ?? null,
      label: termCode,
      diffKind: changed ? 'changed' : 'unchanged',
      values: hub.values,
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

/** Map staged item shape to legacy vessel_* names for shared staging table. */
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
