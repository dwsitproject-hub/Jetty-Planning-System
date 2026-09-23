/**
 * Resolve master_vessels rows for shipment plan create/update (snapshot model).
 */

export const LINKED_VESSEL_FIELD_ERROR =
  'Linked plans use master vessel snapshot; send master_vessel_id to change vessel, not vessel_name/LOA/GT/draft';

const VESSEL_BODY_KEYS = ['vessel_name', 'vessel_loa_m', 'vessel_gross_tonnage', 'vessel_draft'];

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
  };
}

/** @param {import('pg').Pool | import('pg').PoolClient} client @param {number} id */
export async function loadActiveMasterVessel(client, id) {
  const r = await client.query(
    `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall
     FROM master_vessels WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return { error: 'Master vessel not found' };
  return r.rows[0];
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

  if (!hubCode && !vesselName) {
    push('vessel_hub_code', 'required when vessel_name is omitted');
    push('vessel_name', 'required when vessel_hub_code is omitted');
  }

  return { errors, hubCode, vesselName };
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
      `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall
       FROM master_vessels WHERE hub_code = $1 AND deleted_at IS NULL`,
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
    `SELECT id, hub_code, vessel_name, vessel_gross_tonnage, vessel_draft, vessel_length_overall
     FROM master_vessels WHERE LOWER(vessel_name) = LOWER($1) AND deleted_at IS NULL`,
    [name]
  );
  if (r.rows.length === 0) return { error: `No master vessel matches vessel_name "${name}"` };
  if (r.rows.length > 1) return { error: `Multiple master vessels match vessel_name "${name}"; send vessel_hub_code` };
  return r.rows[0];
}

/** @param {object | null | undefined} body */
export function linkedPlanRejectsDirectVesselFields(body) {
  const b = body && typeof body === 'object' ? body : {};
  for (const key of VESSEL_BODY_KEYS) {
    if (key in b) return LINKED_VESSEL_FIELD_ERROR;
  }
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
