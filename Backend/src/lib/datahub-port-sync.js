/**
 * Diff DataHub port_master records against ports.
 */
export const PORT_COMPARED_COLUMNS = ['name', 'unlocode', 'country', 'is_active', 'hub_site_id'];

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeForCompare(column, value) {
  if (column === 'is_active') {
    if (value === true || value === false) return value;
    return value == null ? null : Boolean(value);
  }
  if (value == null || value === '') return null;
  return String(value).trim();
}

export function diffPortFields(localRow, hubValues) {
  const diff = {};
  for (const column of PORT_COMPARED_COLUMNS) {
    const from = normalizeForCompare(column, localRow?.[column]);
    const to = normalizeForCompare(column, hubValues?.[column]);
    if (from !== to) diff[column] = { from, to };
  }
  return diff;
}

/**
 * @param {Array} hubRecords normalized port_master hub records
 * @param {Array} localRows from ports
 */
export function buildPortSyncPlan(hubRecords, localRows) {
  const byHubCode = new Map();
  const byName = new Map();
  for (const row of localRows ?? []) {
    if (row?.hub_code) byHubCode.set(String(row.hub_code), row);
    const nm = row?.name;
    if (nm) byName.set(nameKey(nm), row);
  }

  const items = [];
  let skippedDeleted = 0;

  for (const hub of hubRecords ?? []) {
    if (hub.isDeleted) {
      skippedDeleted += 1;
      continue;
    }
    const portName = hub.values?.name;
    if (!portName) continue;

    const local =
      (hub.hubCode ? byHubCode.get(String(hub.hubCode)) : null) ??
      byName.get(nameKey(portName)) ??
      null;

    if (!local) {
      items.push({
        localId: null,
        hubCode: hub.hubCode ?? null,
        hubRecordId: hub.hubRecordId ?? null,
        hubVersion: hub.hubVersion ?? null,
        hubUpdatedAt: hub.hubUpdatedAt ?? null,
        label: portName,
        diffKind: 'new',
        values: hub.values,
        fieldDiff: diffPortFields({}, hub.values),
      });
      continue;
    }

    const fieldDiff = diffPortFields(local, hub.values);
    const linkChanged = Boolean(hub.hubCode) && String(local.hub_code ?? '') !== String(hub.hubCode);
    const changed = Object.keys(fieldDiff).length > 0 || linkChanged;

    items.push({
      localId: local.id != null ? Number(local.id) : null,
      hubCode: hub.hubCode ?? local.hub_code ?? null,
      hubRecordId: hub.hubRecordId ?? null,
      hubVersion: hub.hubVersion ?? null,
      hubUpdatedAt: hub.hubUpdatedAt ?? null,
      label: portName,
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
