import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMemoryStore } from './memoryStore.js'
import { enqueueMutation, listReplayable, listAll, OUTBOX_STATUS } from './outbox.js'
import { runSync, retryMutation } from './syncRunner.js'

const nativeOnline = { isNative: () => true, getOnline: async () => true }

describe('runSync', () => {
  it('skips on web (non-native)', async () => {
    const res = await runSync({ isNative: () => false, getOnline: async () => true, store: createMemoryStore() })
    assert.deepEqual(res, { skipped: 'web' })
  })

  it('skips when offline', async () => {
    const res = await runSync({ isNative: () => true, getOnline: async () => false, store: createMemoryStore() })
    assert.deepEqual(res, { skipped: 'offline' })
  })

  it('replays queued mutations via the injected sender and clears them', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'PUT', path: '/allocation/arrival', body: { a: 1 }, entity: 'arrival' }, { id: '1', nowMs: 1 })
    await enqueueMutation(store, { method: 'POST', path: '/operations/5/depart', body: {}, entity: 'operation' }, { id: '2', nowMs: 2 })

    const sent = []
    const res = await runSync({ ...nativeOnline, store, sender: async (row) => { sent.push(`${row.method} ${row.path}`) } })

    assert.equal(res.sent, 2)
    assert.equal(res.remaining, 0)
    assert.deepEqual(sent, ['PUT /allocation/arrival', 'POST /operations/5/depart'])
    assert.equal((await listAll(store)).length, 0)
  })

  it('is mutually exclusive: a second concurrent run is skipped as busy', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/x', body: {} }, { id: '1', nowMs: 1 })
    let release
    const gate = new Promise((r) => { release = r })
    const slowSender = async () => { await gate }

    const first = runSync({ ...nativeOnline, store, sender: slowSender })
    const second = await runSync({ ...nativeOnline, store, sender: slowSender })
    assert.deepEqual(second, { skipped: 'busy' })
    release()
    await first
  })
})

describe('retryMutation', () => {
  it('resets a failed item to pending, then re-sends it', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/v', body: {} }, { id: '1', nowMs: 1 })
    // First sync fails with a validation error → item held as failed.
    await runSync({ ...nativeOnline, store, sender: async () => { const e = new Error('bad'); e.status = 400; throw e } })
    let [row] = await listReplayable(store)
    assert.equal(row.status, OUTBOX_STATUS.FAILED)

    // Retry with a sender that succeeds → item clears.
    const res = await retryMutation('1', { ...nativeOnline, store, sender: async () => ({ ok: true }) })
    assert.equal(res.sent, 1)
    assert.equal((await listAll(store)).length, 0)
  })
})
