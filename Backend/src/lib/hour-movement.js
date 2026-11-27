/**
 * Movement type of one clock hour of a cargo entry, for the hourly rate table and the reports:
 *  - kuras: the whole entry is Kuras, or the hour is after the entry's kuras start
 *  - mixed: the entry is Mixed and a palka period overlaps the hour (those palkas are listed)
 *  - normal: everything else
 */

const ms = (v) => (v == null ? NaN : new Date(v).getTime());

/**
 * @param {{ movementType?: string|null, kurasStartedAt?: string|null, kurasPeriods?: Array<{ palka: string, startAt?: string, endAt?: string|null }>, endedAt?: string|null }} line
 * @returns {{ movementType: 'normal'|'kuras'|'mixed', kurasPalkas: string[] }}
 */
export function movementOfHour(line, hourStart, hourEnd, nowMs = Date.now()) {
  const hs = ms(hourStart);
  const he = ms(hourEnd);
  const type = line?.movementType;
  if (type === 'kuras') return { movementType: 'kuras', kurasPalkas: [] };
  if (type === 'mixed') {
    const lineEnd = line.endedAt ? ms(line.endedAt) : nowMs;
    const palkas = [];
    for (const p of line.kurasPeriods || []) {
      const ps = ms(p.startAt ?? p.startedAt);
      const pe = p.endAt || p.endedAt ? ms(p.endAt ?? p.endedAt) : lineEnd;
      if (Number.isFinite(ps) && Number.isFinite(pe) && ps < he && pe > hs && !palkas.includes(p.palka)) palkas.push(p.palka);
    }
    return palkas.length ? { movementType: 'mixed', kurasPalkas: palkas } : { movementType: 'normal', kurasPalkas: [] };
  }
  const k = ms(line?.kurasStartedAt);
  if (Number.isFinite(k) && (hs + he) / 2 >= k) return { movementType: 'kuras', kurasPalkas: [] };
  return { movementType: 'normal', kurasPalkas: [] };
}

const RANK = { normal: 0, mixed: 1, kuras: 2 };

/** When two entries share one clock hour, the stronger label wins (kuras over mixed over normal). */
export function strongerMovement(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a;
}

/** Add movementType / kurasPalkas to each bucket of one entry. */
export function tagBucketsWithMovement(buckets, line, nowMs = Date.now()) {
  return (buckets || []).map((b) => ({ ...b, ...movementOfHour(line, b.hourStart, b.hourEnd, nowMs) }));
}
