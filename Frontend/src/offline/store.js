/**
 * Store selection. Uses IndexedDB when available (browser + Android WebView),
 * else an in-memory store (unit tests / unusual environments). The chosen store
 * is memoized. Tests can inject a store via __setStoreForTests().
 */
import { createIdbStore } from './idbStore.js'
import { createMemoryStore } from './memoryStore.js'

let storePromise = null

export function getStore() {
  if (!storePromise) {
    const hasIdb = typeof indexedDB !== 'undefined' && indexedDB !== null
    storePromise = Promise.resolve(hasIdb ? createIdbStore() : createMemoryStore())
  }
  return storePromise
}

/** Test hook: force a specific store implementation. */
export function __setStoreForTests(store) {
  storePromise = Promise.resolve(store)
}
