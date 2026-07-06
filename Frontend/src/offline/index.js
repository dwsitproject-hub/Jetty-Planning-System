/**
 * Offline seam used by the API client. On the web, and on native until the
 * registry has entries, every call passes straight through to the network — so
 * behavior is unchanged. Native + a matching policy is what activates caching
 * (reads) and queueing (writes).
 */
import { isNative, getOnline } from '../platform/index.js'
import { getStore } from './store.js'
import { matchOfflinePolicy } from './registry.js'
import { buildCacheKey } from './cacheKey.js'
import { readFreshCache, readStaleCache, writeCacheEntry } from './cache.js'
import { enqueueMutation, listReplayable, listAll, countPending, removeMutation } from './outbox.js'
import { overlayPending } from './optimistic.js'

export class OfflineUnavailableError extends Error {
  constructor(path) {
    super('This data is not available offline yet.')
    this.name = 'OfflineUnavailableError'
    this.offline = true
    this.path = path
  }
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `q_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
}

/**
 * Route a GET through the cache when a read policy applies.
 * @param {string} path
 * @param {number|string|null} portId
 * @param {() => Promise<any>} doFetch raw network fetch
 * @param {{isNative?:Function, getOnline?:Function, store?:object}} [env] test injection
 */
export async function offlineGet(path, portId, doFetch, env = {}) {
  const nativeFn = env.isNative || isNative
  const onlineFn = env.getOnline || getOnline
  if (!nativeFn()) return doFetch()
  const policy = matchOfflinePolicy('GET', path, env.policies)
  if (!policy || policy.kind !== 'read') return doFetch()

  const store = env.store || (await getStore())
  const key = buildCacheKey('GET', path, portId)
  const online = await onlineFn()

  if (online) {
    try {
      const data = await doFetch()
      await writeCacheEntry(store, { key, entity: policy.entity, payload: data, ttlMs: policy.ttlMs }, Date.now())
      return data
    } catch (err) {
      // Network failed while "online" — serve cache with pending writes overlaid.
      const stale = await readStaleCache(store, key)
      if (stale) return overlayPending(policy.entity, stale.payload, await listReplayable(store))
      throw err
    }
  }

  // Offline: prefer fresh cache, else stale, then overlay any queued writes so a
  // change made offline stays visible after the screen refetches.
  const fresh = await readFreshCache(store, key, Date.now())
  const base = fresh ? fresh.payload : (await readStaleCache(store, key))?.payload
  if (base === undefined) throw new OfflineUnavailableError(path)
  return overlayPending(policy.entity, base, await listReplayable(store))
}

/**
 * Route a mutation to the outbox when offline and a write policy applies.
 * @param {string} method
 * @param {string} path
 * @param {number|string|null} portId
 * @param {any} body
 * @param {() => Promise<any>} doFetch raw network fetch
 * @param {{isNative?:Function, getOnline?:Function, store?:object, newId?:Function}} [env] test injection
 */
export async function offlineMutate(method, path, portId, body, doFetch, env = {}) {
  const nativeFn = env.isNative || isNative
  const onlineFn = env.getOnline || getOnline
  if (!nativeFn()) return doFetch()
  const policy = matchOfflinePolicy(method, path, env.policies)
  if (!policy || policy.kind !== 'write') return doFetch()

  const online = await onlineFn()
  if (online) return doFetch()

  const store = env.store || (await getStore())
  const id = (env.newId || newId)()
  await enqueueMutation(store, { method, path, body, entity: policy.entity }, { id, nowMs: Date.now() })
  // Synthetic success so the existing UI flow proceeds. The change stays visible
  // because cached reads overlay pending writes (see optimistic.js).
  return { ok: true, queued: true, outboxId: id }
}

/* ---- Outbox visibility (pending badge + queue viewer). Native only. ---- */

export async function getOutboxSnapshot(env = {}) {
  const nativeFn = env.isNative || isNative
  if (!nativeFn()) return []
  const store = env.store || (await getStore())
  return listAll(store)
}

export async function getPendingCount(env = {}) {
  const nativeFn = env.isNative || isNative
  if (!nativeFn()) return 0
  const store = env.store || (await getStore())
  return countPending(store)
}

export async function discardMutation(id, env = {}) {
  const nativeFn = env.isNative || isNative
  if (!nativeFn()) return
  const store = env.store || (await getStore())
  await removeMutation(store, id)
}
