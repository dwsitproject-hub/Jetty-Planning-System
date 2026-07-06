/**
 * IndexedDB store backend. Works identically in the browser and inside the
 * Android WebView (Capacitor), so v1 uses a single storage implementation for
 * both. Object stores mirror the logical tables: cache, outbox, meta.
 */
const DB_NAME = 'jps-offline'
const DB_VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName)
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createIdbStore() {
  return {
    async cacheGet(key) {
      const db = await openDb()
      return (await reqToPromise(tx(db, 'cache', 'readonly').get(key))) ?? null
    },
    async cachePut(entry) {
      const db = await openDb()
      await reqToPromise(tx(db, 'cache', 'readwrite').put(entry))
    },
    async cacheDelete(key) {
      const db = await openDb()
      await reqToPromise(tx(db, 'cache', 'readwrite').delete(key))
    },
    async cacheClear() {
      const db = await openDb()
      await reqToPromise(tx(db, 'cache', 'readwrite').clear())
    },
    async outboxPut(row) {
      const db = await openDb()
      await reqToPromise(tx(db, 'outbox', 'readwrite').put(row))
    },
    async outboxAll() {
      const db = await openDb()
      return (await reqToPromise(tx(db, 'outbox', 'readonly').getAll())) ?? []
    },
    async outboxDelete(id) {
      const db = await openDb()
      await reqToPromise(tx(db, 'outbox', 'readwrite').delete(id))
    },
    async metaGet(key) {
      const db = await openDb()
      const row = await reqToPromise(tx(db, 'meta', 'readonly').get(key))
      return row ? row.value : null
    },
    async metaPut(key, value) {
      const db = await openDb()
      await reqToPromise(tx(db, 'meta', 'readwrite').put({ key, value }))
    },
  }
}
