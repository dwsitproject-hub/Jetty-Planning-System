/**
 * Partner integration API — enriched status + schedule payload (GET + webhooks).
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md v5.2
 */
import { deriveExternalStatus } from './integration-master-data.js';

/** @param {Date | string | null | undefined} v */
export function timestampToIso(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** @param {...(Date | string | null | undefined)} vals */
function coalesceTs(...vals) {
  for (const v of vals) {
    const iso = timestampToIso(v);
    if (iso) return iso;
  }
  return null;
}

/** @param {Record<string, unknown>} row */
export function buildPartnerSchedule(row) {
  return {
    eta: coalesceTs(row.eta),
    ta: coalesceTs(row.sp_ta, row.op_ta),
    etb: coalesceTs(row.sp_etb, row.op_etb),
    tb: coalesceTs(row.sp_tb, row.sp_docking_start_time, row.op_tb, row.op_docking_start_time),
    etc: coalesceTs(row.sp_etc, row.op_etc),
    tc: coalesceTs(row.sp_tc, row.op_tc),
    cast_off_at: coalesceTs(row.sp_cast_off_at, row.op_cast_off_at),
    sailed_at: coalesceTs(row.sp_sailed_at, row.op_sailed_at),
  };
}

/** @param {Record<string, unknown>} row */
function buildPartnerApproval(row) {
  const internal =
    row.approval_status === 'Submitted'
      ? 'Submitted'
      : row.approval_status === 'Approved'
        ? 'Approved'
        : row.approval_status === 'Rejected'
          ? 'Rejected'
          : String(row.approval_status ?? '');
  return {
    status: internal || null,
    approved_at: timestampToIso(row.approved_at),
    rejected_at: timestampToIso(row.rejected_at),
    rejection_reason: row.rejection_reason ?? null,
  };
}

/** @param {Record<string, unknown>} row @param {string} status */
function buildPartnerAllocation(row, status) {
  if (status !== 'Allocated' && status !== 'Sailed') return null;
  const berthing = coalesceTs(
    row.op_docking_start_time,
    row.sp_docking_start_time,
    row.sp_tb,
    row.op_tb,
    row.sp_etb,
    row.op_etb
  );
  return {
    jetty_name: row.jetty_name ?? null,
    jetty_code: row.jetty_short_name ?? null,
    planned_berthing_time: berthing,
  };
}

/**
 * Full partner-visible instruction snapshot (GET + webhook `data`).
 * @param {Record<string, unknown>} row from PARTNER_SUBMISSION_LOOKUP_SQL
 */
export function buildPartnerInstructionPayload(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const status = deriveExternalStatus(row);
  const schedule = buildPartnerSchedule(row);
  let etrMinutes = null;
  if (schedule.etc && status !== 'Sailed') {
    const etcMs = new Date(schedule.etc).getTime();
    const diff = Math.ceil((etcMs - Date.now()) / 60_000);
    if (Number.isFinite(diff)) etrMinutes = Math.max(0, diff);
  }

  return {
    id: Number(row.si_id),
    external_reference: row.external_reference,
    requested_by: payload.requested_by ?? null,
    status,
    plan_reference: row.plan_reference ?? null,
    vessel_name: row.vessel_name,
    vessel_hub_code: payload.vessel_hub_code ?? null,
    voyage_no: row.voyage_no ?? null,
    purpose: row.purpose ?? payload.purpose ?? null,
    eta: schedule.eta ?? (payload.eta ?? null),
    etd: payload.etd ?? null,
    port_id: Number(row.port_id),
    port_hub_code: row.port_hub_code ?? null,
    approval: buildPartnerApproval(row),
    schedule,
    etr_minutes: etrMinutes,
    allocation: buildPartnerAllocation(row, status),
    rejection_reason: status === 'Rejected' ? row.rejection_reason ?? null : null,
    shipping_instruction_document_url: row.partner_si_document_url ?? null,
    contract_document_url: row.partner_contract_document_url ?? null,
    bl_document_url: row.partner_bl_document_url ?? null,
    submitted_at: timestampToIso(row.received_at),
    last_updated_at: timestampToIso(row.last_updated_at),
  };
}
