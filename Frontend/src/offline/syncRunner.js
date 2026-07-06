/**
 * Sync runner — replays the outbox against the server. Kept separate from the
 * seam (index.js) to avoid an import cycle: client.js → index.js, and this file
 * → client.js. The default sender uses rawRequest so replays bypass the offline
 * seam (routing them through apiPost/etc. would just re-queue while offline).
 *
 * A module-level mutex ensures only one sync runs at a time (reconnect + resume +
 * periodic triggers can otherwise overlap).
 */
import { getStore } from './store.js'
import { syncOutbox } from './sync.js'
import { patchMutation, OUTBOX_STATUS } from './outbox.js'
import { isNative, getOnline } from '../platform/index.js'

let running = false

// Lazy import so this module can be unit-tested without loading the API client
// (which reads Vite's import.meta.env at module load).
async function defaultSender(row) {
  const { rawRequest } = await import('../api/client.js')
  return rawRequest(row.method, row.path, row.body)
}

/**
 * Replay pending/failed outbox items. No-op on web, when already running, or when
 * offline. Returns the syncOutbox summary or a { skipped } reason.
 * @param {{isNative?:Function, getOnline?:Function, store?:object, sender?:Function}} [env]
 */
export async function runSync(env = {}) {
  const nativeFn = env.isNative || isNative
  const onlineFn = env.getOnline || getOnline
  if (!nativeFn()) return { skipped: 'web' }
  // Claim the mutex synchronously (before any await) so overlapping triggers see it.
  if (running) return { skipped: 'busy' }
  running = true
  try {
    if (!(await onlineFn())) return { skipped: 'offline' }
    const store = env.store || (await getStore())
    const sender = env.sender || defaultSender
    return await syncOutbox(store, sender)
  } finally {
    running = false
  }
}

/** Reset one item to pending (e.g. after a failure/conflict) and re-run sync. */
export async function retryMutation(id, env = {}) {
  const store = env.store || (await getStore())
  await patchMutation(store, id, { status: OUTBOX_STATUS.PENDING, lastError: null })
  return runSync(env)
}

export function isSyncing() {
  return running
}
