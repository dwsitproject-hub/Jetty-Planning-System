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
import {
  deriveExternalStatus,
  findPartnerSubmission,
  listValidSurveyorNames,
  listValidTradeTermCodes,
  matchBreakdownLineIndex,
  PARTNER_SUBMISSION_LOOKUP_SQL,
  resolveShipperByName,
  resolveSurveyorByName,
  resolveTradeTermByCode,
} from '../lib/integration-master-data.js';
import {
  planSnapshotFromMasterRow,
  resolveMasterVesselForIntegration,
} from '../lib/resolve-master-vessel.js';
import { validateIntegrationCargoMetricRules } from '../lib/si-breakdown-metric.js';
import { getPublicAppBaseUrl, triggerNotificationDeferred } from '../lib/notifications.js';
import {
  integrationRateLimit,
  requireIntegrationKey,
  sendIntegrationError,
  sendIntegrationSuccess,
} from '../middleware/integration-auth.js';
import integrationMasterRoutes from './integration-master.js';

const router = express.Router();
const PAGE_KEY = 'shipment-plan';
const VALID_PURPOSES = ['Loading', 'Unloading'];
const VALID_UNITS = ['MT', 'KL'];

router.use(requireIntegrationKey);
router.use(integrationRateLimit);
router.use(integrationMasterRoutes);

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

  const hubCode = asTrimmedString(b.hub_code);
  if (hubCode.length > 50) push('hub_code', 'max length 50');

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

      const poNo = asTrimmedString(l.po_no);
      if (poNo.length > 100) push(`cargo[${i}].po_no`, 'max length 100');

      const soNo = asTrimmedString(l.so_no);
      if (soNo.length > 100) push(`cargo[${i}].so_no`, 'max length 100');

      const shipperName = asTrimmedString(l.shipper_name);
      if (shipperName.length > 200) push(`cargo[${i}].shipper_name`, 'max length 200');

      cargo.push({
        cargoType,
        description: description || null,
        tonnage,
        unit,
        contractNo: contractNo || null,
        poNo: poNo || null,
        soNo: soNo || null,
        shipperName: shipperName || null,
      });
    });
  }

  let tradeTerm = null;
  if (b.trade_term != null && b.trade_term !== '') {
    tradeTerm = asTrimmedString(b.trade_term).toUpperCase();
    if (!tradeTerm) push('trade_term', 'invalid');
    else if (tradeTerm.length > 50) push('trade_term', 'max length 50');
  }

  let surveyorName = null;
  if (b.surveyor_name != null && b.surveyor_name !== '') {
    surveyorName = asTrimmedString(b.surveyor_name);
    if (!surveyorName) push('surveyor_name', 'invalid');
    else if (surveyorName.length > 200) push('surveyor_name', 'max length 200');
  }

  return {
    errors,
    value: {
      externalReference,
      portId,
      hubCode: hubCode || null,
      vesselName,
      voyageNo: voyageNo || null,
      purpose,
      eta,
      etd,
      agentName,
      agentContact: agentContact || null,
      notes: notes || null,
      requestedBy: requestedBy || null,
      tradeTerm,
      surveyorName,
      cargo,
    },
  };
}

/** Validates PATCH body for Pending shipping instructions (PO/SO/shipper/header fields only). */
function validatePatchBody(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const push = (field, issue) => errors.push({ field, issue });

  let tradeTerm = undefined;
  if (b.trade_term != null && b.trade_term !== '') {
    tradeTerm = asTrimmedString(b.trade_term).toUpperCase();
    if (!tradeTerm) push('trade_term', 'invalid');
    else if (tradeTerm.length > 50) push('trade_term', 'max length 50');
  }

  let surveyorName = undefined;
  if (b.surveyor_name != null && b.surveyor_name !== '') {
    surveyorName = asTrimmedString(b.surveyor_name);
    if (!surveyorName) push('surveyor_name', 'invalid');
    else if (surveyorName.length > 200) push('surveyor_name', 'max length 200');
  }

  const cargo = [];
  if (b.cargo != null) {
    if (!Array.isArray(b.cargo) || b.cargo.length === 0) {
      push('cargo', 'must be a non-empty array when provided');
    } else {
      b.cargo.forEach((line, i) => {
        const l = line && typeof line === 'object' ? line : {};
        const lineOrderRaw = l.line_order;
        const lineOrder =
          lineOrderRaw != null && lineOrderRaw !== ''
            ? Number.parseInt(lineOrderRaw, 10)
            : null;
        const contractNo = asTrimmedString(l.contract_no);
        if ((lineOrder == null || Number.isNaN(lineOrder)) && !contractNo) {
          push(`cargo[${i}]`, 'line_order or contract_no required to identify the line');
        }
        if (lineOrder != null && (Number.isNaN(lineOrder) || lineOrder < 0)) {
          push(`cargo[${i}].line_order`, 'must be a non-negative integer');
        }

        let poNo = undefined;
        if (l.po_no != null) poNo = asTrimmedString(l.po_no) || null;
        let soNo = undefined;
        if (l.so_no != null) soNo = asTrimmedString(l.so_no) || null;
        let shipperName = undefined;
        if (l.shipper_name != null) shipperName = asTrimmedString(l.shipper_name) || null;

        if (poNo && poNo.length > 100) push(`cargo[${i}].po_no`, 'max length 100');
        if (soNo && soNo.length > 100) push(`cargo[${i}].so_no`, 'max length 100');
        if (shipperName && shipperName.length > 200) push(`cargo[${i}].shipper_name`, 'max length 200');

        cargo.push({ lineOrder, contractNo: contractNo || null, poNo, soNo, shipperName });
      });
    }
  }

  const hasHeader = tradeTerm !== undefined || surveyorName !== undefined;
  if (!hasHeader && cargo.length === 0) {
    push('body', 'at least one field to update is required');
  }

  return { errors, value: { tradeTerm, surveyorName, cargo } };
}

const STATUS_LOOKUP_SQL = PARTNER_SUBMISSION_LOOKUP_SQL;

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
    `SELECT c.id, c.short_name, c.commodity_type, c.default_metric_id, dm.code AS default_metric_code
     FROM si_commodities c
     LEFT JOIN metric dm ON dm.id = c.default_metric_id AND dm.deleted_at IS NULL
     WHERE UPPER(c.short_name) = ANY($1) AND c.deleted_at IS NULL`,
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

  const metricRuleIssues = validateIntegrationCargoMetricRules(
    value.cargo,
    commodityByShortName,
    normalizeCargoShortName
  );
  if (metricRuleIssues) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', metricRuleIssues);
  }

  let tradeTermId = null;
  if (value.tradeTerm) {
    const tt = await resolveTradeTermByCode(pool, value.tradeTerm);
    if (!tt) {
      const validTerms = await listValidTradeTermCodes(pool);
      return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
        {
          field: 'trade_term',
          issue: `unknown trade term: ${value.tradeTerm}`,
          valid_trade_terms: validTerms,
        },
      ]);
    }
    tradeTermId = Number(tt.id);
  }

  let surveyorId = null;
  if (value.surveyorName) {
    const sv = await resolveSurveyorByName(pool, value.surveyorName);
    if (!sv) {
      const validSurveyors = await listValidSurveyorNames(pool);
      return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
        {
          field: 'surveyor_name',
          issue: `unknown surveyor: ${value.surveyorName}`,
          valid_surveyors: validSurveyors,
        },
      ]);
    }
    surveyorId = Number(sv.id);
  }

  const shipperIdsByLine = [];
  for (let i = 0; i < value.cargo.length; i += 1) {
    const line = value.cargo[i];
    if (!line.shipperName) {
      shipperIdsByLine.push(null);
      continue;
    }
    const sh = await resolveShipperByName(pool, line.shipperName);
    if (!sh) {
      return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
        {
          field: `cargo[${i}].shipper_name`,
          issue: `unknown shipper: ${line.shipperName}. Create it first via POST /shippers`,
        },
      ]);
    }
    shipperIdsByLine.push(Number(sh.id));
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
  try {
    await client.query('BEGIN');

    const masterRow = await resolveMasterVesselForIntegration(client, {
      hubCode: value.hubCode,
      vesselName: value.vesselName,
    });
    if (masterRow?.error) {
      await client.query('ROLLBACK');
      return sendIntegrationError(res, 400, [{ field: 'vessel_name', issue: masterRow.error }]);
    }
    const vesselSnap = planSnapshotFromMasterRow(masterRow);
    if (vesselSnap?.error) {
      await client.query('ROLLBACK');
      return sendIntegrationError(res, 400, [{ field: 'vessel_name', issue: vesselSnap.error }]);
    }

    const planIns = await client.query(
      `INSERT INTO shipment_plans (
         port_id, master_vessel_id, vessel_name, vessel_loa_m, vessel_gross_tonnage, vessel_draft,
         eta, purpose_id, voyage_no, agent_id, remark,
         external_reference, requested_by,
         approval_status, submitted_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Submitted',NOW(),NOW(),NOW())
       RETURNING id`,
      [
        value.portId,
        vesselSnap.master_vessel_id,
        vesselSnap.vessel_name,
        vesselSnap.vessel_loa_m,
        vesselSnap.vessel_gross_tonnage,
        vesselSnap.vessel_draft,
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
         reference_number, status, eta_from, eta_to, agent_id, note, shipment_plan_id,
         trade_term_id, surveyor_id
       ) VALUES ($1,'Submitted',$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at`,
      [
        value.externalReference,
        etaFrom,
        etaTo,
        agentId,
        value.notes,
        planId,
        tradeTermId,
        surveyorId,
      ]
    );
    siId = Number(siIns.rows[0].id);

    let lineOrder = 0;
    for (const line of value.cargo) {
      const commodity = commodityByShortName.get(normalizeCargoShortName(line.cargoType));
      await client.query(
        `INSERT INTO public.shipping_instruction_breakdown (
           shipping_instruction_id, commodity_id, metric_id, qty, contract_no, po_no, so_no,
           shipper_id, remarks, line_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          siId,
          Number(commodity.id),
          metricByCode.get(line.unit),
          line.tonnage,
          line.contractNo,
          line.poNo,
          line.soNo,
          shipperIdsByLine[lineOrder],
          line.description,
          lineOrder++,
        ]
      );
    }

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
    received_at: new Date(receivedAt).toISOString(),
  });
});

async function applyPartnerPatch(req, res, { siId, externalReference }) {
  const key = req.integrationKey;
  const { errors, value } = validatePatchBody(req.body);
  if (errors.length > 0) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', errors);
  }

  const submission = await findPartnerSubmission(pool, key.id, { siId, externalReference });
  if (!submission) {
    const label = siId != null ? `Shipping instruction ${siId}` : `external_reference '${externalReference}'`;
    return sendIntegrationError(res, 404, 'NOT_FOUND', `${label} not found`);
  }

  const status = deriveExternalStatus(submission);
  if (status !== 'Pending') {
    return sendIntegrationError(
      res,
      409,
      'INVALID_STATE',
      `Instruction cannot be updated when status is '${status}'. Submit a new instruction with a new external_reference.`,
      { status }
    );
  }

  let tradeTermId = undefined;
  if (value.tradeTerm !== undefined) {
    const tt = await resolveTradeTermByCode(pool, value.tradeTerm);
    if (!tt) {
      const validTerms = await listValidTradeTermCodes(pool);
      return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
        {
          field: 'trade_term',
          issue: `unknown trade term: ${value.tradeTerm}`,
          valid_trade_terms: validTerms,
        },
      ]);
    }
    tradeTermId = Number(tt.id);
  }

  let surveyorId = undefined;
  if (value.surveyorName !== undefined) {
    const sv = await resolveSurveyorByName(pool, value.surveyorName);
    if (!sv) {
      const validSurveyors = await listValidSurveyorNames(pool);
      return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
        {
          field: 'surveyor_name',
          issue: `unknown surveyor: ${value.surveyorName}`,
          valid_surveyors: validSurveyors,
        },
      ]);
    }
    surveyorId = Number(sv.id);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (tradeTermId !== undefined || surveyorId !== undefined) {
      const siSets = ['updated_at = NOW()'];
      const siParams = [];
      if (tradeTermId !== undefined) {
        siSets.push(`trade_term_id = $${siParams.length + 1}`);
        siParams.push(tradeTermId);
      }
      if (surveyorId !== undefined) {
        siSets.push(`surveyor_id = $${siParams.length + 1}`);
        siParams.push(surveyorId);
      }
      siParams.push(Number(submission.si_id));
      await client.query(
        `UPDATE shipping_instructions SET ${siSets.join(', ')} WHERE id = $${siParams.length} AND deleted_at IS NULL`,
        siParams
      );
    }

    if (value.cargo.length > 0) {
      const br = await client.query(
        `SELECT id, line_order, contract_no, po_no, so_no, shipper_id
         FROM shipping_instruction_breakdown
         WHERE shipping_instruction_id = $1 AND deleted_at IS NULL
         ORDER BY line_order, id`,
        [Number(submission.si_id)]
      );

      for (let i = 0; i < value.cargo.length; i += 1) {
        const patchLine = value.cargo[i];
        const idx = matchBreakdownLineIndex(br.rows, patchLine);
        if (idx < 0) {
          await client.query('ROLLBACK');
          client.release();
          return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
            {
              field: `cargo[${i}]`,
              issue: 'no matching breakdown line (use line_order or contract_no)',
            },
          ]);
        }

        const row = br.rows[idx];
        let shipperId = undefined;
        if (patchLine.shipperName !== undefined) {
          if (patchLine.shipperName) {
            const sh = await resolveShipperByName(client, patchLine.shipperName);
            if (!sh) {
              await client.query('ROLLBACK');
              client.release();
              return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
                {
                  field: `cargo[${i}].shipper_name`,
                  issue: `unknown shipper: ${patchLine.shipperName}. Create it first via POST /shippers`,
                },
              ]);
            }
            shipperId = Number(sh.id);
          } else {
            shipperId = null;
          }
        }

        const sets = ['updated_at = NOW()'];
        const params = [];
        if (patchLine.poNo !== undefined) {
          sets.push(`po_no = $${params.length + 1}`);
          params.push(patchLine.poNo);
        }
        if (patchLine.soNo !== undefined) {
          sets.push(`so_no = $${params.length + 1}`);
          params.push(patchLine.soNo);
        }
        if (shipperId !== undefined) {
          sets.push(`shipper_id = $${params.length + 1}`);
          params.push(shipperId);
        }
        params.push(Number(row.id));
        await client.query(
          `UPDATE shipping_instruction_breakdown SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    console.error('[integrations] patch failed:', e);
    return sendIntegrationError(res, 500, 'INTERNAL_ERROR', 'Unexpected error while updating the instruction');
  }
  client.release();

  const refreshed = await findPartnerSubmission(pool, key.id, { siId: Number(submission.si_id) });
  return sendIntegrationSuccess(res, 200, toStatusResponse(refreshed));
}

/** PATCH by external_reference: /shipping-instructions?external_reference=... */
router.patch('/shipping-instructions', async (req, res) => {
  const extRef = asTrimmedString(req.query.external_reference);
  if (!extRef) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Query parameter external_reference is required', [
      { field: 'external_reference', issue: 'required' },
    ]);
  }
  return applyPartnerPatch(req, res, { externalReference: extRef });
});

router.patch('/shipping-instructions/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  return applyPartnerPatch(req, res, { siId: id });
});

/** Lookup by partner reference: GET /shipping-instructions?external_reference=... */
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
