/**
 * Compute ATG hourly rate over [startAt, endAt] from tank_gauging_samples.
 * Per tank: |mass_end − mass_start| / hours; aggregate = sum of per-tank rates.
 */

export const DEFAULT_TOLERANCE_MS = 15 * 60 * 1000;

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} tankId
 * @param {Date} at
 * @param {number} toleranceMs
 */
export async function nearestSampleAtOrBefore(db, tankId, at, toleranceMs) {
  const r = await db.query(
    `SELECT id, tank_id, source_base_url, total_mass, sampled_at, status_text
     FROM tank_gauging_samples
     WHERE tank_id = $1
       AND sampled_at <= $2
       AND sampled_at >= $2::timestamptz - ($3::bigint * INTERVAL '1 millisecond')
       AND total_mass IS NOT NULL
     ORDER BY sampled_at DESC
     LIMIT 1`,
    [tankId, at.toISOString(), toleranceMs]
  );
  if (r.rows[0]) return r.rows[0];

  // Fallback: nearest after within tolerance (clock skew / sparse poll)
  const r2 = await db.query(
    `SELECT id, tank_id, source_base_url, total_mass, sampled_at, status_text
     FROM tank_gauging_samples
     WHERE tank_id = $1
       AND sampled_at > $2
       AND sampled_at <= $2::timestamptz + ($3::bigint * INTERVAL '1 millisecond')
       AND total_mass IS NOT NULL
     ORDER BY sampled_at ASC
     LIMIT 1`,
    [tankId, at.toISOString(), toleranceMs]
  );
  return r2.rows[0] || null;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 * @param {Array<number|string>} opts.tankIds
 * @param {string|Date} opts.startAt
 * @param {string|Date} opts.endAt
 * @param {number} [opts.toleranceMs]
 */
export async function computeAtgWindowRate(db, opts) {
  const startAt = new Date(opts.startAt);
  const endAt = new Date(opts.endAt);
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : DEFAULT_TOLERANCE_MS;

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { ok: false, error: 'invalid_window', sumRateTph: null, hours: null, tanks: [], incomplete: true };
  }
  const hours = (endAt.getTime() - startAt.getTime()) / 3600000;
  if (!(hours > 0)) {
    return { ok: false, error: 'non_positive_duration', sumRateTph: null, hours, tanks: [], incomplete: true };
  }

  const tankIds = (opts.tankIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!tankIds.length) {
    return { ok: false, error: 'no_tanks', sumRateTph: null, hours, tanks: [], incomplete: true };
  }

  const meta = await db.query(
    `SELECT id, code, name FROM master_tanks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [tankIds]
  );
  const metaById = new Map(meta.rows.map((row) => [Number(row.id), row]));

  const tanks = [];
  let sumRateTph = 0;
  let okCount = 0;

  for (const tankId of tankIds) {
    const m = metaById.get(tankId);
    const sStart = await nearestSampleAtOrBefore(db, tankId, startAt, toleranceMs);
    const sEnd = await nearestSampleAtOrBefore(db, tankId, endAt, toleranceMs);

    if (!sStart || !sEnd) {
      tanks.push({
        tankId: String(tankId),
        code: m?.code ?? null,
        name: m?.name ?? null,
        sourceBaseUrl: sStart?.source_base_url || sEnd?.source_base_url || null,
        massStart: sStart?.total_mass != null ? Number(sStart.total_mass) : null,
        massEnd: sEnd?.total_mass != null ? Number(sEnd.total_mass) : null,
        deltaMass: null,
        hours,
        rateTph: null,
        sampleStartAt: sStart?.sampled_at ?? null,
        sampleEndAt: sEnd?.sampled_at ?? null,
        error: !sStart && !sEnd ? 'no_sample' : !sStart ? 'no_sample_start' : 'no_sample_end',
      });
      continue;
    }

    const massStart = Number(sStart.total_mass);
    const massEnd = Number(sEnd.total_mass);
    const deltaMass = massEnd - massStart;
    const rateTph = Math.abs(deltaMass) / hours;
    sumRateTph += rateTph;
    okCount += 1;

    tanks.push({
      tankId: String(tankId),
      code: m?.code ?? null,
      name: m?.name ?? null,
      sourceBaseUrl: sEnd.source_base_url || sStart.source_base_url || null,
      massStart,
      massEnd,
      deltaMass,
      hours,
      rateTph,
      sampleStartAt: sStart.sampled_at,
      sampleEndAt: sEnd.sampled_at,
      error: null,
    });
  }

  const incomplete = okCount < tankIds.length;
  return {
    ok: okCount > 0,
    sumRateTph: okCount > 0 ? sumRateTph : null,
    hours,
    tanks,
    incomplete,
    error: okCount === 0 ? 'no_samples' : incomplete ? 'partial_samples' : null,
  };
}

/**
 * Mass delta over [startAt, endAt]: sum of |massEnd − massStart| per tank.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 * @param {Array<number|string>} opts.tankIds
 * @param {string|Date} opts.startAt
 * @param {string|Date} opts.endAt
 * @param {number} [opts.toleranceMs]
 */
export async function computeAtgWindowMassDelta(db, opts) {
  const startAt = new Date(opts.startAt);
  const endAt = new Date(opts.endAt);
  const toleranceMs = Number.isFinite(opts.toleranceMs) ? opts.toleranceMs : DEFAULT_TOLERANCE_MS;

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { ok: false, error: 'invalid_window', sumDeltaMass: null, tanks: [], incomplete: true };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return { ok: false, error: 'non_positive_duration', sumDeltaMass: null, tanks: [], incomplete: true };
  }

  const tankIds = (opts.tankIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!tankIds.length) {
    return { ok: false, error: 'no_tanks', sumDeltaMass: null, tanks: [], incomplete: true };
  }

  const meta = await db.query(
    `SELECT id, code, name FROM master_tanks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [tankIds]
  );
  const metaById = new Map(meta.rows.map((row) => [Number(row.id), row]));

  const tanks = [];
  let sumDeltaMass = 0;
  let okCount = 0;

  for (const tankId of tankIds) {
    const m = metaById.get(tankId);
    const sStart = await nearestSampleAtOrBefore(db, tankId, startAt, toleranceMs);
    const sEnd = await nearestSampleAtOrBefore(db, tankId, endAt, toleranceMs);

    if (!sStart || !sEnd) {
      tanks.push({
        tankId: String(tankId),
        code: m?.code ?? null,
        name: m?.name ?? null,
        sourceBaseUrl: sStart?.source_base_url || sEnd?.source_base_url || null,
        massStart: sStart?.total_mass != null ? Number(sStart.total_mass) : null,
        massEnd: sEnd?.total_mass != null ? Number(sEnd.total_mass) : null,
        deltaMass: null,
        sampleStartAt: sStart?.sampled_at ?? null,
        sampleEndAt: sEnd?.sampled_at ?? null,
        error: !sStart && !sEnd ? 'no_sample' : !sStart ? 'no_sample_start' : 'no_sample_end',
      });
      continue;
    }

    const massStart = Number(sStart.total_mass);
    const massEnd = Number(sEnd.total_mass);
    const deltaMass = massEnd - massStart;
    sumDeltaMass += Math.abs(deltaMass);
    okCount += 1;

    tanks.push({
      tankId: String(tankId),
      code: m?.code ?? null,
      name: m?.name ?? null,
      sourceBaseUrl: sEnd.source_base_url || sStart.source_base_url || null,
      massStart,
      massEnd,
      deltaMass,
      sampleStartAt: sStart.sampled_at,
      sampleEndAt: sEnd.sampled_at,
      error: null,
    });
  }

  const incomplete = okCount < tankIds.length;
  return {
    ok: okCount > 0,
    sumDeltaMass: okCount > 0 ? sumDeltaMass : null,
    tanks,
    incomplete,
    error: okCount === 0 ? 'no_samples' : incomplete ? 'partial_samples' : null,
  };
}
