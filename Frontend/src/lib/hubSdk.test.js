import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueueHubCall, hubIdentityPayload } from './hubSdk.js'

test('hubIdentityPayload keeps Hub id and email and drops blanks', () => {
  assert.deepEqual(hubIdentityPayload({ id: '  abc  ', email: ' a@b.c ' }), {
    id: 'abc',
    email: 'a@b.c',
  })
  assert.deepEqual(hubIdentityPayload({ id: '', email: 'a@b.c' }), { email: 'a@b.c' })
  assert.equal(hubIdentityPayload({ id: null, email: '  ' }), null)
  assert.equal(hubIdentityPayload(null), null)
})

test('enqueueHubCall queues until the SDK object exists', () => {
  const queued = enqueueHubCall([], 'identify', [{ id: 'sub', email: 'a@b.c' }])
  assert.deepEqual(queued, [['identify', { id: 'sub', email: 'a@b.c' }]])
  enqueueHubCall(queued, 'reset', [])
  enqueueHubCall(queued, 'page', ['/allocation-plans'])
  assert.deepEqual(queued[1], ['reset'])
  assert.deepEqual(queued[2], ['page', '/allocation-plans'])
})

test('enqueueHubCall invokes the live SDK', () => {
  const calls = []
  const hub = {
    identify(user) {
      calls.push(['identify', user])
    },
    openBugReport() {
      calls.push(['openBugReport'])
    },
  }
  enqueueHubCall(hub, 'identify', [{ email: 'a@b.c' }])
  enqueueHubCall(hub, 'openBugReport', [])
  assert.deepEqual(calls, [
    ['identify', { email: 'a@b.c' }],
    ['openBugReport'],
  ])
})
