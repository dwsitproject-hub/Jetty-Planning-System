/**
 * Which operations a field-menu queue (QC Sampling, Custom Clearance) lists: the berthed
 * vessels (`active`, editable) or vessels that sailed within a cast-off date range
 * (`sailed`, view-only). Pure helpers, no database access.
 */
export const SAILED_RANGE_DEFAULT_DAYS = 30;
export const SAILED_RANGE_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SAILED_READ_ONLY_MESSAGE = 'This vessel has sailed. Data is view-only here.';

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** `?scope=sailed` lists sailed vessels; anything else is the berthed queue. */
export function queueScopeOf(query = {}) {
  return String(query.scope || '').trim().toLowerCase() === 'sailed' ? 'sailed' : 'active';
}

export function isSailedStatus(status) {
  return String(status || '').trim().toUpperCase() === 'SAILED';
}

function parseInstant(raw, label) {
  if (raw == null || String(raw).trim() === '') return null;
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label}`);
  return d;
}

/**
 * Cast-off window `[from, to)` from `?from=&to=` (ISO instants). Missing `to` is now; missing
 * `from` is `to` minus the default window. The span is capped so one request stays light.
 * @returns {{ from: Date, to: Date }}
 */
export function parseSailedRange(query = {}, now = new Date()) {
  const to = parseInstant(query.to, 'to') ?? now;
  const from = parseInstant(query.from, 'from') ?? new Date(to.getTime() - SAILED_RANGE_DEFAULT_DAYS * DAY_MS);
  if (from.getTime() >= to.getTime()) throw badRequest('from must be before to');
  if (to.getTime() - from.getTime() > SAILED_RANGE_MAX_DAYS * DAY_MS) {
    throw badRequest(`Date range must be at most ${SAILED_RANGE_MAX_DAYS} days`);
  }
  return { from, to };
}

/** Newest cast-off first; rows without a cast-off sort last. */
export function sortByCastOffDesc(rows) {
  const ms = (r) => (r?.castOffDateTime ? new Date(r.castOffDateTime).getTime() : -Infinity);
  return [...rows].sort((a, b) => ms(b) - ms(a) || Number(b.operationId) - Number(a.operationId));
}
