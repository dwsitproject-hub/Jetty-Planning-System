import { DateTime } from 'luxon';

export const INTERNAL_SI_REFERENCE_RE = /^INT-SI-\d{2,}-\d{4}-\d{2}-\d+$/;

const FALLBACK_TIME_ZONE = 'Asia/Jakarta';

/**
 * @param {unknown} referenceNumber
 * @returns {boolean}
 */
export function isInternalSiReference(referenceNumber) {
  const ref = referenceNumber == null ? '' : String(referenceNumber).trim();
  return INTERNAL_SI_REFERENCE_RE.test(ref);
}

/**
 * @param {unknown} portId
 * @returns {string}
 */
export function formatPortIdSegment(portId) {
  const n = Number(portId);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('Invalid port id for internal SI number');
  }
  return String(n).padStart(2, '0');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatInternalSiSequence(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('Invalid internal SI sequence');
  }
  return n <= 9999 ? String(n).padStart(4, '0') : String(n);
}

/**
 * @param {unknown} portId
 * @param {string} period YYYY-MM
 * @param {unknown} sequence
 * @returns {string}
 */
export function formatInternalSiNumber(portId, period, sequence) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new Error('Invalid internal SI period');
  }
  return `INT-SI-${formatPortIdSegment(portId)}-${period}-${formatInternalSiSequence(sequence)}`;
}

/**
 * @param {unknown} timeZone
 * @param {Date} [now]
 * @returns {string}
 */
export function periodForTimeZone(timeZone, now = new Date()) {
  const requested = typeof timeZone === 'string' ? timeZone.trim() : '';
  const zone = requested && DateTime.now().setZone(requested).isValid ? requested : FALLBACK_TIME_ZONE;
  const dt = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(zone);
  const safe = dt.isValid ? dt : DateTime.fromJSDate(now, { zone: 'utc' }).setZone(FALLBACK_TIME_ZONE);
  return safe.toFormat('yyyy-MM');
}

/**
 * Next internal SI number for a port. Must run inside the submit transaction.
 * @param {import('pg').PoolClient} client
 * @param {number} portId
 * @param {Date} [now]
 * @returns {Promise<string>}
 */
export async function allocateInternalSiNumber(client, portId, now = new Date()) {
  const tz = await client.query(
    `SELECT schedule_timezone FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [portId]
  );
  const period = periodForTimeZone(tz.rows[0]?.schedule_timezone, now);
  const up = await client.query(
    `INSERT INTO internal_si_counters (port_id, period, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (port_id, period)
     DO UPDATE SET last_value = internal_si_counters.last_value + 1
     RETURNING last_value`,
    [portId, period]
  );
  return formatInternalSiNumber(portId, period, up.rows[0].last_value);
}
