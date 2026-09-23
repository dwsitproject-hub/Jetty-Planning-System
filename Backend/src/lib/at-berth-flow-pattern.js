/**
 * At-berth flow-rate pattern: clock-hour average MT/h vs standard rate, Loading vs Unloading.
 */

const LOOKBACK_DAYS_DEFAULT = 14;

export function clockHourInTimeZone(iso, timeZone = 'Asia/Jakarta') {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZone: timeZone || 'UTC',
    }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(hour) ? hour % 24 : null;
  } catch {
    return d.getUTCHours();
  }
}

function emptyHour(hour) {
  return {
    hour,
    loading: null,
    unloading: null,
    loadingN: 0,
    unloadingN: 0,
  };
}

/**
 * @param {Array<{ hourStart: string|Date, purpose?: string, rateTph?: number|null }>} rows
 * @param {string} [timeZone]
 */
export function aggregateHourOfDayRates(rows, timeZone = 'Asia/Jakarta') {
  const hours = Array.from({ length: 24 }, (_, hour) => emptyHour(hour));
  const sums = Array.from({ length: 24 }, () => ({ loading: 0, unloading: 0, loadingN: 0, unloadingN: 0 }));

  for (const r of rows || []) {
    const hour = clockHourInTimeZone(r.hourStart, timeZone);
    if (hour == null) continue;
    const rate = Number(r.rateTph);
    if (!Number.isFinite(rate) || rate < 0) continue;
    const purpose = String(r.purpose || '');
    const key = purpose === 'Loading' ? 'loading' : purpose === 'Unloading' ? 'unloading' : null;
    if (!key) continue;
    sums[hour][key] += rate;
    sums[hour][`${key}N`] += 1;
  }

  for (let hour = 0; hour < 24; hour += 1) {
    const s = sums[hour];
    hours[hour].loading = s.loadingN ? s.loading / s.loadingN : null;
    hours[hour].unloading = s.unloadingN ? s.unloading / s.unloadingN : null;
    hours[hour].loadingN = s.loadingN;
    hours[hour].unloadingN = s.unloadingN;
  }
  return hours;
}

function avgOf(hours, start, end, key) {
  const vals = hours.slice(start, end).map((h) => h[key]).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function pctVsStandard(actual, standard) {
  if (actual == null || standard == null || !(standard > 0)) return null;
  return ((actual - standard) / standard) * 100;
}

/**
 * Short management insight: night vs day and vs standard rate.
 * @param {Array<{ hour: number, loading: number|null, unloading: number|null }>} hours
 * @param {{ loading?: number|null, unloading?: number|null }} [standards]
 */
export function buildFlowInsight(hours, standards = {}) {
  const nightLoad = avgOf(hours, 0, 6, 'loading');
  const dayLoad = avgOf(hours, 6, 18, 'loading');
  const nightDisc = avgOf(hours, 0, 6, 'unloading');
  const dayDisc = avgOf(hours, 6, 18, 'unloading');
  const loadStd = Number(standards.loading) > 0 ? Number(standards.loading) : null;
  const discStd = Number(standards.unloading) > 0 ? Number(standards.unloading) : null;

  const parts = [];
  const loadNightVsStd = pctVsStandard(nightLoad, loadStd);
  const discNightVsStd = pctVsStandard(nightDisc, discStd);
  const loadDayVsStd = pctVsStandard(dayLoad, loadStd);
  const discDayVsStd = pctVsStandard(dayDisc, discStd);

  const describe = (label, pct) => {
    if (pct == null) return null;
    const abs = Math.abs(pct).toFixed(0);
    if (Math.abs(pct) < 5) return `${label} in line with standard`;
    return `${label} ${abs}% ${pct < 0 ? 'below' : 'above'} standard`;
  };

  const nightLoadLine = describe('Loading 00:00–06:00', loadNightVsStd);
  const nightDiscLine = describe('Unloading 00:00–06:00', discNightVsStd);
  const dayLoadLine = describe('Loading 06:00–18:00', loadDayVsStd);
  const dayDiscLine = describe('Unloading 06:00–18:00', discDayVsStd);

  for (const line of [nightLoadLine, nightDiscLine, dayLoadLine, dayDiscLine]) {
    if (line) parts.push(line);
  }

  if (!parts.length) {
    if (nightLoad != null && dayLoad != null && dayLoad > 0) {
      const drop = ((nightLoad - dayLoad) / dayLoad) * 100;
      if (Math.abs(drop) >= 8) {
        parts.push(
          `Loading ${Math.abs(drop).toFixed(0)}% ${drop < 0 ? 'slower' : 'faster'} overnight vs daytime`
        );
      }
    }
    if (nightDisc != null && dayDisc != null && dayDisc > 0) {
      const drop = ((nightDisc - dayDisc) / dayDisc) * 100;
      if (Math.abs(drop) >= 8) {
        parts.push(
          `Unloading ${Math.abs(drop).toFixed(0)}% ${drop < 0 ? 'slower' : 'faster'} overnight vs daytime`
        );
      }
    }
  }

  return parts.length ? `${parts[0]}.` : 'Not enough hourly cargo data yet to show a rate pattern.';
}

export async function loadStandardRatesByActivity(db, portId) {
  const r = await db.query(
    `SELECT activity_type,
            AVG(rate_value)::float AS avg_rate
       FROM standard_rates
      WHERE deleted_at IS NULL
        AND rate_metric = 'MTPH'
        AND ($1::bigint IS NULL OR port_id IS NULL OR port_id = $1)
      GROUP BY activity_type`,
    [portId ?? null]
  );
  const out = { loading: null, unloading: null };
  for (const row of r.rows || []) {
    const t = String(row.activity_type || '').toUpperCase();
    if (t === 'LOADING') out.loading = Number(row.avg_rate) || null;
    if (t === 'UNLOADING') out.unloading = Number(row.avg_rate) || null;
  }
  return out;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} portId
 * @param {{ lookbackDays?: number, timeZone?: string }} [opts]
 */
export async function computeAtBerthFlowPattern(db, portId, opts = {}) {
  const lookbackDays = Number(opts.lookbackDays) > 0 ? Number(opts.lookbackDays) : LOOKBACK_DAYS_DEFAULT;
  const tzR = await db.query(
    `SELECT COALESCE(schedule_timezone, 'Asia/Jakarta') AS tz
       FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [portId]
  );
  const timeZone = opts.timeZone || tzR.rows[0]?.tz || 'Asia/Jakarta';

  const hourR = await db.query(
    `SELECT o.purpose,
            h.hour_start,
            h.rate_tph
       FROM operation_hourly_cargo_progress h
       JOIN operations o ON o.id = h.operation_id AND o.deleted_at IS NULL
       LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
       LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
      WHERE COALESCE(o.port_id, p.id) = $1
        AND h.rate_tph IS NOT NULL
        AND (
          o.status <> 'SAILED'
          OR h.hour_start >= NOW() - ($2::int * INTERVAL '1 day')
        )`,
    [portId, lookbackDays]
  );

  const rows = (hourR.rows || []).map((r) => ({
    purpose: r.purpose,
    hourStart: r.hour_start,
    rateTph: r.rate_tph != null ? Number(r.rate_tph) : null,
  }));
  const hours = aggregateHourOfDayRates(rows, timeZone);
  const standards = await loadStandardRatesByActivity(db, portId);
  const insight = buildFlowInsight(hours, standards);
  const sampleHours = hours.reduce((n, h) => n + h.loadingN + h.unloadingN, 0);

  return {
    lookbackDays,
    timeZone,
    hours,
    standards,
    insight,
    sampleHours,
  };
}
