import { DateTime } from 'luxon';
import { getJettyOperationCodeTimezone } from './jetty-operation-code.js';

/** Naive datetime-local style without trailing Z / numeric offset */
function isNaiveLocalDateTimeString(s) {
  const v = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(v)) return false;
  if (/[Zz]$/.test(v)) return false;
  if (/[+-]\d{2}:\d{2}$/.test(v)) return false;
  if (/[+-]\d{4}$/.test(v)) return false;
  return true;
}

function resolveZone(scheduleIana) {
  const z = typeof scheduleIana === 'string' && scheduleIana.trim() ? scheduleIana.trim() : getJettyOperationCodeTimezone();
  return z;
}

/**
 * Parse client timestamps for schedule fields: RFC3339 / ISO with zone, or naive `YYYY-MM-DDTHH:mm`
 * interpreted in `scheduleIana` (port wall time) **only when the string has no zone**.
 *
 * **Web SPA:** should send ISO with `Z` or numeric offset for schedule fields (see `normalizeForApi` in
 * the frontend); those values use `new Date(v)` here and ignore `scheduleIana`. Naive + port zone is
 * retained for legacy or non-browser clients that post raw `datetime-local` strings.
 *
 * @returns {string|null|undefined} ISO UTC string, null for empty, undefined for invalid (caller may treat as parse failure)
 */
export function parseScheduleInstantToIso(input, scheduleIana) {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isNaN(t) ? undefined : input.toISOString();
  }
  const v0 = String(input).trim();
  if (!v0) return null;
  const zone = resolveZone(scheduleIana);

  if (isNaiveLocalDateTimeString(v0)) {
    const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(v0);
    const base = hasSeconds ? v0.slice(0, 19) : v0.slice(0, 16);
    const fmt = hasSeconds ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd'T'HH:mm";
    const dt = DateTime.fromFormat(base, fmt, { zone });
    if (!dt.isValid) return undefined;
    return dt.toUTC().toISO();
  }

  const d = new Date(v0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Port schedule IANA for an operation (COALESCE(operation.port_id, jetty.port_id)). */
export async function loadOperationScheduleTimezone(dbClient, operationId) {
  const r = await dbClient.query(
    `SELECT COALESCE(NULLIF(trim(p.schedule_timezone), ''), 'Asia/Jakarta') AS tz
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  const tz = r.rows[0]?.tz;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : 'Asia/Jakarta';
}
