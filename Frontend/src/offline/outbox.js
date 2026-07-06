/**
 * Outbox operations — queued mutations to replay on reconnect. Storage-agnostic
 * (store passed in) and deterministic (id + nowMs injectable) for testing.
 */

export const OUTBOX_STATUS = {
  PENDING: 'pending',
  SENDING: 'sending',
  FAILED: 'failed',
  CONFLICT: 'conflict',
}

/**
 * @param {object} store
 * @param {{method:string, path:string, body?:any, entity?:string|null, baseVersion?:any}} req
 * @param {{id:string, nowMs:number}} ctx
 * @returns {Promise<object>} the stored row
 */
export async function enqueueMutation(store, req, { id, nowMs }) {
  const row = {
    id,
    createdAt: nowMs,
    method: String(req.method || 'POST').toUpperCase(),
    path: req.path,
    body: req.body ?? null,
    entity: req.entity ?? null,
    baseVersion: req.baseVersion ?? null,
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    lastError: null,
  }
  await store.outboxPut(row)
  return row
}

/** Pending + failed rows, oldest first (replay order). */
export async function listReplayable(store) {
  const all = await store.outboxAll()
  return all
    .filter((r) => r.status === OUTBOX_STATUS.PENDING || r.status === OUTBOX_STATUS.FAILED)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** All rows, oldest first (for a queue viewer). */
export async function listAll(store) {
  const all = await store.outboxAll()
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function countPending(store) {
  return (await listReplayable(store)).length
}

export async function patchMutation(store, id, patch) {
  const all = await store.outboxAll()
  const row = all.find((r) => r.id === id)
  if (!row) return null
  const next = { ...row, ...patch }
  await store.outboxPut(next)
  return next
}

export async function removeMutation(store, id) {
  await store.outboxDelete(id)
}
