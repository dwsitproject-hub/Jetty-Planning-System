/**
 * Resolve master_vessels rows for shipment plan create/update (snapshot model).
 */

export const LINKED_VESSEL_FIELD_ERROR =
  'Linked plans take the vessel name from the master vessel; send master_vessel_id to change the vessel';

const PLAN_DIMENSION_KEYS = ['vessel_loa_m', 'vessel_gross_tonnage', 'vessel_draft'];

/** @param {unknown} raw @param {string} fieldName */
export function parsePositiveNumber(raw, fieldName) {
  if (raw == null || raw === '') return { error: `${fieldName} is required` };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: `${fieldName} must be a positive number` };
  return n;
}

/** @param {unknown} vesselLengthOverall */
export function parseLoaMFromMaster(vesselLengthOverall) {
  if (vesselLengthOverall == null || String(vesselLengthOverall).trim() === '') {
    return { error: 'Master vessel LOA is missing' };
  }
  const n = Number(String(vesselLengthOverall).trim());
  if (!Number.isFinite(n) || n <= 0) return { error: 'Master vessel LOA is invalid' };
  return n;
}

function optionalDimFromMaster(raw, parser) {
  if (raw == null || raw === '') return undefined;
  const parsed = parser(raw);
  if (parsed?.error) return undefined;
  return parsed;
}

/**
 * Master identity for linked plans; dims included only when present on master (no error if missing).
 * @param {{ id: unknown, vessel_name: string, vessel_gross_tonnage?: unknown, vessel_draft?: unknown, vessel_length_overall?: unknown, vessel_type?: unknown, type_lambung?: unknown }} row
 */
export function planPartialSnapshotFromMasterRow(row) {
  const snap = {
    master_vessel_id: Number(row.id),
    vessel_name: String(row.vessel_name).trim(),
    vessel_type: optionalSnapshotText(row.vessel_type),
    vessel_hull_type: optionalSnapshotText(row.type_lambung),
  };
  const loa = optionalDimFromMaster(row.vessel_length_overall, (v) => parseLoaMFromMaster(v));
  if (loa != null) snap.vessel_loa_m = loa;
  const gt = optionalDimFromMaster(row.vessel_gross_tonnage, (v) =>
    parsePositiveNumber(v, 'Master vessel gross tonnage')
  );
  if (gt != null) snap.vessel_gross_tonnage = gt;
  const draft = optionalDimFromMaster(row.vessel_draft, (v) =>
    parsePositiveNumber(v, 'Master vessel draft')
  );
  if (draft != null) snap.vessel_draft = draft;
  return snap;
}

/** @param {Record<string, number>} dims */
export function requireCompletePlanDimensions(dims) {
  for (const key of PLAN_DIMENSION_KEYS) {
    if (!(key in dims)) {
      return { error: `${key} is required` };
    }
  }
  return dims;
}

/**
 * Linked plan vessel: master identity + LOA/GT/draft from master and/or request body.
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {unknown} rawMasterId
 * @param {object | null | undefined} body
 */
export async function resolveLinkedPlanVesselSnapshot(client, rawMasterId, body) {
  const parsed = parseMasterVesselIdBody(rawMasterId);
  if (parsed?.error) return parsed;
  const row = await loadActiveMasterVessel(client, parsed);
  if (row?.error) return row;
  const partial = planPartialSnapshotFromMasterRow(row);
  const merged = planDimensionsFromBody(body, partial);
  if (merged?.error) return merged;
  const complete = requireCompletePlanDimensions(merged);
  if (complete?.error) return complete;
  return { ...partial, ...complete };
}

function isBlankMasterDim(raw) {
  return raw == null || String(raw).trim() === '';
}

/**
 * Partner plan snapshot. Blank LOA, GT, or draft is stored as null.
 * A present value that is not a positive number is an error.
 * In-app plans use planSnapshotFromMasterRow, which still requires all three.
 * @param {{ id: unknown, vessel_name: string, vessel_gross_tonnage?: unknown, vessel_draft?: unknown, vessel_length_overall?: unknown, vessel_type?: unknown, type_lambung?: unknown }} row
 */
export function planSnapshotFromMasterRowForPartner(row) {
  const loa = isBlankMasterDim(row.vessel_length_overall)
    ? null
    : parseLoaMFromMaster(row.vessel_length_overall);
  if (loa?.error) return { error: loa.error };
  const gt = isBlankMasterDim(row.vessel_gross_tonnage)
    ? null
    : parsePositiveNumber(row.vessel_gross_tonnage, 'Master vessel gross tonnage');
  if (gt?.error) return { error: gt.error };
  const draft = isBlankMasterDim(row.vessel_draft)
    ? null
    : parsePositiveNumber(row.vessel_draft, 'Master vessel draft');
  if (draft?.error) return { error: draft.error };

  const partial = planPartialSnapshotFromMasterRow(row);
  return {
    ...partial,
    vessel_loa_m: loa,
    vessel_gross_tonnage: gt,
    vessel_draft: draft,
  };
}

/** @param {{ id: unknown, vessel_name: string, vessel_gross_tonnage: unknown, vessel_draft: unknown, vessel_length_overall: unknown }} row */
export function planSnapshotFromMasterRow(row) {
  const loa = parseLoaMFromMaster(row.vessel_length_overall);
  if (loa?.error) return { error: loa.error };
  const gt = parsePositiveNumber(row.vessel_gross_tonnage, 'Master vessel gross tonnage');
  if (gt?.error) return { error: gt.error };
  const draft = parsePositiveNumber(row.vessel_draft, 'Master vessel draft');
  if (draft?.error) return { error: draft.error };
  return {
    master_vessel_id: Number(row.id),
    vessel_name: String(row.vessel_name).trim(),
    vessel_loa_m: loa,
    vessel_gross_tonnage: gt,
    vessel_draft: draft,
    vessel_type: optionalSnapshotText(row.vessel_type),
    vessel_hull_type: optionalSnapshotText(row.type_lambung),
  };
}

function optionalSnapshotText(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/** @param {{ is_active?: boolean } | null | undefined} row */
export function activeMasterVesselGate(row) {
  if (!row) return { error: 'Master vessel not found' };
  if (row.is_active === false) return { error: 'Master vessel is inactive' };
  return null;
}

/** @param {import('pg').Pool | import('pg').PoolClient} client @param {number} id */
export async function loadActiveMasterVessel(client, id) {
  const r = await client.query(
    `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall,
            vessel_type, type_lambung, is_active
     FROM master_vessels WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return { error: 'Master vessel not found' };
  const gate = activeMasterVesselGate(r.rows[0]);
  if (gate) return gate;
  return r.rows[0];
}

/**
 * Load an active master vessel and copy name, LOA, GT, and draft for a plan.
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {unknown} rawId
 */
export async function snapshotActiveMasterVessel(client, rawId) {
  const parsed = parseMasterVesselIdBody(rawId);
  if (parsed?.error) return parsed;
  const row = await loadActiveMasterVessel(client, parsed);
  if (row?.error) return row;
  return planSnapshotFromMasterRow(row);
}

/**
 * Linked plans change vessel only by re-picking master_vessel_id.
 * Legacy plans keep free-text vessel fields.
 * @param {{ linked: boolean, body: object | null | undefined, requireMasterVesselId?: boolean }} opts
 */
export function decideVesselMasterWrite({ linked, body, requireMasterVesselId = false }) {
  if (!linked) return { mode: 'legacy' };
  const reject = linkedPlanRejectsDirectVesselFields(body);
  if (reject) return { error: reject };
  const b = body && typeof body === 'object' ? body : {};
  if (!('master_vessel_id' in b)) {
    if (requireMasterVesselId) return { error: 'master_vessel_id is required' };
    return { mode: 'linked-unchanged' };
  }
  const parsed = parseMasterVesselIdBody(b.master_vessel_id);
  if (parsed?.error) return { error: parsed.error };
  return { mode: 'linked-repick', masterVesselId: parsed };
}

/**
 * Partner POST validation: vessel_hub_code alone is sufficient; vessel_name required only when omitted.
 * @returns {{ errors: Array<{field: string, issue: string}>, hubCode: string | null, vesselName: string | null }}
 */
export function validateIntegrationVesselInput(vesselHubCodeRaw, vesselNameRaw) {
  const errors = [];
  const push = (field, issue) => errors.push({ field, issue });

  const hubCode =
    vesselHubCodeRaw != null && String(vesselHubCodeRaw).trim() !== ''
      ? String(vesselHubCodeRaw).trim()
      : null;
  const vesselName =
    vesselNameRaw != null && String(vesselNameRaw).trim() !== '' ? String(vesselNameRaw).trim() : null;

  if (hubCode && hubCode.length > 50) push('vessel_hub_code', 'max length 50');
  if (vesselName && vesselName.length > 200) push('vessel_name', 'max length 200');

  if (!hubCode) {
    push('vessel_hub_code', 'required');
  }
  if (vesselName && !hubCode) {
    push('vessel_name', 'legacy vessel_name is not accepted; use vessel_hub_code');
  }

  return { errors, hubCode, vesselName: hubCode ? vesselName : null };
}

/** Map resolve/snapshot errors to the most helpful partner field name. */
export function integrationVesselErrorField(errorMessage, { hubCode } = {}) {
  const msg = String(errorMessage ?? '');
  if (msg.includes('vessel_hub_code')) return 'vessel_hub_code';
  if (msg.includes('vessel_name') && hubCode) return 'vessel_name';
  if (hubCode) return 'vessel_hub_code';
  return 'vessel_name';
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {{ hubCode?: string | null, vesselName?: string | null }} opts
 */
export async function resolveMasterVesselForIntegration(client, { hubCode, vesselName }) {
  const hub = hubCode != null && String(hubCode).trim() !== '' ? String(hubCode).trim() : null;
  if (hub) {
    const r = await client.query(
      `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall,
              vessel_type, type_lambung
       FROM master_vessels WHERE hub_code = $1 AND deleted_at IS NULL AND is_active = TRUE`,
      [hub]
    );
    if (r.rows.length === 0) return { error: `No master vessel found for vessel_hub_code "${hub}"` };
    const row = r.rows[0];
    const name = vesselName != null && String(vesselName).trim() !== '' ? String(vesselName).trim() : null;
    if (name && name.toLowerCase() !== String(row.vessel_name).trim().toLowerCase()) {
      return { error: 'vessel_name does not match the master vessel for vessel_hub_code' };
    }
    return row;
  }
  const name = vesselName != null && String(vesselName).trim() !== '' ? String(vesselName).trim() : null;
  if (!name) return { error: 'vessel_name is required when vessel_hub_code is omitted' };
  const r = await client.query(
    `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall,
            vessel_type, type_lambung
     FROM master_vessels WHERE LOWER(vessel_name) = LOWER($1) AND deleted_at IS NULL AND is_active = TRUE`,
    [name]
  );
  if (r.rows.length === 0) return { error: `No master vessel matches vessel_name "${name}"` };
  if (r.rows.length > 1) return { error: `Multiple master vessels match vessel_name "${name}"; send vessel_hub_code` };
  return r.rows[0];
}

/**
 * Plan LOA, GT, and draft. A value in the body replaces the master snapshot.
 * Omitted keys keep the snapshot when one is passed.
 * @param {object | null | undefined} body
 * @param {object | null | undefined} [snapshot]
 * @returns {Record<string, number> | { error: string }}
 */
export function planDimensionsFromBody(body, snapshot) {
  const b = body && typeof body === 'object' ? body : {};
  const base = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const out = {};
  for (const key of PLAN_DIMENSION_KEYS) {
    if (key in b) {
      if (b[key] == null || b[key] === '') return { error: `${key} cannot be empty` };
      const n = Number(b[key]);
      if (!Number.isFinite(n) || n <= 0) return { error: `${key} must be a positive number` };
      out[key] = n;
    } else if (base && base[key] != null) {
      out[key] = base[key];
    }
  }
  return out;
}

/** @param {object | null | undefined} body */
export function linkedPlanRejectsDirectVesselFields(body) {
  const b = body && typeof body === 'object' ? body : {};
  if ('vessel_name' in b) return LINKED_VESSEL_FIELD_ERROR;
  return null;
}

/** @param {import('pg').Pool | import('pg').PoolClient} client @param {number} masterVesselId */
export async function countActivePlansForMaster(client, masterVesselId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c FROM shipment_plans WHERE master_vessel_id = $1 AND deleted_at IS NULL`,
    [masterVesselId]
  );
  return r.rows[0]?.c ?? 0;
}

/** @param {unknown} raw */
export function parseMasterVesselIdBody(raw) {
  if (raw == null || raw === '') return { error: 'master_vessel_id is required' };
  const id = parseInt(String(raw), 10);
  if (!Number.isFinite(id) || id <= 0) return { error: 'Invalid master_vessel_id' };
  return id;
}
