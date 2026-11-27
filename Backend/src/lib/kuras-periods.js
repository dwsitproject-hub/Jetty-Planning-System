/**
 * Mixed (Normal & Kuras) movement: periods when another palka is cleaned (kuras) while the entry
 * keeps pumping into the same tank. A period belongs to one cargo entry: palka (1-3 characters),
 * from, until (empty = still going) and an optional quantity cleaned. The entry's moved quantity
 * still comes from ATG once; a period quantity only says how much of it was cleaning.
 */

const PALKA_RE = /^[A-Z0-9]{1,3}$/;
const ms = (v) => (v == null ? NaN : new Date(v).getTime());

/**
 * Validate the periods sent with one entry.
 * @param {unknown} raw payload `kurasPeriods`
 * @param {{ lineIndex: number, toIso: (s: string) => string|null, startIso: string, endIso: string|null, qty?: number|null }} ctx
 * @returns {{ ok: true, value: Array<{ palka: string, startedAt: string, endedAt: string|null, qty: number|null }> } | { ok: false, error: string }}
 */
export function parseKurasPeriods(raw, { lineIndex, toIso, startIso, endIso, qty = null }) {
  const where = (j, field) => `cargoLoadLines[${lineIndex}].kurasPeriods[${j}]${field ? `.${field}` : ''}`;
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `cargoLoadLines[${lineIndex}].kurasPeriods must be a list` };
  const entryStart = ms(startIso);
  const entryEnd = endIso ? ms(endIso) : null;
  const out = [];
  for (let j = 0; j < raw.length; j++) {
    const p = raw[j] || {};
    const palka = String(p.palka ?? '').trim().toUpperCase();
    if (!PALKA_RE.test(palka)) return { ok: false, error: `${where(j, 'palka')} is required (1 to 3 letters or digits)` };
    const startedAt = toIso(p.from ?? p.startedAt);
    if (!startedAt) return { ok: false, error: `${where(j, 'from')} is required` };
    if (ms(startedAt) < entryStart) return { ok: false, error: `${where(j, 'from')} cannot be before the entry start` };
    const untilRaw = p.until ?? p.endedAt;
    let endedAt = null;
    if (untilRaw != null && String(untilRaw).trim() !== '') {
      endedAt = toIso(untilRaw);
      if (!endedAt) return { ok: false, error: `${where(j, 'until')} is not a valid date and time` };
      if (ms(endedAt) <= ms(startedAt)) return { ok: false, error: `${where(j, 'until')} must be after from` };
      if (entryEnd != null && ms(endedAt) > entryEnd) return { ok: false, error: `${where(j, 'until')} cannot be after the entry end` };
    }
    if (entryEnd != null && ms(startedAt) >= entryEnd) return { ok: false, error: `${where(j, 'from')} must be before the entry end` };
    let q = null;
    if (p.qty != null && String(p.qty).trim() !== '') {
      q = Number(p.qty);
      if (!Number.isFinite(q) || q <= 0) return { ok: false, error: `${where(j, 'qty')} must be above 0` };
      if (qty != null && Number.isFinite(Number(qty)) && q > Number(qty)) {
        return { ok: false, error: `${where(j, 'qty')} cannot be more than the entry quantity` };
      }
    }
    out.push({ palka, startedAt, endedAt, qty: q });
  }
  // the same palka cannot be cleaned twice at the same time
  const byPalka = new Map();
  out.forEach((p) => {
    if (!byPalka.has(p.palka)) byPalka.set(p.palka, []);
    byPalka.get(p.palka).push(p);
  });
  for (const [palka, list] of byPalka) {
    const sorted = [...list].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
    for (let k = 1; k < sorted.length; k++) {
      const prevEnd = sorted[k - 1].endedAt ? ms(sorted[k - 1].endedAt) : Infinity;
      if (ms(sorted[k].startedAt) < prevEnd) {
        return { ok: false, error: `cargoLoadLines[${lineIndex}].kurasPeriods: palka ${palka} overlaps another period of the same palka` };
      }
    }
  }
  return { ok: true, value: out };
}

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** DB row → API shape. */
export function mapKurasPeriodRow(row) {
  return {
    id: String(row.id),
    palka: row.palka,
    startAt: toIso(row.started_at),
    endAt: toIso(row.ended_at),
    qty: row.qty != null ? Number(row.qty) : null,
  };
}

/** Replace the periods of one saved entry. */
export async function insertKurasPeriods(db, loadLineId, periods) {
  const out = [];
  for (const p of periods || []) {
    const r = await db.query(
      `INSERT INTO operation_cargo_kuras_periods (load_line_id, palka, started_at, ended_at, qty)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, palka, started_at, ended_at, qty`,
      [loadLineId, p.palka, p.startedAt, p.endedAt, p.qty]
    );
    out.push(mapKurasPeriodRow(r.rows[0]));
  }
  return out;
}

/** Periods of many entries in one read: Map<loadLineId, period[]>. */
export async function loadKurasPeriodsByLine(db, loadLineIds) {
  const ids = [...new Set((loadLineIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const r = await db.query(
    `SELECT id, load_line_id, palka, started_at, ended_at, qty
     FROM operation_cargo_kuras_periods WHERE load_line_id = ANY($1::bigint[])
     ORDER BY started_at ASC, id ASC`,
    [ids]
  );
  for (const row of r.rows) {
    const id = Number(row.load_line_id);
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(mapKurasPeriodRow(row));
  }
  return out;
}

/**
 * Periods of the entries of one activity before a re-save replaces its lines, keyed by the entry
 * start (the same key the movement tags use): Map<startIso, Array<{ palka, startedAt, endedAt, qty }>>.
 */
export async function loadPriorKurasPeriods(db, operationalActivityId) {
  const r = await db.query(
    `SELECT l.started_at AS line_start, p.palka, p.started_at, p.ended_at, p.qty
     FROM operation_cargo_kuras_periods p
     JOIN operation_cargo_load_lines l ON l.id = p.load_line_id
     WHERE l.operational_activity_id = $1 AND l.started_at IS NOT NULL
     ORDER BY p.started_at ASC, p.id ASC`,
    [operationalActivityId]
  );
  const out = new Map();
  for (const row of r.rows) {
    const key = new Date(row.line_start).toISOString();
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ palka: row.palka, startedAt: toIso(row.started_at), endedAt: toIso(row.ended_at), qty: row.qty != null ? Number(row.qty) : null });
  }
  return out;
}
