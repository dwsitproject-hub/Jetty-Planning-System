/**
 * Operational day boundaries (port-configurable start, default 06:00:00).
 * Day D: D at start → (D+1) at start − 1 second (e.g. 5 Aug 06:00:00 → 6 Aug 05:59:59).
 */

import { DateTime } from 'luxon';

export const DEFAULT_OPERATIONAL_DAY_START = '06:00:00';

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * @param {string | null | undefined} raw
 * @returns {{ hour: number, minute: number, second: number, formatted: string }}
 */
export function parseOperationalDayStart(raw) {
  const s = String(raw ?? DEFAULT_OPERATIONAL_DAY_START).trim() || DEFAULT_OPERATIONAL_DAY_START;
  const m = TIME_RE.exec(s);
  if (!m) {
    return parseOperationalDayStart(DEFAULT_OPERATIONAL_DAY_START);
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] != null ? Number(m[3]) : 0;
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return parseOperationalDayStart(DEFAULT_OPERATIONAL_DAY_START);
  }
  const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return { hour, minute, second, formatted };
}

/**
 * @param {string | Date | import('luxon').DateTime} instant
 * @param {string} timezone
 * @param {string} [dayStartTime]
 * @returns {string} YYYY-MM-DD operational day label
 */
export function operationalDateKey(instant, timezone, dayStartTime = DEFAULT_OPERATIONAL_DAY_START) {
  const tz = timezone || 'Asia/Jakarta';
  const dt =
    instant instanceof DateTime
      ? instant.setZone(tz)
      : DateTime.fromISO(instant instanceof Date ? instant.toISOString() : String(instant), {
          setZone: true,
        }).setZone(tz);
  if (!dt.isValid) return null;

  const { hour, minute, second } = parseOperationalDayStart(dayStartTime);
  const todayStart = dt.startOf('day').set({ hour, minute, second, millisecond: 0 });
  if (dt.toMillis() < todayStart.toMillis()) {
    return dt.minus({ days: 1 }).toFormat('yyyy-MM-dd');
  }
  return dt.toFormat('yyyy-MM-dd');
}

/**
 * @param {string} dateKey YYYY-MM-DD
 * @param {string} timezone
 * @param {string} [dayStartTime]
 * @returns {{ start: import('luxon').DateTime, end: import('luxon').DateTime } | null}
 */
export function operationalDayBounds(dateKey, timezone, dayStartTime = DEFAULT_OPERATIONAL_DAY_START) {
  if (!dateKey) return null;
  const tz = timezone || 'Asia/Jakarta';
  const { hour, minute, second } = parseOperationalDayStart(dayStartTime);
  const start = DateTime.fromISO(`${dateKey}T00:00:00`, { zone: tz }).set({
    hour,
    minute,
    second,
    millisecond: 0,
  });
  if (!start.isValid) return null;
  const end = start.plus({ days: 1 }).minus({ seconds: 1 });
  return { start, end };
}

/**
 * @param {string | Date} startInstant
 * @param {string | Date} endInstant
 * @param {string} timezone
 * @param {string} [dayStartTime]
 * @returns {string[]}
 */
export function listOperationalDateKeysInRange(startInstant, endInstant, timezone, dayStartTime) {
  const tz = timezone || 'Asia/Jakarta';
  const startMs = new Date(startInstant).getTime();
  const endMs = new Date(endInstant).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  let key = operationalDateKey(new Date(startMs).toISOString(), tz, dayStartTime);
  const endKey = operationalDateKey(new Date(endMs).toISOString(), tz, dayStartTime);
  const keys = [];
  const seen = new Set();
  while (key && !seen.has(key)) {
    keys.push(key);
    seen.add(key);
    if (key === endKey) break;
    const bounds = operationalDayBounds(key, tz, dayStartTime);
    if (!bounds) break;
    key = bounds.end.plus({ seconds: 1 }).toFormat('yyyy-MM-dd');
    if (keys.length > 400) break;
  }
  return keys;
}

/**
 * @param {number} [nowMs]
 * @param {string} timezone
 * @param {string} [dayStartTime]
 * @returns {string}
 */
export function currentOperationalDateKey(nowMs = Date.now(), timezone, dayStartTime) {
  return operationalDateKey(new Date(nowMs).toISOString(), timezone, dayStartTime);
}

/**
 * @param {string} dateKey
 * @returns {string} e.g. "23 Jul"
 */
export function formatOperationalDateLabel(dateKey) {
  if (!dateKey) return '—';
  const dt = DateTime.fromFormat(dateKey, 'yyyy-MM-dd');
  if (!dt.isValid) return dateKey;
  return dt.toFormat('d LLL');
}
