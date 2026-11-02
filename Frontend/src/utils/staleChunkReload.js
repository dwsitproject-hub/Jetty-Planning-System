const STALE_CHUNK_RELOAD_KEY = 'jps-stale-chunk-reload'

/** After a frontend deploy, cached entry chunks may request lazy chunks that no longer exist (404). */
export function isStaleLazyChunkError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  )
}

/** Full reload once per tab session so index.html picks up the current hashed assets. */
export function reloadOnceForStaleChunks() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return false
  if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) return false
  sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, '1')
  window.location.reload()
  return true
}

export function clearStaleChunkReloadFlag() {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY)
  } catch {
    /* ignore */
  }
}
