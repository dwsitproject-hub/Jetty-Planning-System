/** @see Backend/src/lib/validate-schedule-timeline.js */

export const SCHEDULE_EARLIEST_MS = new Date('2020-01-01T00:00:00.000Z').getTime();
export const SCHEDULE_FUTURE_YEARS = 2;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function toScheduleDate(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date | string | null | undefined} ts
 * @param {{ nowMs?: number }} [opts]
 * @returns {string | null} Error message, or null if valid.
 */
export function validateScheduleTimestamp(ts, { nowMs = Date.now() } = {}) {
  const d = toScheduleDate(ts);
  if (!d) return 'Invalid timestamp.';
  const t = d.getTime();
  if (t < SCHEDULE_EARLIEST_MS) {
    return 'Timestamp is too far in the past (before 2020).';
  }
  const maxMs = nowMs + SCHEDULE_FUTURE_YEARS * MS_PER_YEAR;
  if (t > maxMs) {
    return `Timestamp cannot be more than ${SCHEDULE_FUTURE_YEARS} years in the future.`;
  }
  return null;
}

/**
 * @param {{ ta?: string | Date | null, tb?: string | Date | null, etc?: string | Date | null, eta?: string | Date | null, etb?: string | Date | null }} fields
 * @param {{ nowMs?: number }} [opts]
 * @returns {string | null} Error message, or null if valid.
 */
export function validateBerthingTimeline(fields = {}, { nowMs = Date.now() } = {}) {
  const labeled = [
    ['Time of Arrival (TA)', fields.ta],
    ['Time of Berthing (TB)', fields.tb],
    ['Estimated completion (ETC)', fields.etc],
    ['ETA', fields.eta],
    ['ETB', fields.etb],
  ];

  for (const [label, value] of labeled) {
    if (value == null || value === '') continue;
    const err = validateScheduleTimestamp(value, { nowMs });
    if (err) return `${label}: ${err}`;
  }

  const taD = toScheduleDate(fields.ta);
  const tbD = toScheduleDate(fields.tb);
  const etcD = toScheduleDate(fields.etc);

  if (taD && tbD && tbD.getTime() < taD.getTime()) {
    return 'Time of Berthing (TB) must be on or after Time of Arrival (TA).';
  }
  if (tbD && etcD && etcD.getTime() < tbD.getTime()) {
    return 'Estimated completion (ETC) must be on or after Time of Berthing (TB).';
  }

  return null;
}
