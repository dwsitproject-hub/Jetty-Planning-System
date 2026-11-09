/**
 * Cargo segment side of the per-tank manual override: parse, check and total the
 * quantities an operator typed in for tanks whose ATG is being overridden.
 */

export const MIN_NOTE_LENGTH = 3;

/**
 * @param {object} row raw cargo load line from the request
 * @param {number} lineIndex
 * @returns {{ ok: true, entries: Array<{ tankId: number, qty: number }>, note: string } | { ok: false, error: string }}
 */
export function parseOverrideEntries(row, lineIndex) {
  const raw = row?.manualOverrides ?? row?.manual_overrides;
  const note = String(row?.manualOverrideNote ?? row?.manual_override_note ?? '').trim();
  if (raw == null || raw === '') return { ok: true, entries: [], note };
  if (!Array.isArray(raw)) return { ok: false, error: `cargoLoadLines[${lineIndex}].manualOverrides must be an array` };

  const entries = [];
  for (let j = 0; j < raw.length; j++) {
    const tankId = parseInt(String(raw[j]?.tankId ?? raw[j]?.tank_id), 10);
    const qty = Number(raw[j]?.qty);
    if (!Number.isFinite(tankId) || tankId <= 0) {
      return { ok: false, error: `cargoLoadLines[${lineIndex}].manualOverrides[${j}].tankId is invalid` };
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: `cargoLoadLines[${lineIndex}].manualOverrides[${j}].qty must be a positive number` };
    }
    if (entries.some((e) => e.tankId === tankId)) {
      return { ok: false, error: `cargoLoadLines[${lineIndex}].manualOverrides has tank ${tankId} twice` };
    }
    entries.push({ tankId, qty });
  }
  return { ok: true, entries, note };
}

/**
 * Rules for a segment that carries hand-entered quantities for overridden tanks.
 * @param {object} opts
 * @param {Array<{ tankId: number, qty: number }>} opts.entries
 * @param {string} opts.note
 * @param {number[]} opts.atgTankIds ATG tanks on this segment
 * @param {Set<number>} opts.activeIds tanks whose override is on right now
 * @param {Set<number>} opts.grandfatheredIds tanks already stored with a manual quantity on this exact segment
 * @param {boolean} opts.hasEnd
 * @param {'auto'|'manual'} opts.atgQtyMode
 * @param {Map<number, string>} [opts.codeById]
 * @returns {string|null} error message, or null when valid
 */
export function checkOverrideEntries({ entries, note, atgTankIds, activeIds, grandfatheredIds, hasEnd, atgQtyMode, codeById = new Map() }) {
  if (!entries.length) return null;
  const label = (id) => codeById.get(id) || String(id);

  if (!hasEnd) return 'Enter manual tank quantities when the segment ends (endAt)';
  if (atgQtyMode === 'manual') return 'Use either "ATG not available" or per-tank manual quantities, not both';

  for (const e of entries) {
    if (!atgTankIds.includes(e.tankId)) return `Tank ${label(e.tankId)} is not an ATG tank on this segment`;
    if (!activeIds.has(e.tankId) && !grandfatheredIds.has(e.tankId)) {
      return `Manual override is not enabled for tank ${label(e.tankId)}`;
    }
  }
  if (note.length < MIN_NOTE_LENGTH) return 'Enter a note for the manual quantity';
  return null;
}

/** Sum of hand-entered tank quantities. */
export function sumOverrideQty(entries) {
  return entries.reduce((n, e) => n + e.qty, 0);
}

/**
 * Manual part of a segment: the shared quantity for non-ATG tanks plus each overridden tank.
 * @param {number|null} nonAtgManualQty
 * @param {Array<{ qty: number }>} entries
 */
export function totalManualQty(nonAtgManualQty, entries) {
  return (Number(nonAtgManualQty) || 0) + sumOverrideQty(entries);
}

/** JSON stored on the load line. */
export function buildManualOverrideJson(entries, note) {
  if (!entries.length) return null;
  return { note, tanks: entries.map((e) => ({ tankId: e.tankId, qty: e.qty })) };
}
