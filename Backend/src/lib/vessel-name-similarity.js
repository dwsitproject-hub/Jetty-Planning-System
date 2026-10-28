/**
 * Close vessel names: punctuation, word order, small typos, and barge labels BG / OB / TK.
 * Numbered hulls stay distinct (LUMINOR is not LUMINOR 2).
 */

const BARGE_PREFIXES = new Set(['bg', 'ob', 'tk']);
const TYPE_PREFIXES = new Set(['bg', 'ob', 'tk', 'tb', 'mt', 'spob', 'km', 'mv', 'klm', 'bms']);
const SIMILAR_LIMIT = 8;
const MIN_QUERY_LENGTH = 4;
const MIN_BARGE_CORE = 4;
const MIN_TYPO_LENGTH = 6;
const MAX_TYPO_DISTANCE = 2;

export function normalizeVesselName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(normalized) {
  return normalized ? normalized.split(' ') : [];
}

function isNumericToken(token) {
  return /^\d+$/.test(token);
}

function significantTokens(tokenList) {
  return tokenList.filter((token) => token.length >= 3 && !isNumericToken(token));
}

function numericTokens(tokenList) {
  return tokenList.filter(isNumericToken);
}

function stripTypePrefix(tokenList) {
  if (tokenList.length > 1 && TYPE_PREFIXES.has(tokenList[0])) return tokenList.slice(1);
  return tokenList;
}

/** Core used for the BG / OB / TK rule. Null when the name starts with another type label. */
export function bargeComparisonCore(name) {
  const tokenList = tokensOf(normalizeVesselName(name));
  if (tokenList.length === 0) return null;
  if (BARGE_PREFIXES.has(tokenList[0]) && tokenList.length > 1) {
    return tokenList.slice(1).join(' ');
  }
  if (TYPE_PREFIXES.has(tokenList[0]) && tokenList.length > 1) return null;
  return tokenList.join(' ');
}

function sortedKey(tokenList) {
  return [...tokenList].sort().join(' ');
}

/** Same words, but one side has a different hull number. */
function differentHullNumber(queryTokens, storedTokens) {
  const qAlpha = sortedKey(significantTokens(stripTypePrefix(queryTokens)));
  const sAlpha = sortedKey(significantTokens(stripTypePrefix(storedTokens)));
  if (!qAlpha || qAlpha !== sAlpha) return false;
  return sortedKey(numericTokens(stripTypePrefix(queryTokens)))
    !== sortedKey(numericTokens(stripTypePrefix(storedTokens)));
}

function editDistance(a, b) {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > MAX_TYPO_DISTANCE) return MAX_TYPO_DISTANCE + 1;
  if (aLen === 0 || bLen === 0) return Math.max(aLen, bLen);
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr = new Array(bLen + 1);
  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > MAX_TYPO_DISTANCE) return MAX_TYPO_DISTANCE + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[bLen];
}

function typoDistance(queryNorm, queryTokens, storedNorm, storedTokens) {
  if (differentHullNumber(queryTokens, storedTokens)) return null;
  const queries = [queryNorm];
  const queryStripped = stripTypePrefix(queryTokens).join(' ');
  if (queryStripped && queryStripped !== queryNorm) queries.push(queryStripped);
  const stored = [storedNorm];
  const storedStripped = stripTypePrefix(storedTokens).join(' ');
  if (storedStripped && storedStripped !== storedNorm) stored.push(storedStripped);
  let best = null;
  for (const left of queries) {
    for (const right of stored) {
      if (Math.max(left.length, right.length) < MIN_TYPO_LENGTH) continue;
      const distance = editDistance(left, right);
      if (distance >= 1 && distance <= MAX_TYPO_DISTANCE && (best == null || distance < best)) {
        best = distance;
      }
    }
  }
  return best;
}

function codesEqual(left, right) {
  const a = String(left ?? '').trim().toLowerCase();
  const b = String(right ?? '').trim().toLowerCase();
  return a.length > 0 && a === b;
}

function toMatch(row, reason, score) {
  return {
    score,
    id: row.id,
    vesselName: row.vesselName,
    vesselType: row.vesselType ?? null,
    hubCode: row.hubCode ?? null,
    isActive: row.isActive !== false,
    reason,
  };
}

/**
 * @param {{ name?: string, imo?: string|null, mmsi?: string|null, excludeId?: number|null }} query
 * @param {Array<{ id: number, vesselName: string, vesselType?: string|null, hubCode?: string|null, isActive?: boolean, vesselImo?: string|null, vesselMmsi?: string|null }>} candidates
 */
export function rankSimilarVessels(query, candidates, limit = SIMILAR_LIMIT) {
  const name = String(query?.name ?? '').trim();
  const normalized = normalizeVesselName(name);
  const queryTokens = tokensOf(normalized);
  const nameReady = normalized.length >= MIN_QUERY_LENGTH;
  const bargeCore = nameReady ? bargeComparisonCore(name) : null;
  const scored = [];

  for (const row of candidates || []) {
    if (!row?.vesselName) continue;
    if (query?.excludeId != null && Number(row.id) === Number(query.excludeId)) continue;

    const storedNorm = normalizeVesselName(row.vesselName);
    const storedTokens = tokensOf(storedNorm);
    let match = null;

    if (name && name.toLowerCase() === String(row.vesselName).trim().toLowerCase()) {
      match = toMatch(row, 'exact', 100);
    } else if (nameReady && bargeCore && bargeCore.length >= MIN_BARGE_CORE) {
      const storedCore = bargeComparisonCore(row.vesselName);
      if (storedCore && storedCore.length >= MIN_BARGE_CORE && storedCore === bargeCore) {
        match = toMatch(row, 'barge_label', 80);
      }
    }

    if (!match && nameReady && !differentHullNumber(queryTokens, storedTokens)) {
      const significant = significantTokens(queryTokens);
      const storedSet = new Set(storedTokens);
      if (significant.length > 0 && significant.every((token) => storedSet.has(token))) {
        const storedSignificant = significantTokens(stripTypePrefix(storedTokens));
        const extra = storedSignificant.filter((token) => !significant.includes(token)).length;
        const score = storedNorm === normalized ? 78 : 64 - extra * 8;
        match = toMatch(row, 'similar_name', score);
      }
    }

    if (!match && nameReady) {
      const distance = typoDistance(normalized, queryTokens, storedNorm, storedTokens);
      if (distance != null) match = toMatch(row, 'typo', 40 - distance);
    }

    if (!match && codesEqual(query?.imo, row.vesselImo)) match = toMatch(row, 'imo', 90);
    if (!match && codesEqual(query?.mmsi, row.vesselMmsi)) match = toMatch(row, 'mmsi', 88);

    if (match) scored.push(match);
  }

  scored.sort((a, b) => b.score - a.score || String(a.vesselName).localeCompare(String(b.vesselName)));
  return scored.slice(0, limit).map(({ score, ...match }) => match);
}
