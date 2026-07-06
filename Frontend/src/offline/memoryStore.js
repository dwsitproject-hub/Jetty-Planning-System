/**
 * In-memory store backend. Used by unit tests and as a last-resort fallback when
 * neither IndexedDB nor a native store is available. Implements the store
 * interface shared with the IndexedDB backend.
 */
export function createMemoryStore() {
  const cache = new Map()
  const outbox = new Map()
  const meta = new Map()
  return {
    async cacheGet(key) {
      return cache.has(key) ? { ...cache.get(key) } : null
    },
    async cachePut(entry) {
      cache.set(entry.key, { ...entry })
    },
    async cacheDelete(key) {
      cache.delete(key)
    },
    async cacheClear() {
      cache.clear()
    },
    async outboxPut(row) {
      outbox.set(row.id, { ...row })
    },
    async outboxAll() {
      return [...outbox.values()].map((r) => ({ ...r }))
    },
    async outboxDelete(id) {
      outbox.delete(id)
    },
    async metaGet(key) {
      return meta.has(key) ? meta.get(key) : null
    },
    async metaPut(key, value) {
      meta.set(key, value)
    },
  }
}
