/**
 * Management Dashboard avg flow — same moved qty / logged hours as Ops Live (ATG, hybrid, manual, solid).
 */

import {
  cargoWindowFromLines,
  computeAvgRateTph,
  loadOperationProgressContext,
  summarizeCargoProgressContext,
} from './operational-progress.js';

/** Match Frontend productKeyFromCommodity. */
export function productKeyFromCommodityLabel(commodity) {
  const s = String(commodity ?? '').trim();
  if (!s) return 'Unknown';
  return s.toUpperCase();
}

/** @param {object} line */
export function lineProductKey(line) {
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
  if (!summary || !(Number(summary.movedQty) > 0)) {
    return {
      movedQty: null,
      loggedHours: null,
      rateMtH: null,
      source: summary?.source ?? null,
      atgPartial: summary?.atgPartial ?? false,
      firstLoggedAt: null,
      lastLoggedAt: null,
    };
  }

  const { firstLoggedAt, lastLoggedAt } = cargoWindowFromLines(windowLines);
  const rateEndAt =
    summary.isLive || summary.hasActiveCargo ? new Date(nowMs).toISOString() : lastLoggedAt;
  const movedQty = Number(summary.movedQty) || 0;
  const rateMtH = computeAvgRateTph(movedQty, firstLoggedAt, rateEndAt);
  const startMs = firstLoggedAt ? new Date(firstLoggedAt).getTime() : NaN;
  const endMs = rateEndAt ? new Date(rateEndAt).getTime() : NaN;
  const loggedHours =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? +((endMs - startMs) / 3600000).toFixed(2)
      : null;

  if (loggedHours == null || !(loggedHours > 0) || !(rateMtH > 0)) {
    return {
      movedQty: movedQty > 0 ? movedQty : null,
      loggedHours: loggedHours > 0 ? loggedHours : null,
      rateMtH: null,
      source: summary.source ?? null,
      atgPartial: summary.atgPartial ?? false,
      firstLoggedAt,
      lastLoggedAt: rateEndAt,
    };
  }

  return {
    movedQty,
    loggedHours,
    rateMtH: +rateMtH.toFixed(2),
    source: summary.source ?? null,
    atgPartial: summary.atgPartial ?? false,
    firstLoggedAt,
    lastLoggedAt: rateEndAt,
  };
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
