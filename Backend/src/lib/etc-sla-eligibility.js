/**
 * SLA notification eligibility queries (D-1 and breach).
 */

export const SLA_EVENT_D1 = 'operation.sla_etc_d1';
export const SLA_EVENT_BREACH = 'operation.sla_etc_breach';

const OP_FROM = `
  FROM operations o
  JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
  LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
  LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL`;

function etcExpr() {
  return `COALESCE(sp.estimated_completion_time, o.estimated_completion_time)`;
}

function alongsideExpr() {
  return `COALESCE(sp.tb, o.tb, sp.docking_start_time, o.docking_start_time)`;
}

function castOffExpr() {
  return `COALESCE(sp.cast_off_at, o.cast_off_at, sp.sailed_at, o.actual_completion_time)`;
}

function shiftingExpr() {
  return `COALESCE(o.shifting_out, sp.shifting_out, false)`;
}

function opsCompletedExpr() {
  return `COALESCE(sp.operations_completed_at, o.operations_completed_at)`;
}

/**
 * @param {boolean} includePostSignoff
 */
export function buildOperationalSignoffSql(includePostSignoff) {
  if (includePostSignoff) return '';
  return `
    AND o.status NOT IN ('SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED')
    AND ${opsCompletedExpr()} IS NULL`;
}

export function buildBaseEligibilitySql(includePostSignoff = false) {
  return `
    o.deleted_at IS NULL
    AND ${alongsideExpr()} IS NOT NULL
    AND ${etcExpr()} IS NOT NULL
    AND o.status NOT IN ('PENDING', 'ALLOCATED', 'SAILED')
    AND ${castOffExpr()} IS NULL
    AND ${shiftingExpr()} = false
    ${buildOperationalSignoffSql(includePostSignoff)}`;
}

/**
 * D-1: ETC calendar date in port TZ equals tomorrow in port TZ.
 * Always uses operational sign-off predicate (exclude post-signoff).
 */
export function buildD1CandidatesSql() {
  const etc = etcExpr();
  const base = buildBaseEligibilitySql(false);
  return `
    SELECT o.id AS operation_id,
           COALESCE(o.port_id, j.port_id, p.id) AS port_id,
           p.name AS port_name,
           COALESCE(p.schedule_timezone, 'Asia/Jakarta') AS schedule_timezone,
           COALESCE(NULLIF(TRIM(sp.vessel_name), ''), '—') AS vessel_name,
           COALESCE(NULLIF(TRIM(j.name), ''), '—') AS jetty_name,
           COALESCE(NULLIF(TRIM(o.jetty_operation_code), ''), '—') AS jetty_operation_code,
           COALESCE(NULLIF(TRIM(sp.plan_reference), ''), NULLIF(TRIM(si.reference_number), ''), '—') AS plan_reference,
           ${etc} AS etc_at,
           to_char((${etc}) AT TIME ZONE COALESCE(p.schedule_timezone, 'Asia/Jakarta'), 'YYYY-MM-DD') AS etc_date_port
    ${OP_FROM}
    WHERE ${base}
      AND (date_trunc('day', (${etc}) AT TIME ZONE COALESCE(p.schedule_timezone, 'Asia/Jakarta')) + interval '1 day')
        = date_trunc('day', NOW() AT TIME ZONE COALESCE(p.schedule_timezone, 'Asia/Jakarta')) + interval '1 day'`;
}

/**
 * Breach: now > ETC.
 * @param {boolean} includePostSignoff
 */
export function buildBreachCandidatesSql(includePostSignoff = false) {
  const etc = etcExpr();
  const base = buildBaseEligibilitySql(includePostSignoff);
  return `
    SELECT o.id AS operation_id,
           COALESCE(o.port_id, j.port_id, p.id) AS port_id,
           p.name AS port_name,
           COALESCE(p.schedule_timezone, 'Asia/Jakarta') AS schedule_timezone,
           COALESCE(NULLIF(TRIM(sp.vessel_name), ''), '—') AS vessel_name,
           COALESCE(NULLIF(TRIM(j.name), ''), '—') AS jetty_name,
           COALESCE(NULLIF(TRIM(o.jetty_operation_code), ''), '—') AS jetty_operation_code,
           COALESCE(NULLIF(TRIM(sp.plan_reference), ''), NULLIF(TRIM(si.reference_number), ''), '—') AS plan_reference,
           ${etc} AS etc_at,
           GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${etc})) / 3600.0)::float AS over_hours,
           to_char(NOW() AT TIME ZONE COALESCE(p.schedule_timezone, 'Asia/Jakarta'), 'YYYY-MM-DD') AS today_port_date
    ${OP_FROM}
    WHERE ${base}
      AND ${etc} < NOW()`;
}

/** @param {number} overHours */
export function formatOverdueDuration(overHours) {
  if (overHours == null || !Number.isFinite(overHours) || overHours < 0) return '—';
  const overMs = overHours * 3_600_000;
  if (overMs < 3_600_000) return `+${Math.max(1, Math.round(overHours * 60))}m`;
  if (overHours < 24) return `+${overHours < 10 ? overHours.toFixed(1) : Math.round(overHours)}h`;
  const days = Math.floor(overHours / 24);
  const remH = Math.round(overHours % 24);
  return remH > 0 ? `+${days}d ${remH}h` : `+${days}d`;
}

/** @param {Date | string} etcAt @param {string} tz */
export function formatEtcInPortTz(etcAt, tz) {
  if (!etcAt) return '—';
  const d = etcAt instanceof Date ? etcAt : new Date(etcAt);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('en-GB', {
      timeZone: tz || 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return d.toISOString();
  }
}
