import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchOfflinePolicy, OFFLINE_POLICY } from './registry.js'
import { buildCacheKey, isExpired } from './cacheKey.js'
import { createMemoryStore } from './memoryStore.js'
import { readFreshCache, readStaleCache, writeCacheEntry } from './cache.js'
import {
  enqueueMutation,
  listReplayable,
  countPending,
  patchMutation,
  OUTBOX_STATUS,
} from './outbox.js'
import { syncOutbox } from './sync.js'
import { offlineGet, offlineMutate, OfflineUnavailableError } from './index.js'
import { applyArrivalOverlay, overlayPending } from './optimistic.js'

const POLICIES = [
  { match: /^\/allocation\/plan-overview/, read: 'cache', entity: 'alloc', ttlMs: 1000 },
  { match: /^\/allocation\/arrival$/, write: 'outbox', entity: 'arrival' },
]

describe('registry.matchOfflinePolicy', () => {
  it('matches GET read policies', () => {
    const p = matchOfflinePolicy('GET', '/allocation/plan-overview?x=1', POLICIES)
    assert.equal(p?.kind, 'read')
    assert.equal(p.entity, 'alloc')
  })
  it('matches non-GET write policies', () => {
    const p = matchOfflinePolicy('PUT', '/allocation/arrival', POLICIES)
    assert.equal(p?.kind, 'write')
    assert.equal(p.entity, 'arrival')
  })
  it('returns null when no rule matches', () => {
    assert.equal(matchOfflinePolicy('GET', '/admin/users', POLICIES), null)
  })
  it('returns null for a method the matched rule does not cover', () => {
    // arrival rule is write-only; a GET to it has no read policy
    assert.equal(matchOfflinePolicy('GET', '/allocation/arrival', POLICIES), null)
  })
  it('uses the real default policy set when none is passed (online-only endpoints pass through)', () => {
    assert.equal(matchOfflinePolicy('GET', '/notifications/unread-count'), null)
  })
})

describe('OFFLINE_POLICY (P2 read scope)', () => {
  const readable = (path) => matchOfflinePolicy('GET', path, OFFLINE_POLICY)?.kind === 'read'

  it('caches the field-scope + context reads', () => {
    const cached = [
      '/users/me',
      '/users/me/ports',
      '/rbac/me/page-permissions',
      '/allocation/overview',
      '/allocation/plan-overview?from=2026-07-01',
      '/operations?status=at-berth',
      '/operations/at-berth',
      '/operations/123',
      '/operations/123/operational-activities',
      '/shipment-plans',
      '/shipment-plans/14',
      '/shipping-instructions',
      '/shipping-instructions/9',
      '/ports',
      '/jetties',
      '/jetty-layout',
      '/si-lookups',
      '/si-lookups/shippers',
      '/master/cargo-handling-methods',
    ]
    for (const p of cached) assert.equal(readable(p), true, `expected cached: ${p}`)
  })

  it('leaves online-only endpoints uncached', () => {
    const online = [
      '/notifications/unread-count',
      '/activity-logs?page=1',
      '/dashboard-v2/weekly-trends',
      '/integration-admin',
      '/rbac/roles',
      '/sla-config',
      '/users',
      '/admin/users/5/sso-status',
    ]
    for (const p of online) assert.equal(readable(p), false, `expected online-only: ${p}`)
  })

  it('does not make read-only endpoints writable', () => {
    assert.equal(matchOfflinePolicy('POST', '/allocation/overview', OFFLINE_POLICY), null)
    assert.equal(matchOfflinePolicy('PUT', '/ports/1', OFFLINE_POLICY), null)
    assert.equal(matchOfflinePolicy('PUT', '/shipment-plans/14', OFFLINE_POLICY), null)
  })
})

describe('cacheKey', () => {
  it('builds a normalized, port-scoped key', () => {
    assert.equal(buildCacheKey('get', '/ports', 5), 'GET /ports @5')
    assert.equal(buildCacheKey('GET', '/ports'), 'GET /ports')
  })
  it('isExpired honors ttl; ttl<=0 never expires', () => {
    assert.equal(isExpired({ fetchedAt: 0, ttlMs: 100 }, 50), false)
    assert.equal(isExpired({ fetchedAt: 0, ttlMs: 100 }, 200), true)
    assert.equal(isExpired({ fetchedAt: 0, ttlMs: 0 }, 1e9), false)
    assert.equal(isExpired(null, 1), true)
  })
})

describe('cache read/write', () => {
  it('writes then reads fresh; returns null once expired but stale still available', async () => {
    const store = createMemoryStore()
    await writeCacheEntry(store, { key: 'k', entity: 'e', payload: { a: 1 }, ttlMs: 100 }, 1000)
    const fresh = await readFreshCache(store, 'k', 1050)
    assert.deepEqual(fresh.payload, { a: 1 })
    assert.equal(await readFreshCache(store, 'k', 2000), null)
    const stale = await readStaleCache(store, 'k')
    assert.deepEqual(stale.payload, { a: 1 })
  })
})

describe('outbox', () => {
  it('enqueues pending rows and lists them oldest-first', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/a', body: { n: 2 } }, { id: 'b', nowMs: 20 })
    await enqueueMutation(store, { method: 'POST', path: '/a', body: { n: 1 } }, { id: 'a', nowMs: 10 })
    const rows = await listReplayable(store)
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b'])
    assert.equal(await countPending(store), 2)
    assert.equal(rows[0].status, OUTBOX_STATUS.PENDING)
  })
})

describe('syncOutbox', () => {
  it('removes rows that send successfully', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/ok' }, { id: '1', nowMs: 1 })
    const res = await syncOutbox(store, async () => ({ ok: true }))
    assert.deepEqual(res, { sent: 1, failed: 0, conflicts: 0, remaining: 0 })
  })

  it('keeps 5xx/network errors pending for retry', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/x' }, { id: '1', nowMs: 1 })
    const res = await syncOutbox(store, async () => {
      const e = new Error('boom')
      e.status = 500
      throw e
    })
    assert.equal(res.sent, 0)
    assert.equal(res.remaining, 1)
    const [row] = await listReplayable(store)
    assert.equal(row.status, OUTBOX_STATUS.PENDING)
    assert.equal(row.attempts, 1)
  })

  it('flags 409 as conflict (not replayable, surfaced)', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'PUT', path: '/c' }, { id: '1', nowMs: 1 })
    const res = await syncOutbox(store, async () => {
      const e = new Error('conflict')
      e.status = 409
      throw e
    })
    assert.equal(res.conflicts, 1)
    assert.equal(res.remaining, 0) // conflict is not in the replay set
    const row = await patchMutation(store, '1', {})
    assert.equal(row.status, OUTBOX_STATUS.CONFLICT)
  })

  it('marks 4xx validation errors failed (held for review, not dropped)', async () => {
    const store = createMemoryStore()
    await enqueueMutation(store, { method: 'POST', path: '/v' }, { id: '1', nowMs: 1 })
    const res = await syncOutbox(store, async () => {
      const e = new Error('bad')
      e.status = 400
      throw e
    })
    assert.equal(res.failed, 1)
    const row = await patchMutation(store, '1', {})
    assert.equal(row.status, OUTBOX_STATUS.FAILED)
    assert.equal(row.lastError, 'bad')
  })
})

describe('offlineGet seam', () => {
  const readPolicies = [{ match: /^\/ports/, read: 'cache', entity: 'ports', ttlMs: 1000 }]
  const native = { isNative: () => true, getOnline: async () => true, policies: readPolicies }

  it('web (non-native) passes straight through, never touching the store', async () => {
    let fetched = 0
    const store = createMemoryStore()
    const out = await offlineGet('/ports', 1, async () => { fetched++; return { data: 1 } }, {
      isNative: () => false,
      store,
    })
    assert.deepEqual(out, { data: 1 })
    assert.equal(fetched, 1)
    assert.equal(await store.cacheGet('GET /ports @1'), null)
  })

  it('native + online caches the fetched response', async () => {
    const store = createMemoryStore()
    const out = await offlineGet('/ports', 1, async () => ({ v: 42 }), { ...native, store })
    assert.deepEqual(out, { v: 42 })
    const entry = await store.cacheGet('GET /ports @1')
    assert.deepEqual(entry.payload, { v: 42 })
  })

  it('native + offline returns the cached payload without fetching', async () => {
    const store = createMemoryStore()
    await offlineGet('/ports', 1, async () => ({ v: 1 }), { ...native, store }) // seed
    let fetched = 0
    const out = await offlineGet('/ports', 1, async () => { fetched++; return { v: 2 } }, {
      ...native,
      getOnline: async () => false,
      store,
    })
    assert.deepEqual(out, { v: 1 })
    assert.equal(fetched, 0)
  })

  it('native + offline with no cache throws OfflineUnavailableError', async () => {
    const store = createMemoryStore()
    await assert.rejects(
      () => offlineGet('/ports', 9, async () => ({}), { ...native, getOnline: async () => false, store }),
      OfflineUnavailableError
    )
  })

  it('native + online falls back to stale cache when the fetch fails', async () => {
    const store = createMemoryStore()
    await offlineGet('/ports', 1, async () => ({ v: 'old' }), { ...native, store }) // seed
    const out = await offlineGet('/ports', 1, async () => { throw new Error('net') }, { ...native, store })
    assert.deepEqual(out, { v: 'old' })
  })

  it('native but no matching policy passes through', async () => {
    let fetched = 0
    const out = await offlineGet('/admin/users', 1, async () => { fetched++; return { ok: 1 } }, {
      ...native,
      getOnline: async () => false,
    })
    assert.deepEqual(out, { ok: 1 })
    assert.equal(fetched, 1)
  })
})

describe('offlineMutate seam', () => {
  const writePolicies = [{ match: /^\/allocation\/arrival$/, write: 'outbox', entity: 'arrival' }]
  const native = { isNative: () => true, policies: writePolicies, newId: () => 'fixed-id' }

  it('native + offline queues the mutation and returns a synthetic success', async () => {
    const store = createMemoryStore()
    let fetched = 0
    const out = await offlineMutate('PUT', '/allocation/arrival', 1, { a: 1 }, async () => { fetched++ }, {
      ...native,
      getOnline: async () => false,
      store,
    })
    assert.equal(out.queued, true)
    assert.equal(out.outboxId, 'fixed-id')
    assert.equal(fetched, 0)
    const rows = await listReplayable(store)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].path, '/allocation/arrival')
    assert.deepEqual(rows[0].body, { a: 1 })
  })

  it('native + online sends immediately (no queue)', async () => {
    const store = createMemoryStore()
    let fetched = 0
    await offlineMutate('PUT', '/allocation/arrival', 1, {}, async () => { fetched++; return { ok: 1 } }, {
      ...native,
      getOnline: async () => true,
      store,
    })
    assert.equal(fetched, 1)
    assert.equal((await listReplayable(store)).length, 0)
  })

  it('offline but no write policy passes through (does not queue)', async () => {
    const store = createMemoryStore()
    let fetched = 0
    await offlineMutate('POST', '/some/other', 1, {}, async () => { fetched++ }, {
      ...native,
      getOnline: async () => false,
      store,
    })
    assert.equal(fetched, 1)
    assert.equal((await listReplayable(store)).length, 0)
  })

  it('web (non-native) always sends through', async () => {
    let fetched = 0
    await offlineMutate('PUT', '/allocation/arrival', 1, {}, async () => { fetched++ }, {
      isNative: () => false,
      getOnline: async () => false,
    })
    assert.equal(fetched, 1)
  })
})

describe('OFFLINE_POLICY (P3 write scope)', () => {
  const writable = (method, path) => matchOfflinePolicy(method, path, OFFLINE_POLICY)?.kind === 'write'

  it('queues the field-scope writes', () => {
    assert.equal(writable('PUT', '/allocation/arrival'), true)
    assert.equal(writable('POST', '/allocation/shipment-plans/swap-berthing-sequence'), true)
    assert.equal(writable('PUT', '/operations/123'), true)
    assert.equal(writable('POST', '/operations/123/operational-activities'), true)
    assert.equal(writable('PUT', '/operations/123/nor-details'), true)
    assert.equal(writable('DELETE', '/operations/123/materials/5'), true)
    assert.equal(writable('PUT', '/quantity-checks/9'), true)
    assert.equal(writable('PUT', '/qc-surveys/9'), true)
  })

  it('leaves create/admin writes online-only', () => {
    assert.equal(writable('POST', '/operations'), false) // create (no trailing slash)
    assert.equal(writable('POST', '/shipment-plans'), false)
    assert.equal(writable('POST', '/shipping-instructions'), false)
    assert.equal(writable('POST', '/ports'), false)
    assert.equal(writable('POST', '/users'), false)
    assert.equal(writable('PATCH', '/notifications/read'), false)
  })

  it('still serves GET reads on write-covered operation paths', () => {
    assert.equal(matchOfflinePolicy('GET', '/operations/123', OFFLINE_POLICY)?.kind, 'read')
  })
})

describe('optimistic overlay (arrival)', () => {
  const payload = {
    queue: [
      { vesselId: 'op-9', operationId: 9, shipmentPlanId: 14, etaDateTime: '2026-07-01T00:00:00Z', jetty: '1A' },
      { vesselId: 'op-8', operationId: 8, shipmentPlanId: 13, jetty: '2A' },
    ],
    scheduleQueue: [
      { vesselId: 'op-9', operationId: 9, shipmentPlanId: 14, tbDateTime: '2026-07-02T00:00:00Z', jetty: '1A' },
    ],
    berths: [{ id: '1A' }],
  }

  it('merges queued arrival fields onto matching rows and flags them', () => {
    const pending = [
      { entity: 'arrival', body: { operationId: 9, etaDateTime: '2026-07-05T06:00:00Z', etbDateTime: '2026-07-05T10:00:00Z', jetty: '3B' } },
    ]
    const out = applyArrivalOverlay(payload, pending)
    const q = out.queue.find((r) => r.operationId === 9)
    assert.equal(q.etaDateTime, '2026-07-05T06:00:00Z')
    assert.equal(q.etbDateTime, '2026-07-05T10:00:00Z')
    assert.equal(q.plannedEtbDateTime, '2026-07-05T10:00:00Z') // kept in sync for the Gantt
    assert.equal(q.jetty, '3B')
    assert.equal(q.__pendingSync, true)
    // non-matching row untouched
    assert.equal(out.queue.find((r) => r.operationId === 8).jetty, '2A')
    // scheduleQueue row also patched
    assert.equal(out.scheduleQueue[0].jetty, '3B')
  })

  it('matches by shipmentPlanId when operationId is absent', () => {
    const out = applyArrivalOverlay(payload, [{ entity: 'arrival', body: { shipmentPlanId: 14, taDateTime: '2026-07-06T00:00:00Z' } }])
    assert.equal(out.queue.find((r) => r.shipmentPlanId === 14).taDateTime, '2026-07-06T00:00:00Z')
  })

  it('is defensive: bad payloads return unchanged, never throw', () => {
    assert.equal(applyArrivalOverlay(null, [{ entity: 'arrival', body: { operationId: 9 } }]), null)
    assert.deepEqual(applyArrivalOverlay({ queue: 'nope' }, [{ entity: 'arrival', body: {} }]), { queue: 'nope', scheduleQueue: undefined })
  })

  it('overlayPending ignores unknown entities and empty queues', () => {
    assert.deepEqual(overlayPending('operations', payload, [{ entity: 'operation' }]), payload)
    assert.deepEqual(overlayPending('allocation-overview', payload, []), payload)
  })
})

describe('offlineGet applies overlay to cached allocation reads', () => {
  const policies = [{ match: /^\/allocation\/plan-overview/, read: 'cache', entity: 'allocation-overview', ttlMs: 0 }]

  it('offline read reflects a queued arrival change', async () => {
    const store = createMemoryStore()
    const native = { isNative: () => true, store, policies }
    // seed cache online
    await offlineGet('/allocation/plan-overview', 1, async () => ({
      queue: [{ operationId: 9, shipmentPlanId: 14, jetty: '1A' }],
      scheduleQueue: [],
    }), { ...native, getOnline: async () => true })
    // queue an arrival write
    await enqueueMutation(store, { method: 'PUT', path: '/allocation/arrival', body: { operationId: 9, jetty: '3B' }, entity: 'arrival' }, { id: 'm1', nowMs: 1 })
    // offline read shows the pending change
    const out = await offlineGet('/allocation/plan-overview', 1, async () => ({}), { ...native, getOnline: async () => false })
    assert.equal(out.queue[0].jetty, '3B')
    assert.equal(out.queue[0].__pendingSync, true)
  })
})
