/** Reject schedule milestones outside a sane calendar window. */
export const SCHEDULE_EARLIEST_MS = new Date('2020-01-01T00:00:00.000Z').getTime();

/** Allow milestones up to this many years ahead of `now`. */
export const SCHEDULE_FUTURE_YEARS = 2;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * @param {Date | string | null | undefined} value
 * @returns {Date | null}
 */
export function toScheduleDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date | string | null | undefined} ts
 * @param {{ now?: Date }} [opts]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateScheduleTimestamp(ts, { now = new Date() } = {}) {
  const d = toScheduleDate(ts);
  if (!d) return { ok: false, error: 'Invalid timestamp.' };
  const t = d.getTime();
  if (t < SCHEDULE_EARLIEST_MS) {
    return { ok: false, error: 'Timestamp is too far in the past (before 2020).' };
  }
  const maxMs = now.getTime() + SCHEDULE_FUTURE_YEARS * MS_PER_YEAR;
  if (t > maxMs) {
    return { ok: false, error: `Timestamp cannot be more than ${SCHEDULE_FUTURE_YEARS} years in the future.` };
  }
  return { ok: true };
}

/**
 * Validate TA/TB/ETC ordering and sane windows for berthing timeline fields.
 * Only validates fields that are non-null; partial updates merge with existing values on the server.
 *
 * @param {{ ta?: Date | string | null, tb?: Date | string | null, etc?: Date | string | null, eta?: Date | string | null, etb?: Date | string | null }} fields
 * @param {{ now?: Date }} [opts]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateBerthingTimeline(fields = {}, { now = new Date() } = {}) {
  const labeled = [
    ['Time of Arrival (TA)', fields.ta],
    ['Time of Berthing (TB)', fields.tb],
    ['Estimated completion (ETC)', fields.etc],
    ['ETA', fields.eta],
    ['ETB', fields.etb],
  ];

  for (const [label, value] of labeled) {
    if (value == null || value === '') continue;
    const r = validateScheduleTimestamp(value, { now });
    if (!r.ok) return { ok: false, error: `${label}: ${r.error}` };
  }

  const taD = toScheduleDate(fields.ta);
  const tbD = toScheduleDate(fields.tb);
  const etcD = toScheduleDate(fields.etc);

  if (taD && tbD && tbD.getTime() < taD.getTime()) {
    return { ok: false, error: 'Time of Berthing (TB) must be on or after Time of Arrival (TA).' };
  }
  if (tbD && etcD && etcD.getTime() < tbD.getTime()) {
    return { ok: false, error: 'Estimated completion (ETC) must be on or after Time of Berthing (TB).' };
  }

  return { ok: true };
}
