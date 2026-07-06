/**
 * Outbox replay. P1 provides the core loop; P4 enriches conflict resolution UI.
 * `sender(row)` performs the real network mutation and resolves with the server
 * response, or throws. Errors carry a `.status` (from ApiError) so we can route
 * validation (4xx) and conflict (409) outcomes without silently dropping work.
 */
import { listReplayable, patchMutation, removeMutation, OUTBOX_STATUS } from './outbox.js'

/**
 * @param {object} store
 * @param {(row:object)=>Promise<any>} sender
 * @returns {Promise<{sent:number, failed:number, conflicts:number, remaining:number}>}
 */
export async function syncOutbox(store, sender) {
  const rows = await listReplayable(store)
  let sent = 0
  let failed = 0
  let conflicts = 0

  for (const row of rows) {
    await patchMutation(store, row.id, { status: OUTBOX_STATUS.SENDING })
    try {
      await sender(row)
      await removeMutation(store, row.id)
      sent += 1
    } catch (err) {
      const status = err && typeof err === 'object' ? err.status : undefined
      const message = (err && (err.message || String(err))) || 'Sync failed'
      if (status === 409) {
        // Server changed since enqueue → surface, never overwrite blindly (P4 UI).
        await patchMutation(store, row.id, { status: OUTBOX_STATUS.CONFLICT, lastError: message })
        conflicts += 1
      } else if (typeof status === 'number' && status >= 400 && status < 500) {
        // Validation/permission error → hold for operator review, don't drop.
        await patchMutation(store, row.id, {
          status: OUTBOX_STATUS.FAILED,
          lastError: message,
          attempts: (row.attempts || 0) + 1,
        })
        failed += 1
      } else {
        // Network/5xx → keep pending for the next reconnect.
        await patchMutation(store, row.id, {
          status: OUTBOX_STATUS.PENDING,
          lastError: message,
          attempts: (row.attempts || 0) + 1,
        })
      }
    }
  }

  const remaining = (await listReplayable(store)).length
  return { sent, failed, conflicts, remaining }
}
