/**
 * Inbound partner integration API: submit shipping instructions + check status.
 * Auth: x-api-key (see middleware/integration-auth.js).
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.
 *
 * A submission creates real records: a shipment_plans row (approval_status 'Submitted')
 * plus a linked shipping_instructions row (status 'Submitted') and breakdown lines, so
 * operators review it through the existing Allocation Plan approve/reject flow.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { getPublicAppBaseUrl, triggerNotificationDeferred } from '../lib/notifications.js';
import {
  integrationRateLimit,
  requireIntegrationKey,
  sendIntegrationError,
  sendIntegrationSuccess,
} from '../middleware/integration-auth.js';
import { syncPlanVesselCapacityFromBreakdown } from '../lib/syncPlanVesselCapacity.js';

const router = express.Router();
const PAGE_KEY = 'shipment-plan';
const VALID_PURPOSES = ['Loading', 'Unloading'];
const VALID_UNITS = ['MT', 'KL'];

router.use(requireIntegrationKey);
router.use(integrationRateLimit);

/** Matches buildPlanReference in routes/shipment-plans.js (SP-YY-MM-#####). */
function buildPlanReference(planId) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `SP-${yy}-${mm}-${String(planId).padStart(5, '0')}`;
}

function asTrimmedString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Same normalization as si-lookups master data (short_name is stored uppercase). */
function normalizeCargoShortName(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return v || null;
}

function parseIsoDateTime(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC calendar date (YYYY-MM-DD) of a Date, for SI eta_from/eta_to columns. */
function toUtcDateString(d) {
  return d.toISOString().slice(0, 10);
}

/** Optional positive number; omit/null/empty → null; invalid → push error and return undefined. */
function parseOptionalPositive(field, raw, errors) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    errors.push({ field, issue: 'must be a positive number when provided' });
    return undefined;
  }
  return n;
}

function toVesselDimensions(row) {
  return {
    vessel_loa_m: row.vessel_loa_m != null ? Number(row.vessel_loa_m) : null,
    vessel_gross_tonnage: row.vessel_gross_tonnage != null ? Number(row.vessel_gross_tonnage) : null,
    vessel_draft: row.vessel_draft != null ? Number(row.vessel_draft) : null,
    vessel_capacity: row.vessel_capacity != null ? Number(row.vessel_capacity) : null,
    vessel_dwt: row.vessel_dwt != null ? Number(row.vessel_dwt) : null,
  };
}

/**
 * Validates the submission body per the partner guide.
 * Returns { errors: [{field, issue}], value: normalized payload }.
 */
function validateSubmission(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const push = (field, issue) => errors.push({ field, issue });

  const externalReference = asTrimmedString(b.external_reference);
  if (!externalReference) push('external_reference', 'required');
  else if (externalReference.length > 100) push('external_reference', 'max length 100');

  const portId = Number.parseInt(b.port_id, 10);
  if (!Number.isFinite(portId) || Number.isNaN(portId)) push('port_id', 'required integer');

  const vesselName = asTrimmedString(b.vessel_name);
  if (!vesselName) push('vessel_name', 'required');
  else if (vesselName.length > 200) push('vessel_name', 'max length 200');

  const voyageNo = asTrimmedString(b.voyage_no);
  if (voyageNo.length > 50) push('voyage_no', 'max length 50');

  const purpose = asTrimmedString(b.purpose);
  if (!VALID_PURPOSES.includes(purpose)) push('purpose', `must be one of: ${VALID_PURPOSES.join(', ')}`);

  const eta = parseIsoDateTime(b.eta);
  if (!eta) push('eta', b.eta == null || b.eta === '' ? 'required' : 'must be a valid ISO 8601 datetime');

  let etd = null;
  if (b.etd != null && b.etd !== '') {
    etd = parseIsoDateTime(b.etd);
    if (!etd) push('etd', 'must be a valid ISO 8601 datetime');
    else if (eta && etd.getTime() <= eta.getTime()) push('etd', 'must be after eta');
  }

  const agentName = asTrimmedString(b.agent_name);
  if (!agentName) push('agent_name', 'required');
  else if (agentName.length > 200) push('agent_name', 'max length 200');

  const agentContact = asTrimmedString(b.agent_contact);
  if (agentContact.length > 200) push('agent_contact', 'max length 200');

  const notes = asTrimmedString(b.notes);
  if (notes.length > 2000) push('notes', 'max length 2000');

  const requestedBy = asTrimmedString(b.requested_by);
  if (requestedBy.length > 200) push('requested_by', 'max length 200');

  const vesselLoaM = parseOptionalPositive('vessel_loa_m', b.vessel_loa_m, errors);
  const vesselGrossTonnage = parseOptionalPositive('vessel_gross_tonnage', b.vessel_gross_tonnage, errors);
  const vesselDraft = parseOptionalPositive('vessel_draft', b.vessel_draft, errors);

  const cargoRaw = Array.isArray(b.cargo) ? b.cargo : null;
  const cargo = [];
  if (!cargoRaw || cargoRaw.length === 0) {
    push('cargo', 'at least one cargo line is required');
  } else {
    cargoRaw.forEach((line, i) => {
      const l = line && typeof line === 'object' ? line : {};
      const cargoType = asTrimmedString(l.cargo_type);
      if (!cargoType) push(`cargo[${i}].cargo_type`, 'required');
      else if (cargoType.length > 100) push(`cargo[${i}].cargo_type`, 'max length 100');

      const description = asTrimmedString(l.description);
      if (description.length > 500) push(`cargo[${i}].description`, 'max length 500');

      const tonnage = Number(l.tonnage);
      if (l.tonnage == null || l.tonnage === '' || !Number.isFinite(tonnage) || tonnage < 0) {
        push(`cargo[${i}].tonnage`, 'required number >= 0');
      }

      const unit = asTrimmedString(l.unit).toUpperCase();
      if (!VALID_UNITS.includes(unit)) push(`cargo[${i}].unit`, `must be one of: ${VALID_UNITS.join(', ')}`);

      const contractNo = asTrimmedString(l.contract_no);
      if (contractNo.length > 100) push(`cargo[${i}].contract_no`, 'max length 100');

      cargo.push({
        cargoType,
        description: description || null,
        tonnage,
        unit,
        contractNo: contractNo || null,
      });
    });
  }

  return {
    errors,
    value: {
      externalReference,
      portId,
      vesselName,
      voyageNo: voyageNo || null,
      purpose,
      eta,
      etd,
      agentName,
      agentContact: agentContact || null,
      notes: notes || null,
      requestedBy: requestedBy || null,
      vesselLoaM: vesselLoaM ?? null,
      vesselGrossTonnage: vesselGrossTonnage ?? null,
      vesselDraft: vesselDraft ?? null,
      cargo,
    },
  };
}

const PATCH_ROOT_FIELDS = new Set([
  'port_id',
  'vessel_name',
  'voyage_no',
  'purpose',
  'eta',
  'etd',
  'agent_name',
  'agent_contact',
  'notes',
  'requested_by',
  'vessel_loa_m',
  'vessel_gross_tonnage',
  'vessel_draft',
  'cargo',
]);

function validatePatchBody(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  if (Object.prototype.hasOwnProperty.call(b, 'external_reference')) {
    errors.push({
      field: 'external_reference',
      issue: 'cannot be changed; submit a new instruction with a new external_reference instead',
    });
  }
  const hasUpdate = [...PATCH_ROOT_FIELDS].some((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (!hasUpdate) {
    errors.push({ field: '_body', issue: 'at least one updatable field is required' });
  }
  return errors;
}

async function loadCargoLines(siId) {
  const r = await pool.query(
    `SELECT c.short_name AS cargo_type, b.remarks AS description, b.qty AS tonnage,
            UPPER(m.code) AS unit, b.contract_no
     FROM public.shipping_instruction_breakdown b
     JOIN si_commodities c ON c.id = b.commodity_id AND c.deleted_at IS NULL
     JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
     WHERE b.shipping_instruction_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.line_order, b.id`,
    [siId]
  );
  return r.rows.map((row) => ({
    cargo_type: row.cargo_type,
    description: row.description ?? null,
    tonnage: Number(row.tonnage),
    unit: row.unit,
    contract_no: row.contract_no ?? null,
  }));
}

async function buildMergedSubmissionBody(row, siId, patch) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const cargo = Object.prototype.hasOwnProperty.call(patch, 'cargo')
    ? patch.cargo
    : await loadCargoLines(siId);
  return {
    external_reference: row.external_reference,
    port_id: row.port_id,
    vessel_name: row.vessel_name,
    voyage_no: row.voyage_no ?? p.voyage_no ?? null,
    purpose: row.purpose ?? p.purpose ?? null,
    eta: row.eta ? new Date(row.eta).toISOString() : p.eta ?? null,
    etd: p.etd ?? null,
    agent_name: p.agent_name ?? null,
    agent_contact: p.agent_contact ?? null,
    notes: p.notes ?? null,
    requested_by: p.requested_by ?? null,
    vessel_loa_m: row.vessel_loa_m,
    vessel_gross_tonnage: row.vessel_gross_tonnage,
    vessel_draft: row.vessel_draft,
    cargo,
    ...patch,
    external_reference: row.external_reference,
  };
}

function buildPlanRemarkForPartner(key, value, agentId) {
  const effectiveRequestedBy = value.requestedBy || key.partnerName;
  const remarkParts = [`Submitted via integration API by ${key.partnerName}`];
  if (effectiveRequestedBy) remarkParts.push(`Requested by: ${effectiveRequestedBy}`);
  if (agentId == null) {
    remarkParts.push(`Agent: ${value.agentName}${value.agentContact ? ` (${value.agentContact})` : ''}`);
  } else if (value.agentContact) {
    remarkParts.push(`Agent contact: ${value.agentContact}`);
  }
  if (value.etd) remarkParts.push(`ETD (partner): ${value.etd.toISOString()}`);
  return { planRemark: remarkParts.join('. '), effectiveRequestedBy };
}

async function resolveSubmissionMasterData(value) {
  const portOk = await pool.query(`SELECT 1 FROM ports WHERE id = $1 AND deleted_at IS NULL`, [value.portId]);
  if (portOk.rows.length === 0) {
    return { ok: false, errors: [{ field: 'port_id', issue: 'unknown port' }] };
  }

  const pr = await pool.query(`SELECT id FROM si_purposes WHERE code = $1 AND deleted_at IS NULL`, [value.purpose]);
  if (pr.rows.length === 0) {
    return {
      ok: false,
      errors: [{ field: 'purpose', issue: `purpose '${value.purpose}' is not configured in JPS master data` }],
    };
  }
  const purposeId = Number(pr.rows[0].id);

  const cargoTypes = [...new Set(value.cargo.map((c) => normalizeCargoShortName(c.cargoType)).filter(Boolean))];
  const cm = await pool.query(
    `SELECT id, short_name, commodity_type FROM si_commodities WHERE UPPER(short_name) = ANY($1) AND deleted_at IS NULL`,
    [cargoTypes]
  );
  const commodityByShortName = new Map(cm.rows.map((r) => [r.short_name.toUpperCase(), r]));
  const unknownTypes = [
    ...new Set(
      value.cargo.map((c) => c.cargoType).filter((t) => !commodityByShortName.has(normalizeCargoShortName(t)))
    ),
  ];
  if (unknownTypes.length > 0) {
    const valid = await pool.query(
      `SELECT short_name FROM si_commodities WHERE deleted_at IS NULL ORDER BY short_name`
    );
    return {
      ok: false,
      errors: [
        {
          field: 'cargo[].cargo_type',
          issue: `unknown cargo type(s): ${unknownTypes.join(', ')}`,
          valid_cargo_types: valid.rows.map((r) => r.short_name),
        },
      ],
    };
  }
  const commodityTypes = [
    ...new Set(
      value.cargo.map((c) => commodityByShortName.get(normalizeCargoShortName(c.cargoType)).commodity_type)
    ),
  ];
  if (commodityTypes.length > 1) {
    return {
      ok: false,
      errors: [{ field: 'cargo', issue: 'all cargo lines must be the same commodity type (Solid or Liquid)' }],
    };
  }

  const units = [...new Set(value.cargo.map((c) => c.unit))];
  const mr = await pool.query(
    `SELECT id, code FROM metric WHERE UPPER(code) = ANY($1) AND deleted_at IS NULL`,
    [units]
  );
  const metricByCode = new Map(mr.rows.map((r) => [String(r.code).toUpperCase(), Number(r.id)]));
  const missingUnits = units.filter((u) => !metricByCode.has(u));
  if (missingUnits.length > 0) {
    return {
      ok: false,
      errors: [{ field: 'cargo[].unit', issue: `unit(s) not configured in JPS master data: ${missingUnits.join(', ')}` }],
    };
  }

  let agentId = null;
  const ar = await pool.query(
    `SELECT id FROM si_agents WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [value.agentName]
  );
  if (ar.rows.length > 0) agentId = Number(ar.rows[0].id);

  return { ok: true, purposeId, commodityByShortName, metricByCode, agentId };
}

async function applyPartnerInstructionUpdate(req, res, row) {
  const key = req.integrationKey;
  const status = deriveExternalStatus(row);
  if (status !== 'Pending') {
    return sendIntegrationError(
      res,
      409,
      'NOT_EDITABLE',
      `Instruction cannot be updated when status is '${status}' — only Pending instructions can be amended`,
      { status, hint: 'Submit a new instruction with a new external_reference if rejected or already processed' }
    );
  }

  const patchErrors = validatePatchBody(req.body);
  if (patchErrors.length > 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', patchErrors);
  }

  const siId = Number(row.si_id);
  const planId = Number(row.plan_id);
  const mergedBody = await buildMergedSubmissionBody(row, siId, req.body);
  const { errors, value } = validateSubmission(mergedBody);
  if (errors.length > 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', errors);
  }

  const master = await resolveSubmissionMasterData(value);
  if (!master.ok) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', master.errors);
  }
  const { purposeId, commodityByShortName, metricByCode, agentId } = master;
  const { planRemark, effectiveRequestedBy } = buildPlanRemarkForPartner(key, value, agentId);
  const etaFrom = toUtcDateString(value.eta);
  const etaTo = toUtcDateString(value.etd ?? value.eta);
  const mergedPayload = { ...mergedBody, requested_by: effectiveRequestedBy };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT sp.id, sp.approval_status, sp.plan_reference
       FROM shipment_plans sp
       JOIN integration_submissions s ON s.shipment_plan_id = sp.id
       WHERE sp.id = $1 AND s.id = $2 AND s.api_key_id = $3 AND sp.deleted_at IS NULL
       FOR UPDATE`,
      [planId, row.submission_id, key.id]
    );
    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendIntegrationError(res, 404, 'NOT_FOUND', 'Shipping instruction not found');
    }
    if (deriveExternalStatus({ ...row, approval_status: lock.rows[0].approval_status }) !== 'Pending') {
      await client.query('ROLLBACK');
      return sendIntegrationError(
        res,
        409,
        'NOT_EDITABLE',
        'Instruction is no longer Pending and cannot be updated',
        { status: deriveExternalStatus({ ...row, approval_status: lock.rows[0].approval_status }) }
      );
    }

    const planRef = lock.rows[0].plan_reference;
    await client.query(
      `UPDATE shipment_plans SET
         port_id = $1, vessel_name = $2, vessel_loa_m = $3, vessel_gross_tonnage = $4, vessel_draft = $5,
         eta = $6, purpose_id = $7, voyage_no = $8, agent_id = $9, remark = $10,
         requested_by = $11, updated_at = NOW()
       WHERE id = $12`,
      [
        value.portId,
        value.vesselName,
        value.vesselLoaM,
        value.vesselGrossTonnage,
        value.vesselDraft,
        value.eta,
        purposeId,
        value.voyageNo,
        agentId,
        planRemark,
        effectiveRequestedBy,
        planId,
      ]
    );

    await client.query(
      `UPDATE shipping_instructions SET
         eta_from = $1, eta_to = $2, agent_id = $3, note = $4, updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL`,
      [etaFrom, etaTo, agentId, value.notes, siId]
    );

    await client.query(
      `UPDATE public.shipping_instruction_breakdown
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE shipping_instruction_id = $1 AND deleted_at IS NULL`,
      [siId]
    );

    let lineOrder = 0;
    for (const line of value.cargo) {
      const commodity = commodityByShortName.get(normalizeCargoShortName(line.cargoType));
      await client.query(
        `INSERT INTO public.shipping_instruction_breakdown (
           shipping_instruction_id, commodity_id, metric_id, qty, contract_no, remarks, line_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          siId,
          Number(commodity.id),
          metricByCode.get(line.unit),
          line.tonnage,
          line.contractNo,
          line.description,
          lineOrder++,
        ]
      );
    }

    await syncPlanVesselCapacityFromBreakdown(client, planId);
    await client.query(
      `UPDATE integration_submissions SET payload = $1 WHERE id = $2`,
      [JSON.stringify(mergedPayload), row.submission_id]
    );
    await client.query('COMMIT');

    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'edit',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: planRef,
      summary: `Shipping instruction updated via integration API (${key.partnerName})`,
      changes: [{ field: 'External reference', from: null, to: row.external_reference }],
      meta: {
        source: 'integration-api',
        partner: key.partnerName,
        external_reference: row.external_reference,
      },
      actorUserId: null,
    }).catch(() => {});

    const updated = await pool.query(`${STATUS_LOOKUP_SQL} AND si.id = $2`, [key.id, siId]);
    return sendIntegrationSuccess(res, 200, toStatusResponse(updated.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[integrations] update failed:', e);
    return sendIntegrationError(res, 500, 'INTERNAL_ERROR', 'Unexpected error while updating the instruction');
  } finally {
    client.release();
  }
}

/** Maps internal plan/operation state to the external Pending/Approved/Rejected/Allocated status. */
function deriveExternalStatus(row) {
  if (row.approval_status === 'Rejected') return 'Rejected';
  const opStatus = row.op_status || null;
  if (opStatus && opStatus !== 'PENDING') return 'Allocated';
  if (row.approval_status === 'Approved') return 'Approved';
  return 'Pending';
}

const STATUS_LOOKUP_SQL = `
  SELECT s.id AS submission_id, s.external_reference, s.received_at, s.payload,
         sp.id AS plan_id,
         si.id AS si_id,
         GREATEST(si.updated_at, sp.updated_at) AS last_updated_at,
         sp.approval_status, sp.rejection_reason,
         sp.vessel_name, sp.voyage_no, sp.eta, sp.port_id,
         sp.vessel_loa_m, sp.vessel_gross_tonnage, sp.vessel_draft,
         sp.vessel_capacity, sp.vessel_dwt,
         spp.code AS purpose,
         o.status AS op_status, o.docking_start_time, j.name AS jetty_name
  FROM integration_submissions s
  JOIN shipping_instructions si ON si.id = s.shipping_instruction_id
  JOIN shipment_plans sp ON sp.id = s.shipment_plan_id
  LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT op.status, op.docking_start_time, op.jetty_id
    FROM operations op
    WHERE op.shipping_instruction_id = si.id AND op.deleted_at IS NULL
    ORDER BY op.id DESC
    LIMIT 1
  ) o ON true
  LEFT JOIN jetties j ON j.id = o.jetty_id
  WHERE s.api_key_id = $1`;

function toStatusResponse(row) {
  const status = deriveExternalStatus(row);
  const payload = row.payload || {};
  return {
    id: Number(row.si_id),
    external_reference: row.external_reference,
    requested_by: payload.requested_by ?? null,
    status,
    vessel_name: row.vessel_name,
    voyage_no: row.voyage_no ?? null,
    purpose: row.purpose ?? payload.purpose ?? null,
    eta: row.eta ? new Date(row.eta).toISOString() : payload.eta ?? null,
    etd: payload.etd ?? null,
    port_id: Number(row.port_id),
    ...toVesselDimensions(row),
    allocation:
      status === 'Allocated'
        ? {
            jetty_name: row.jetty_name ?? null,
            planned_berthing_time: row.docking_start_time
              ? new Date(row.docking_start_time).toISOString()
              : null,
          }
        : null,
    rejection_reason: status === 'Rejected' ? row.rejection_reason ?? null : null,
    submitted_at: new Date(row.received_at).toISOString(),
    last_updated_at: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null,
  };
}

router.get('/ports', async (req, res) => {
  const r = await pool.query(
    `SELECT id, name FROM ports WHERE deleted_at IS NULL ORDER BY name ASC`
  );
  return sendIntegrationSuccess(
    res,
    200,
    r.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
    }))
  );
});

router.get('/commodities', async (req, res) => {
  const r = await pool.query(
    `SELECT id, short_name, name, commodity_type
     FROM si_commodities WHERE deleted_at IS NULL
     ORDER BY sort_order, name`
  );
  return sendIntegrationSuccess(
    res,
    200,
    r.rows.map((row) => ({
      id: Number(row.id),
      short_name: row.short_name,
      name: row.name,
      commodity_type: row.commodity_type ?? 'Liquid',
    }))
  );
});

router.post('/shipping-instructions', async (req, res) => {
  const key = req.integrationKey;
  const { errors, value } = validateSubmission(req.body);
  if (errors.length > 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', errors);
  }

  const portOk = await pool.query(`SELECT 1 FROM ports WHERE id = $1 AND deleted_at IS NULL`, [value.portId]);
  if (portOk.rows.length === 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'port_id', issue: 'unknown port' },
    ]);
  }

  const dup = await pool.query(
    `${STATUS_LOOKUP_SQL} AND s.external_reference = $2`,
    [key.id, value.externalReference]
  );
  if (dup.rows.length > 0) {
    return sendIntegrationError(
      res,
      409,
      'DUPLICATE_REFERENCE',
      `An instruction with external_reference '${value.externalReference}' already exists`,
      { existing_id: Number(dup.rows[0].si_id), status: deriveExternalStatus(dup.rows[0]) }
    );
  }

  const pr = await pool.query(`SELECT id FROM si_purposes WHERE code = $1 AND deleted_at IS NULL`, [value.purpose]);
  if (pr.rows.length === 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'purpose', issue: `purpose '${value.purpose}' is not configured in JPS master data` },
    ]);
  }
  const purposeId = Number(pr.rows[0].id);

  // Resolve cargo_type -> si_commodities.short_name (case-insensitive; not full display name).
  const cargoTypes = [
    ...new Set(value.cargo.map((c) => normalizeCargoShortName(c.cargoType)).filter(Boolean)),
  ];
  const cm = await pool.query(
    `SELECT id, short_name, commodity_type FROM si_commodities WHERE UPPER(short_name) = ANY($1) AND deleted_at IS NULL`,
    [cargoTypes]
  );
  const commodityByShortName = new Map(cm.rows.map((r) => [r.short_name.toUpperCase(), r]));
  const unknownTypes = [
    ...new Set(
      value.cargo
        .map((c) => c.cargoType)
        .filter((t) => !commodityByShortName.has(normalizeCargoShortName(t)))
    ),
  ];
  if (unknownTypes.length > 0) {
    const valid = await pool.query(
      `SELECT short_name FROM si_commodities WHERE deleted_at IS NULL ORDER BY short_name`
    );
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      {
        field: 'cargo[].cargo_type',
        issue: `unknown cargo type(s): ${unknownTypes.join(', ')}`,
        valid_cargo_types: valid.rows.map((r) => r.short_name),
      },
    ]);
  }
  const commodityTypes = [
    ...new Set(
      value.cargo.map((c) => commodityByShortName.get(normalizeCargoShortName(c.cargoType)).commodity_type)
    ),
  ];
  if (commodityTypes.length > 1) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'cargo', issue: 'all cargo lines must be the same commodity type (Solid or Liquid)' },
    ]);
  }

  const units = [...new Set(value.cargo.map((c) => c.unit))];
  const mr = await pool.query(
    `SELECT id, code FROM metric WHERE UPPER(code) = ANY($1) AND deleted_at IS NULL`,
    [units]
  );
  const metricByCode = new Map(mr.rows.map((r) => [String(r.code).toUpperCase(), Number(r.id)]));
  const missingUnits = units.filter((u) => !metricByCode.has(u));
  if (missingUnits.length > 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'cargo[].unit', issue: `unit(s) not configured in JPS master data: ${missingUnits.join(', ')}` },
    ]);
  }

  // Agent: best-effort name match against master data; unmatched agents stay visible via plan remark.
  let agentId = null;
  const ar = await pool.query(
    `SELECT id FROM si_agents WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [value.agentName]
  );
  if (ar.rows.length > 0) agentId = Number(ar.rows[0].id);

  const effectiveRequestedBy = value.requestedBy || key.partnerName;
  const remarkParts = [`Submitted via integration API by ${key.partnerName}`];
  if (effectiveRequestedBy) remarkParts.push(`Requested by: ${effectiveRequestedBy}`);
  if (agentId == null) {
    remarkParts.push(`Agent: ${value.agentName}${value.agentContact ? ` (${value.agentContact})` : ''}`);
  } else if (value.agentContact) {
    remarkParts.push(`Agent contact: ${value.agentContact}`);
  }
  if (value.etd) remarkParts.push(`ETD (partner): ${value.etd.toISOString()}`);
  const planRemark = remarkParts.join('. ');

  const etaFrom = toUtcDateString(value.eta);
  const etaTo = toUtcDateString(value.etd ?? value.eta);

  const client = await pool.connect();
  let siId;
  let planId;
  let planRef;
  let receivedAt;
  let planVesselRow;
  try {
    await client.query('BEGIN');
    const planIns = await client.query(
      `INSERT INTO shipment_plans (
         port_id, vessel_name, vessel_loa_m, vessel_gross_tonnage, vessel_draft,
         eta, purpose_id, voyage_no, agent_id, remark,
         external_reference, requested_by,
         approval_status, submitted_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Submitted',NOW(),NOW(),NOW())
       RETURNING id`,
      [
        value.portId,
        value.vesselName,
        value.vesselLoaM,
        value.vesselGrossTonnage,
        value.vesselDraft,
        value.eta,
        purposeId,
        value.voyageNo,
        agentId,
        planRemark,
        value.externalReference,
        effectiveRequestedBy,
      ]
    );
    planId = Number(planIns.rows[0].id);
    planRef = buildPlanReference(planId);
    await client.query(`UPDATE shipment_plans SET plan_reference = $1 WHERE id = $2`, [planRef, planId]);

    const siIns = await client.query(
      `INSERT INTO shipping_instructions (
         reference_number, status, eta_from, eta_to, agent_id, note, shipment_plan_id
       ) VALUES ($1,'Submitted',$2,$3,$4,$5,$6)
       RETURNING id, created_at`,
      [value.externalReference, etaFrom, etaTo, agentId, value.notes, planId]
    );
    siId = Number(siIns.rows[0].id);

    let lineOrder = 0;
    for (const line of value.cargo) {
      const commodity = commodityByShortName.get(normalizeCargoShortName(line.cargoType));
      await client.query(
        `INSERT INTO public.shipping_instruction_breakdown (
           shipping_instruction_id, commodity_id, metric_id, qty, contract_no, remarks, line_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [siId, Number(commodity.id), metricByCode.get(line.unit), line.tonnage, line.contractNo, line.description, lineOrder++]
      );
    }

    await syncPlanVesselCapacityFromBreakdown(client, planId);
    const vesselRes = await client.query(
      `SELECT vessel_loa_m, vessel_gross_tonnage, vessel_draft, vessel_capacity, vessel_dwt
       FROM shipment_plans WHERE id = $1`,
      [planId]
    );
    planVesselRow = vesselRes.rows[0];

    const subIns = await client.query(
      `INSERT INTO integration_submissions (api_key_id, external_reference, shipping_instruction_id, shipment_plan_id, payload)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING received_at`,
      [key.id, value.externalReference, siId, planId, JSON.stringify(req.body)]
    );
    receivedAt = subIns.rows[0].received_at;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e?.code === '23505' && e?.constraint === 'uq_integration_submissions_key_ref') {
      client.release();
      return sendIntegrationError(
        res,
        409,
        'DUPLICATE_REFERENCE',
        `An instruction with external_reference '${value.externalReference}' already exists`,
        null
      );
    }
    client.release();
    console.error('[integrations] submission failed:', e);
    return sendIntegrationError(res, 500, 'INTERNAL_ERROR', 'Unexpected error while creating the instruction');
  }
  client.release();

  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'add',
    entityType: 'ShipmentPlan',
    entityId: String(planId),
    entityLabel: planRef,
    summary: `Shipping instruction submitted via integration API (${key.partnerName})`,
    changes: [
      { field: 'Vessel', from: null, to: value.vesselName },
      { field: 'External reference', from: null, to: value.externalReference },
      ...(effectiveRequestedBy ? [{ field: 'Requested by', from: null, to: effectiveRequestedBy }] : []),
      { field: 'Approval status', from: null, to: 'Submitted' },
    ],
    meta: {
      source: 'integration-api',
      partner: key.partnerName,
      external_reference: value.externalReference,
      requested_by: effectiveRequestedBy,
    },
    actorUserId: null,
  }).catch(() => {});

  const appBase = getPublicAppBaseUrl();
  triggerNotificationDeferred(pool, {
    eventKey: 'shipment_plan.submitted',
    correlationId: `shipment_plan.submitted:${planId}`,
    portId: value.portId,
    excludeUserId: null,
    payloadVars: {
      planReference: planRef,
      planId: String(planId),
      primaryHref: `${appBase}/shipment-plans/approval/${planId}`,
      actionUrl: `${appBase}/shipment-plans/approval/${planId}`,
    },
  });

  return sendIntegrationSuccess(res, 201, {
    id: siId,
    external_reference: value.externalReference,
    requested_by: effectiveRequestedBy,
    status: 'Pending',
    vessel_name: value.vesselName,
    port_id: value.portId,
    ...toVesselDimensions(planVesselRow ?? {}),
    received_at: new Date(receivedAt).toISOString(),
  });
});

/** Lookup by partner reference: GET /shipping-instructions?external_reference=... */
router.patch('/shipping-instructions', async (req, res) => {
  const extRef = asTrimmedString(req.query.external_reference);
  if (!extRef) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Query parameter external_reference is required', [
      { field: 'external_reference', issue: 'required' },
    ]);
  }
  const r = await pool.query(`${STATUS_LOOKUP_SQL} AND s.external_reference = $2`, [
    req.integrationKey.id,
    extRef,
  ]);
  if (r.rows.length === 0) {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipping instruction with external_reference '${extRef}' not found`);
  }
  return applyPartnerInstructionUpdate(req, res, r.rows[0]);
});

router.patch('/shipping-instructions/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const r = await pool.query(`${STATUS_LOOKUP_SQL} AND si.id = $2`, [req.integrationKey.id, id]);
  if (r.rows.length === 0) {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipping instruction ${id} not found`);
  }
  return applyPartnerInstructionUpdate(req, res, r.rows[0]);
});

router.get('/shipping-instructions', async (req, res) => {
  const extRef = asTrimmedString(req.query.external_reference);
  if (!extRef) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Query parameter external_reference is required', [
      { field: 'external_reference', issue: 'required' },
    ]);
  }
  const r = await pool.query(`${STATUS_LOOKUP_SQL} AND s.external_reference = $2`, [
    req.integrationKey.id,
    extRef,
  ]);
  if (r.rows.length === 0) {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipping instruction with external_reference '${extRef}' not found`);
  }
  return sendIntegrationSuccess(res, 200, toStatusResponse(r.rows[0]));
});

router.get('/shipping-instructions/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const r = await pool.query(`${STATUS_LOOKUP_SQL} AND si.id = $2`, [req.integrationKey.id, id]);
  if (r.rows.length === 0) {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipping instruction ${id} not found`);
  }
  return sendIntegrationSuccess(res, 200, toStatusResponse(r.rows[0]));
});

/** Router-level error handler so partners always get the documented envelope. */
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[integrations] unhandled error:', err);
  return sendIntegrationError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

export default router;
