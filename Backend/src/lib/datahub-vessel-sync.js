/**
 * Diff DataHub vessel records against the local master_vessels replica.
 *
 * Pure: no database, no network. The route stages whatever this returns and a
 * user approves rows before anything is written.
 */
import { HUB_FIELD_TO_COLUMN } from './datahub-client.js';

/** Local columns that a sync may change. */
export const COMPARED_COLUMNS = Object.values(HUB_FIELD_TO_COLUMN);

const NUMERIC_COLUMNS = new Set([
  'vessel_capacity_mt',
  'vessel_gross_tonnage',
  'vessel_draft',
]);

/**
 * Coerce both sides to a comparable shape. Postgres returns NUMERIC as a
 * string, so a raw !== would report every numeric field as changed.
 */
export function normalizeForCompare(column, value) {
  if (value == null || value === '') return null;
  if (NUMERIC_COLUMNS.has(column)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (column === 'heater') return Boolean(value);
  return String(value).trim();
}

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Per-field diff between a local row and the incoming hub values.
 * Returns an empty object when nothing changed.
 */
export function diffVesselFields(localRow, hubValues) {
  const diff = {};
  for (const column of COMPARED_COLUMNS) {
    const from = normalizeForCompare(column, localRow?.[column]);
    const to = normalizeForCompare(column, hubValues?.[column]);
    if (from !== to) diff[column] = { from, to };
  }
  return diff;
}

/**
 * Classify every hub record against the current replica.
 *
 * Matching is by hub_code first, then by case-insensitive vessel_name - the
 * hub's other unique key - so vessels created locally before they were linked
 * still reconcile instead of being staged as duplicates.
 *
 * @param {Array<{hubCode: string|null, hubRecordId: string|null, hubVersion: number|null, hubUpdatedAt: any, isDeleted?: boolean, values: Record<string, any>}>} hubVessels
 * @param {Array<Record<string, any>>} localRows rows from master_vessels
 */
export function buildSyncPlan(hubVessels, localRows) {
  const byHubCode = new Map();
  const byName = new Map();
  for (const row of localRows ?? []) {
    if (row?.hub_code) byHubCode.set(String(row.hub_code), row);
    if (row?.vessel_name) byName.set(nameKey(row.vessel_name), row);
  }

  const items = [];
  let skippedDeleted = 0;

  for (const hub of hubVessels ?? []) {
    if (!hub?.values?.vessel_name) continue;
    // Tombstones: we never delete local rows from a sync, so ignore them.
    if (hub.isDeleted) {
      skippedDeleted += 1;
      continue;
    }

    const local =
      (hub.hubCode ? byHubCode.get(String(hub.hubCode)) : null) ??
      byName.get(nameKey(hub.values.vessel_name)) ??
      null;

    if (!local) {
      items.push({
        vesselId: null,
        hubCode: hub.hubCode ?? null,
        hubRecordId: hub.hubRecordId ?? null,
        hubVersion: hub.hubVersion ?? null,
        hubUpdatedAt: hub.hubUpdatedAt ?? null,
        vesselName: hub.values.vessel_name,
        diffKind: 'new',
        values: hub.values,
        fieldDiff: diffVesselFields({}, hub.values),
      });
      continue;
    }

    const fieldDiff = diffVesselFields(local, hub.values);
    // A newly linked hub_code is a real change even when no field moved.
    const linkChanged = Boolean(hub.hubCode) && String(local.hub_code ?? '') !== String(hub.hubCode);
    const changed = Object.keys(fieldDiff).length > 0 || linkChanged;

    items.push({
      vesselId: local.id != null ? Number(local.id) : null,
      hubCode: hub.hubCode ?? local.hub_code ?? null,
      hubRecordId: hub.hubRecordId ?? null,
      hubVersion: hub.hubVersion ?? null,
      hubUpdatedAt: hub.hubUpdatedAt ?? null,
      vesselName: hub.values.vessel_name,
      diffKind: changed ? 'changed' : 'unchanged',
      values: hub.values,
      fieldDiff,
    });
  }

  const summary = {
    hubRecordCount: (hubVessels ?? []).length,
    newCount: items.filter((i) => i.diffKind === 'new').length,
    changedCount: items.filter((i) => i.diffKind === 'changed').length,
    unchangedCount: items.filter((i) => i.diffKind === 'unchanged').length,
    skippedDeleted,
  };

  return { items, summary };
}
