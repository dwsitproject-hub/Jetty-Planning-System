/**
 * Pure helpers for cache keys and TTL. No storage or platform dependencies, so
 * these are fully unit-testable under `node --test`.
 */

/**
 * Normalized cache key. Port scope is part of the key because the same path
 * returns different data per selected port.
 * @param {string} method
 * @param {string} path
 * @param {number|string|null} [portId]
 */
export function buildCacheKey(method, path, portId = null) {
  const m = String(method || 'GET').toUpperCase()
  const p = String(path || '')
  const scope = portId == null || portId === '' ? '' : ` @${portId}`
  return `${m} ${p}${scope}`
}

/**
 * A cache entry is expired when it has a positive ttl and is older than it.
 * ttlMs <= 0 (or missing) means "never expires".
 * @param {{fetchedAt:number, ttlMs?:number}|null} entry
 * @param {number} nowMs
 */
export function isExpired(entry, nowMs) {
  if (!entry) return true
  const ttl = Number(entry.ttlMs) || 0
  if (ttl <= 0) return false
  return nowMs - Number(entry.fetchedAt || 0) > ttl
}
