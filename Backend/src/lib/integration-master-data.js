/**
 * Partner integration API — SI master data helpers (terms, agents, surveyors, shippers).
 */

export function normalizeLongName(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const v = String(raw).trim();
  return v || null;
}

export function toTermResponse(row) {
  return {
    id: Number(row.id),
    code: row.code,
  };
}

export function toNamedResponse(row) {
  return {
    id: Number(row.id),
    name: row.name,
    long_name: row.long_name ?? null,
  };
}

export async function listTradeTerms(db) {
  const r = await db.query(
    `SELECT id, code FROM si_trade_terms WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY sort_order, code`
  );
  return r.rows.map((row) => toTermResponse({ id: row.id, code: row.code }));
}

export async function listNamedMaster(db, table) {
  const r = await db.query(
    `SELECT id, name, long_name FROM ${table} WHERE deleted_at IS NULL ORDER BY sort_order, name`
  );
  return r.rows.map(toNamedResponse);
}

export async function getNamedMasterById(db, table, id) {
  const r = await db.query(
    `SELECT id, name, long_name FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return r.rows[0] ? toNamedResponse(r.rows[0]) : null;
}

export async function resolveTradeTermByCode(db, code) {
  const cleaned = String(code ?? '').trim().toUpperCase();
  if (!cleaned) return null;
  const r = await db.query(
    `SELECT id, code FROM si_trade_terms WHERE UPPER(code) = $1 AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
    [cleaned]
  );
  return r.rows[0] ?? null;
}

export async function listValidTradeTermCodes(db) {
  const r = await db.query(
    `SELECT code FROM si_trade_terms WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY code`
  );
  return r.rows.map((row) => row.code);
}

async function resolveByName(db, table, name) {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) return null;
  const r = await db.query(
    `SELECT id, name, long_name FROM ${table} WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [cleaned]
  );
  return r.rows[0] ?? null;
}

export async function resolveSurveyorByName(db, name) {
  return resolveByName(db, 'si_surveyors', name);
}

export async function resolveShipperByName(db, name) {
  return resolveByName(db, 'si_shippers', name);
}

export async function resolveAgentByName(db, name) {
  return resolveByName(db, 'si_agents', name);
}

export async function listValidSurveyorNames(db) {
  const r = await db.query(
    `SELECT name FROM si_surveyors WHERE deleted_at IS NULL ORDER BY name`
  );
  return r.rows.map((row) => row.name);
}

/**
 * Upsert agent/shipper by name (case-insensitive). Returns { row, created }.
 */
export async function upsertNamedMaster(db, table, { name, longName = null }) {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) return { error: 'name is required' };

  const existing = await resolveByName(db, table, cleaned);
  if (existing) {
    if (longName !== undefined && longName !== null) {
      await db.query(
        `UPDATE ${table} SET long_name = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
        [longName, existing.id]
      );
      existing.long_name = longName;
    }
    return { row: toNamedResponse(existing), created: false };
  }

  const ins = await db.query(
    `INSERT INTO ${table} (name, sort_order, long_name) VALUES ($1, 0, $2)
     RETURNING id, name, long_name`,
    [cleaned, longName ?? null]
  );
  return { row: toNamedResponse(ins.rows[0]), created: true };
}

export async function updateNamedMaster(db, table, id, { name, longName }) {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) return { error: 'name is required' };

  const dup = await db.query(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
    [cleaned, id]
  );
  if (dup.rows.length > 0) {
    return { error: 'name already in use' };
  }

  const longVal = longName === undefined ? undefined : normalizeLongName(longName);
  const sets = ['name = $1', 'updated_at = NOW()'];
  const params = [cleaned];
  if (longVal !== undefined) {
    sets.push(`long_name = $${params.length + 1}`);
    params.push(longVal);
  }
  params.push(id);

  const r = await db.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING id, name, long_name`,
    params
  );
  if (r.rows.length === 0) return { error: 'not_found' };
  return { row: toNamedResponse(r.rows[0]) };
}

/** Cargo Operations operation window on latest op lateral `o` (KLIP Hose On / Hose Off). */
export const PARTNER_CARGO_OPS_WINDOW_SUBSELECT = `
         (SELECT MIN(oa.start_at)
          FROM operation_operational_activities oa
          WHERE oa.operation_id = o.op_id
            AND oa.deleted_at IS NULL
            AND oa.entry_type = 'activity'
            AND oa.milestone_key = 'cargo_operations'
            AND oa.start_at IS NOT NULL) AS op_cargo_ops_window_start_at,
         (SELECT MAX(oa.end_at)
          FROM operation_operational_activities oa
          WHERE oa.operation_id = o.op_id
            AND oa.deleted_at IS NULL
            AND oa.entry_type = 'activity'
            AND oa.milestone_key = 'cargo_operations'
            AND oa.end_at IS NOT NULL) AS op_cargo_ops_window_end_at`;

const PARTNER_CARGO_OPS_WINDOW_BY_OPERATION_SQL = `
  SELECT
    (SELECT MIN(oa.start_at)
     FROM operation_operational_activities oa
     WHERE oa.operation_id = $1
       AND oa.deleted_at IS NULL
       AND oa.entry_type = 'activity'
       AND oa.milestone_key = 'cargo_operations'
       AND oa.start_at IS NOT NULL) AS window_start_at,
    (SELECT MAX(oa.end_at)
     FROM operation_operational_activities oa
     WHERE oa.operation_id = $1
       AND oa.deleted_at IS NULL
       AND oa.entry_type = 'activity'
       AND oa.milestone_key = 'cargo_operations'
       AND oa.end_at IS NOT NULL) AS window_end_at`;

/** Partner Hose On/Off window for cargo_operations on an operation. */
export async function resolvePartnerCargoOpsWindow(db, operationId) {
  const r = await db.query(PARTNER_CARGO_OPS_WINDOW_BY_OPERATION_SQL, [operationId]);
  const row = r.rows[0] ?? {};
  return { startAt: row.window_start_at ?? null, endAt: row.window_end_at ?? null };
}

/** Maps internal plan/operation state to partner Pending/Approved/Rejected/Allocated/Sailed. */
export function deriveExternalStatus(row) {
  if (row.approval_status === 'Rejected') return 'Rejected';
  if (row.op_status === 'SAILED') return 'Sailed';
  const opStatus = row.op_status || null;
  if (opStatus && opStatus !== 'PENDING') return 'Allocated';
  if (row.approval_status === 'Approved') return 'Approved';
  return 'Pending';
}

export const PARTNER_SUBMISSION_LOOKUP_SQL = `
  SELECT s.id AS submission_id, s.external_reference, s.received_at, s.payload,
         si.id AS si_id,
         GREATEST(si.updated_at, sp.updated_at, COALESCE(o.op_updated_at, sp.updated_at)) AS last_updated_at,
         sp.approval_status, sp.rejection_reason, sp.plan_reference,
         sp.approved_at, sp.rejected_at,
         sp.vessel_name, sp.voyage_no, sp.eta, sp.port_id,
         p.hub_code AS port_hub_code,
         sp.ta AS sp_ta, sp.etb AS sp_etb, sp.tb AS sp_tb,
         sp.docking_start_time AS sp_docking_start_time,
         sp.estimated_completion_time AS sp_etc,
         sp.operations_completed_at AS sp_tc,
         sp.cast_off_at AS sp_cast_off_at, sp.sailed_at AS sp_sailed_at,
         spp.code AS purpose,
         o.status AS op_status,
         o.docking_start_time AS op_docking_start_time,
         o.ta AS op_ta, o.etb AS op_etb, o.tb AS op_tb,
         o.estimated_completion_time AS op_etc,
         o.operations_completed_at AS op_tc,
         o.cast_off_at AS op_cast_off_at, o.sailed_at AS op_sailed_at,
         o.op_updated_at,
${PARTNER_CARGO_OPS_WINDOW_SUBSELECT},
         j.name AS jetty_name,
         regexp_replace(COALESCE(j.name, ''), '^Jetty\\s+', '', 'i') AS jetty_short_name,
         si.partner_si_document_url,
         si.partner_contract_document_url,
         si.partner_bl_document_url
  FROM integration_submissions s
  JOIN shipping_instructions si ON si.id = s.shipping_instruction_id AND si.deleted_at IS NULL
  JOIN shipment_plans sp ON sp.id = s.shipment_plan_id AND sp.deleted_at IS NULL
  LEFT JOIN ports p ON p.id = sp.port_id AND p.deleted_at IS NULL
  LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT op.id AS op_id, op.status, op.docking_start_time, op.jetty_id, op.updated_at AS op_updated_at,
           op.ta, op.etb, op.tb, op.estimated_completion_time,
           op.operations_completed_at, op.cast_off_at, op.sailed_at
    FROM operations op
    WHERE op.shipping_instruction_id = si.id AND op.deleted_at IS NULL
    ORDER BY op.id DESC
    LIMIT 1
  ) o ON true
  LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id)
  WHERE s.api_key_id = $1`;

/** Load partner submission rows for webhook enqueue (by shipment plan id). */
export const PARTNER_SUBMISSION_BY_PLAN_SQL = `
  SELECT s.api_key_id, s.external_reference, s.received_at, s.payload,
         si.id AS si_id,
         GREATEST(si.updated_at, sp.updated_at, COALESCE(o.op_updated_at, sp.updated_at)) AS last_updated_at,
         sp.approval_status, sp.rejection_reason, sp.plan_reference,
         sp.approved_at, sp.rejected_at,
         sp.vessel_name, sp.voyage_no, sp.eta, sp.port_id,
         p.hub_code AS port_hub_code,
         sp.ta AS sp_ta, sp.etb AS sp_etb, sp.tb AS sp_tb,
         sp.docking_start_time AS sp_docking_start_time,
         sp.estimated_completion_time AS sp_etc,
         sp.operations_completed_at AS sp_tc,
         sp.cast_off_at AS sp_cast_off_at, sp.sailed_at AS sp_sailed_at,
         spp.code AS purpose,
         o.status AS op_status,
         o.docking_start_time AS op_docking_start_time,
         o.ta AS op_ta, o.etb AS op_etb, o.tb AS op_tb,
         o.estimated_completion_time AS op_etc,
         o.operations_completed_at AS op_tc,
         o.cast_off_at AS op_cast_off_at, o.sailed_at AS op_sailed_at,
         o.op_updated_at,
${PARTNER_CARGO_OPS_WINDOW_SUBSELECT},
         j.name AS jetty_name,
         regexp_replace(COALESCE(j.name, ''), '^Jetty\\s+', '', 'i') AS jetty_short_name,
         si.partner_si_document_url,
         si.partner_contract_document_url,
         si.partner_bl_document_url
  FROM integration_submissions s
  JOIN shipping_instructions si ON si.id = s.shipping_instruction_id AND si.deleted_at IS NULL
  JOIN shipment_plans sp ON sp.id = s.shipment_plan_id AND sp.deleted_at IS NULL
  LEFT JOIN ports p ON p.id = sp.port_id AND p.deleted_at IS NULL
  LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT op.id AS op_id, op.status, op.docking_start_time, op.jetty_id, op.updated_at AS op_updated_at,
           op.ta, op.etb, op.tb, op.estimated_completion_time,
           op.operations_completed_at, op.cast_off_at, op.sailed_at
    FROM operations op
    WHERE op.shipping_instruction_id = si.id AND op.deleted_at IS NULL
    ORDER BY op.id DESC
    LIMIT 1
  ) o ON true
  LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id)
  WHERE sp.id = $1 AND sp.deleted_at IS NULL`;

/** Load partner submission rows for webhook enqueue (by shipping instruction id). */
export const PARTNER_SUBMISSION_BY_SI_SQL = `
  SELECT s.api_key_id, s.external_reference, s.received_at, s.payload,
         si.id AS si_id,
         GREATEST(si.updated_at, sp.updated_at, COALESCE(o.op_updated_at, sp.updated_at)) AS last_updated_at,
         sp.approval_status, sp.rejection_reason, sp.plan_reference,
         sp.approved_at, sp.rejected_at,
         sp.vessel_name, sp.voyage_no, sp.eta, sp.port_id,
         p.hub_code AS port_hub_code,
         sp.ta AS sp_ta, sp.etb AS sp_etb, sp.tb AS sp_tb,
         sp.docking_start_time AS sp_docking_start_time,
         sp.estimated_completion_time AS sp_etc,
         sp.operations_completed_at AS sp_tc,
         sp.cast_off_at AS sp_cast_off_at, sp.sailed_at AS sp_sailed_at,
         spp.code AS purpose,
         o.status AS op_status,
         o.docking_start_time AS op_docking_start_time,
         o.ta AS op_ta, o.etb AS op_etb, o.tb AS op_tb,
         o.estimated_completion_time AS op_etc,
         o.operations_completed_at AS op_tc,
         o.cast_off_at AS op_cast_off_at, o.sailed_at AS op_sailed_at,
         o.op_updated_at,
${PARTNER_CARGO_OPS_WINDOW_SUBSELECT},
         j.name AS jetty_name,
         regexp_replace(COALESCE(j.name, ''), '^Jetty\\s+', '', 'i') AS jetty_short_name,
         si.partner_si_document_url,
         si.partner_contract_document_url,
         si.partner_bl_document_url
  FROM integration_submissions s
  JOIN shipping_instructions si ON si.id = s.shipping_instruction_id AND si.deleted_at IS NULL
  JOIN shipment_plans sp ON sp.id = s.shipment_plan_id AND sp.deleted_at IS NULL
  LEFT JOIN ports p ON p.id = sp.port_id AND p.deleted_at IS NULL
  LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT op.id AS op_id, op.status, op.docking_start_time, op.jetty_id, op.updated_at AS op_updated_at,
           op.ta, op.etb, op.tb, op.estimated_completion_time,
           op.operations_completed_at, op.cast_off_at, op.sailed_at
    FROM operations op
    WHERE op.shipping_instruction_id = si.id AND op.deleted_at IS NULL
    ORDER BY op.id DESC
    LIMIT 1
  ) o ON true
  LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id)
  WHERE si.id = $1 AND sp.deleted_at IS NULL`;

export async function findPartnerSubmission(db, apiKeyId, { siId, externalReference }) {
  if (siId != null) {
    const r = await db.query(`${PARTNER_SUBMISSION_LOOKUP_SQL} AND si.id = $2`, [apiKeyId, siId]);
    return r.rows[0] ?? null;
  }
  if (externalReference) {
    const r = await db.query(`${PARTNER_SUBMISSION_LOOKUP_SQL} AND s.external_reference = $2`, [
      apiKeyId,
      externalReference,
    ]);
    return r.rows[0] ?? null;
  }
  return null;
}

/**
 * Match a PATCH cargo line to an existing breakdown row by line_order or contract_no.
 */
export function matchBreakdownLineIndex(existingLines, patchLine) {
  if (!Array.isArray(existingLines) || existingLines.length === 0) return -1;
  if (patchLine.lineOrder != null && Number.isInteger(patchLine.lineOrder)) {
    const idx = existingLines.findIndex((r) => Number(r.line_order) === patchLine.lineOrder);
    if (idx >= 0) return idx;
  }
  if (patchLine.contractNo) {
    const idx = existingLines.findIndex(
      (r) => r.contract_no && String(r.contract_no).toLowerCase() === patchLine.contractNo.toLowerCase()
    );
    if (idx >= 0) return idx;
  }
  return -1;
}
