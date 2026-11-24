/**
 * Kuras start point inside one cargo entry. Each hourly bucket is judged with the same port
 * Kuras rule used for whole entries (remaining before the hour and/or hourly rate). Kuras starts
 * at the earliest pumping hour from which every later pumping hour also matches the rule.
 * Hours without movement (flat / zero qty) neither start nor break the kuras run.
 * Only hours measured by ATG are judged: manual and fallback hours are spread evenly from one
 * logged quantity, so their rate is flat and says nothing about when the flow slowed down.
 * They still count towards the quantity moved so far.
 */
import { evaluateKurasSegment } from './kuras-movement.js';

const ms = (v) => (v == null ? NaN : new Date(v).getTime());

/** A bucket carries a measured rate when ATG made it (a bucket without a source counts as measured). */
const isMeasured = (h) => h.source == null || h.source === 'atg';

/**
 * @param {{
 *   hours: Array<{ hourStart: string, hourEnd: string, qtyMoved: number|null, movementStatus?: string, source?: string }>,
 *   lineStartedAt: string,
 *   lineEndedAt: string|null,
 *   plannedQty: number|null,
 *   movedBefore: number,
 *   mtFactor: number|null,
 *   rule: object|null,
 * }} input
 * @returns {{ kurasStartedAt: string|null, reason: object }}
 */
export function findKurasStart({ hours, lineStartedAt, lineEndedAt, plannedQty, movedBefore = 0, mtFactor, rule }) {
  if (!lineEndedAt) return { kurasStartedAt: null, reason: { code: 'open' } };
  if (!rule || !rule.isActive) return { kurasStartedAt: null, reason: { code: 'noRule' } };
  const lineStart = ms(lineStartedAt);
  const lineEnd = ms(lineEndedAt);

  let moved = Number(movedBefore) || 0;
  const judged = [];
  for (const h of [...(hours || [])].sort((a, b) => ms(a.hourStart) - ms(b.hourStart))) {
    const qty = Number(h.qtyMoved) || 0;
    const start = Math.max(ms(h.hourStart), lineStart);
    const end = Math.min(ms(h.hourEnd), lineEnd);
    const pumping = isMeasured(h) && qty > 0 && h.movementStatus !== 'flat_movement' && end > start;
    if (pumping) {
      const remainingPct =
        plannedQty != null && plannedQty > 0 ? Math.max(0, ((plannedQty - moved) / plannedQty) * 100) : null;
      const rateMtPerHour = mtFactor != null ? (qty * mtFactor) / ((end - start) / 3600000) : null;
      const verdict = evaluateKurasSegment({ remainingPct, rateMtPerHour, isOpen: false, rule });
      judged.push({ startMs: start, verdict });
    }
    moved += qty;
  }

  if (!judged.length) return { kurasStartedAt: null, reason: { code: 'noHourly' } };
  let first = null;
  for (let i = judged.length - 1; i >= 0 && judged[i].verdict.movementType === 'kuras'; i--) first = judged[i];
  if (!first) return { kurasStartedAt: null, reason: { ...judged[judged.length - 1].verdict.reason, code: 'noKuras' } };
  return {
    kurasStartedAt: new Date(first.startMs).toISOString(),
    reason: { ...first.verdict.reason, code: 'kurasStart' },
  };
}

/**
 * Payload value of a line's kuras start → undefined (keep stored), 'auto', 'none' (operator says
 * no kuras) or a UTC ISO instant (manual start, checked against the entry window later).
 * @param {(raw: string) => string|null|undefined} toIso schedule-time parser (port time zone)
 */
export function parseKurasStartInput(raw, lineIndex, toIso) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '' || raw === 'auto') return { ok: true, value: 'auto' };
  if (raw === 'none') return { ok: true, value: 'none' };
  const iso = typeof raw === 'string' ? toIso(raw) : null;
  if (iso && Number.isFinite(ms(iso))) return { ok: true, value: iso };
  return { ok: false, error: `cargoLoadLines[${lineIndex}].kurasStart must be auto, none or a date-time` };
}

/** A manual kuras start must fall inside the entry (start ≤ t ≤ end; open entry: start ≤ t). */
export function kurasStartInsideEntry(iso, startIso, endIso) {
  const t = ms(iso);
  return t >= ms(startIso) && (!endIso || t <= ms(endIso));
}

/**
 * Columns to store for one segment's kuras start. Manual values survive re-saves; 'auto' hands
 * back to detection (filled in after hourly buckets refresh).
 */
export function resolveKurasStartColumns(requested, prior, actorUserId) {
  if (requested === undefined && prior) {
    return {
      startedAt: prior.kuras_started_at,
      source: prior.kuras_start_source || 'auto',
      reason: prior.kuras_start_reason,
      setBy: prior.kuras_start_set_by,
      setAt: prior.kuras_start_set_at,
    };
  }
  if (requested === undefined || requested === 'auto') {
    return { startedAt: null, source: 'auto', reason: null, setBy: null, setAt: null };
  }
  const startedAt = requested === 'none' ? null : new Date(requested).toISOString();
  const priorMs = prior?.kuras_started_at ? ms(prior.kuras_started_at) : null;
  const unchanged =
    prior?.kuras_start_source === 'manual' && (startedAt ? ms(startedAt) === priorMs : priorMs == null);
  return {
    startedAt,
    source: 'manual',
    reason: { code: 'manual' },
    setBy: unchanged ? prior.kuras_start_set_by : actorUserId,
    setAt: unchanged ? prior.kuras_start_set_at : new Date().toISOString(),
  };
}
