/**
 * Read-through cache operations. Storage-agnostic: the store is passed in, so
 * these are testable with the in-memory store.
 */
import { isExpired } from './cacheKey.js'

/**
 * Return a non-expired cache entry, or null.
 * @param {object} store
 * @param {string} key
 * @param {number} nowMs
 */
export async function readFreshCache(store, key, nowMs) {
  const entry = await store.cacheGet(key)
  if (!entry) return null
  if (isExpired(entry, nowMs)) return null
  return entry
}

/**
 * Return any cache entry regardless of TTL (used as a last resort when a network
 * fetch fails offline). null if none.
 */
export async function readStaleCache(store, key) {
  return store.cacheGet(key)
}

/**
 * @param {object} store
 * @param {{key:string, entity?:string|null, payload:any, ttlMs?:number}} input
 * @param {number} nowMs
 */
export async function writeCacheEntry(store, { key, entity = null, payload, ttlMs = 0 }, nowMs) {
  await store.cachePut({ key, entity, payload, fetchedAt: nowMs, ttlMs: Number(ttlMs) || 0 })
}
