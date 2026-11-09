/**
 * Management Dashboard avg flow — same moved qty / logged hours as Ops Live (ATG, hybrid, manual, solid).
 */

import {
  cargoWindowFromLines,
  loadOperationProgressContext,
  summarizeCargoProgressContext,
} from './operational-progress.js';

/** Match Frontend productKeyFromCommodity. */
export function productKeyFromCommodityLabel(commodity) {
  const s = String(commodity ?? '').trim();
  if (!s) return 'Unknown';
  return s.toUpperCase();
}

/** Group when set, otherwise short name then long name. Matches the dashboard slice key. */
export function lineProductKey(line) {
  const group = String(line?.commodityGroup ?? '').trim();
  if (group) return productKeyFromCommodityLabel(group);
  const label = line?.commodityShortName || line?.commodityName || '';
  return productKeyFromCommodityLabel(label);
}

/** @param {object} line */
export function lineMatchesProductKey(line, productKey) {
  const want = productKeyFromCommodityLabel(productKey);
  if (!want || want === 'UNKNOWN') return false;
  if (!line?.commodityId) return false;
  return lineProductKey(line) === want;
}

/**
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 */
export function siProductKeysNormalized(ctx) {
  return (ctx?.siProductKeys || [])
    .map((k) => productKeyFromCommodityLabel(k))
    .filter((k) => k && k !== 'Unknown');
}

/**
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 */
export function isMultiProductOperation(ctx) {
  return siProductKeysNormalized(ctx).length > 1;
}

/**
 * Per-product line scope: tagged segments always; untagged segments only on single-product SIs.
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 * @param {string} productKey
 */
export function linesForProductRate(ctx, productKey) {
  const want = productKeyFromCommodityLabel(productKey);
  const siKeys = siProductKeysNormalized(ctx);
  const singleProductKey = siKeys.length === 1 ? siKeys[0] : null;
  const allowUntagged = !isMultiProductOperation(ctx) && singleProductKey === want;

  return contributingCargoLines(ctx?.lines).filter((line) => {
    if (lineMatchesProductKey(line, want)) return true;
    if (allowUntagged && !line.commodityId) return true;
    return false;
  });
}

/**
 * Lines that contribute to cargo rate (started + tanks, or closed tankless manual qty).
 * @param {Array<object>} lines
 */
export function contributingCargoLines(lines = []) {
  return (lines || []).filter((l) => {
    if (!l?.startedAt) return false;
    if (l.tankIds?.length > 0) return true;
    const qty = Number(l.qty) || Number(l.manualQty) || 0;
    return Boolean(l.endedAt) && qty > 0;
  });
}

/**
 * Product keys to compute per-product rates for (SI breakdown + tagged load lines).
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 */
export function productKeysForRates(ctx) {
  const keys = new Set(siProductKeysNormalized(ctx));
  for (const line of contributingCargoLines(ctx?.lines)) {
    if (line.commodityId) keys.add(lineProductKey(line));
  }
  return [...keys];
}

/**
 * @param {Awaited<ReturnType<typeof summarizeCargoProgressContext>>|null} summary
 * @param {Array<object>} windowLines
 * @param {number} [nowMs]
 */
export function buildCargoRateResult(summary, windowLines, nowMs = Date.now()) {
  const meta = { source: summary?.source ?? null, atgPartial: summary?.atgPartial ?? false };
  if (!summary || !(Number(summary.movedQty) > 0)) {
    return {
      movedQty: null,
      loggedHours: null,
      rateMtH: null,
      activeHours: null,
      activeRateMtH: null,
      ...meta,
      firstLoggedAt: null,
      lastLoggedAt: null,
    };
  }

  const { firstLoggedAt, lastLoggedAt } = cargoWindowFromLines(windowLines);
  const rateEndAt =
    summary.isLive || summary.hasActiveCargo ? new Date(nowMs).toISOString() : lastLoggedAt;
  const movedQty = Number(summary.movedQty) || 0;
  const startMs = firstLoggedAt ? new Date(firstLoggedAt).getTime() : NaN;
  const endMs = rateEndAt ? new Date(rateEndAt).getTime() : NaN;
  const windowHours = Number.isFinite(startMs) && Number.isFinite(endMs) ? (endMs - startMs) / HOUR_MS : 0;
  const activeHours = activeCargoHours(windowLines, endMs);

  return {
    movedQty,
    loggedHours: roundedHours(windowHours),
    rateMtH: rateOrNull(movedQty, windowHours),
    activeHours: roundedHours(activeHours),
    activeRateMtH: rateOrNull(movedQty, activeHours),
    ...meta,
    firstLoggedAt,
    lastLoggedAt: rateEndAt,
  };
}

const HOUR_MS = 3600000;

function roundedHours(hours) {
  return hours > 0 ? +hours.toFixed(2) : null;
}

function rateOrNull(qty, hours) {
  return qty > 0 && hours > 0 ? +(qty / hours).toFixed(2) : null;
}

/**
 * Hours when at least one cargo segment was running (union of segment windows).
 * Gaps between segments are excluded; overlapping tank segments count once.
 * Open segments end at `openEndMs` (now for live cargo, else the last logged end).
 * @param {Array<{ startedAt?: string|null, endedAt?: string|null }>} lines
 * @param {number} openEndMs
 */
export function activeCargoHours(lines = [], openEndMs = NaN) {
  const spans = (lines || [])
    .map((l) => {
      const s = l?.startedAt ? new Date(l.startedAt).getTime() : NaN;
      const e = l?.endedAt ? new Date(l.endedAt).getTime() : openEndMs;
      return [s, e];
    })
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);

  let totalMs = 0;
  let curStart = null;
  let curEnd = null;
  for (const [s, e] of spans) {
    if (curEnd != null && s <= curEnd) {
      curEnd = Math.max(curEnd, e);
      continue;
    }
    if (curEnd != null) totalMs += curEnd - curStart;
    curStart = s;
    curEnd = e;
  }
  if (curEnd != null) totalMs += curEnd - curStart;
  return totalMs / HOUR_MS;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Awaited<ReturnType<typeof loadOperationProgressContext>>} ctx
 * @param {object} [opts]
 */
export async function computeCargoRateFromContext(db, ctx, opts = {}) {
  if (!ctx) return null;
  const lines = contributingCargoLines(ctx.lines);
  if (!lines.length) return null;

  const summary = await summarizeCargoProgressContext(db, ctx, opts);
  return buildCargoRateResult(summary, lines, opts.nowMs);
}

/**
 * Voyage-level rate (all cargo load lines) — fleet KPI Option A.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 * @param {object} [opts]
 */
export async function computeVoyageCargoRate(db, operationId, opts = {}) {
  const ctx = await loadOperationProgressContext(db, operationId);
  return computeCargoRateFromContext(db, ctx, opts);
}

/**
 * Per-product rate (commodity-tagged lines only).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} operationId
 * @param {string} productKey
 * @param {object} [opts]
 */
export async function computeProductCargoRate(db, operationId, productKey, opts = {}) {
  const ctx = await loadOperationProgressContext(db, operationId);
  if (!ctx) return null;

  const filtered = linesForProductRate(ctx, productKey);
  if (!filtered.length) return null;

  const scopedCtx = { ...ctx, lines: filtered };
  const summary = await summarizeCargoProgressContext(db, scopedCtx, opts);
  return buildCargoRateResult(summary, filtered, opts.nowMs);
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Array<number|string>} operationIds
 * @param {object} [opts]
 */
export async function computeCargoRatesBulk(db, operationIds, opts = {}) {
  const concurrency = opts.concurrency ?? 5;
  const ids = [...new Set((operationIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  /** @type {Record<string, { voyage: Awaited<ReturnType<typeof computeVoyageCargoRate>>, byProduct: Record<string, Awaited<ReturnType<typeof computeProductCargoRate>>> }>} */
  const rates = {};

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const pairs = await Promise.all(
      batch.map(async (id) => {
        try {
          const ctx = await loadOperationProgressContext(db, id);
          if (!ctx) return [String(id), null];
          const voyage = await computeCargoRateFromContext(db, ctx, opts);
          const byProduct = {};
          for (const pk of productKeysForRates(ctx)) {
            const filtered = linesForProductRate(ctx, pk);
            const scopedCtx = { ...ctx, lines: filtered };
            const summary = await summarizeCargoProgressContext(db, scopedCtx, opts);
            byProduct[pk] = buildCargoRateResult(summary, filtered, opts.nowMs);
          }
          return [String(id), { voyage, byProduct }];
        } catch (err) {
          console.error('[management-cargo-rates]', id, err?.message || err);
          return [String(id), null];
        }
      })
    );
    for (const [id, entry] of pairs) {
      rates[id] = entry;
    }
  }

  return { rates };
}
