import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClearancePayload, clearanceEntryStatus, clearanceStatusOf, validateClearance } from './customClearance.js'

const doc = { id: 1, name: 'peb.pdf' }

test('validateClearance: draft only checks the time order', () => {
  assert.deepEqual(validateClearance({ startTime: '', endTime: '', documents: [] }, 'draft'), {})
  assert.deepEqual(
    validateClearance({ startTime: '2026-11-10T10:00', endTime: '2026-11-10T09:00', documents: [] }, 'draft'),
    { endTime: 'beforeStart' }
  )
})

test('validateClearance: final needs both times and a document', () => {
  assert.deepEqual(validateClearance({ startTime: '', endTime: '', documents: [] }, 'final'), {
    startTime: 'required',
    endTime: 'required',
    documents: 'required',
  })
  assert.deepEqual(
    validateClearance({ startTime: '2026-11-10T08:00', endTime: '2026-11-10T09:00', documents: [doc] }, 'final'),
    {}
  )
  assert.deepEqual(
    validateClearance({ startTime: '2026-11-10T08:00', endTime: '2026-11-10T08:00', documents: [{ name: 'a', file: {} }] }, 'final'),
    {},
    'an end equal to the start and a pending upload are both fine'
  )
})

test('buildClearancePayload maps modes, trims the remark and carries the lock', () => {
  const form = { startTime: '2026-11-10T08:00', endTime: '2026-11-10T09:30', remark: '  PEB ok ' }
  assert.deepEqual(buildClearancePayload(form, 'final', { expectedUpdatedAt: 'stamp' }), {
    phase: 'Post-Checking',
    status: 'Done',
    occurredAt: '2026-11-10T08:00',
    startAt: '2026-11-10T08:00',
    endAt: '2026-11-10T09:30',
    remark: 'PEB ok',
    source: 'custom-clearance',
    expectedUpdatedAt: 'stamp',
  })
  const draft = buildClearancePayload({}, 'draft')
  assert.equal(draft.status, 'In Progress')
  assert.equal(draft.startAt, null)
  assert.equal('expectedUpdatedAt' in draft, false)
})

test('status helpers', () => {
  assert.equal(clearanceStatusOf({ clearance: { status: 'draft' } }), 'draft')
  assert.equal(clearanceEntryStatus({ status: 'Done' }), 'done')
  assert.equal(clearanceEntryStatus({ status: 'In Progress' }), 'draft')
  assert.equal(clearanceEntryStatus({ status: null }), 'not_started')
})
