import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, apiGet, apiPost, setUnauthorizedHandler } from './client.js'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function withFetch(status, body, run) {
  const original = globalThis.fetch
  globalThis.fetch = async () => jsonResponse(status, body)
  try {
    return await run()
  } finally {
    globalThis.fetch = original
    setUnauthorizedHandler(null)
  }
}

test('401 on an API get clears the session and still throws', async () => {
  const calls = []
  setUnauthorizedHandler(() => {
    calls.push('expired')
  })
  await withFetch(401, { error: 'Unauthorized' }, async () => {
    await assert.rejects(apiGet('/notifications/unread-count'), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 401)
      assert.equal(err.message, 'Unauthorized')
      return true
    })
  })
  assert.deepEqual(calls, ['expired'])
})

test('401 on POST /auth/login does not clear the session', async () => {
  const calls = []
  setUnauthorizedHandler(() => {
    calls.push('expired')
  })
  await withFetch(401, { error: 'Invalid credentials' }, async () => {
    await assert.rejects(apiPost('/auth/login', { username: 'a', password: 'b' }), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 401)
      return true
    })
  })
  assert.deepEqual(calls, [])
})

test('401 on logout still clears the session', async () => {
  const calls = []
  setUnauthorizedHandler(() => {
    calls.push('expired')
  })
  await withFetch(401, { error: 'Unauthorized' }, async () => {
    await assert.rejects(apiPost('/auth/logout', {}), (err) => {
      assert.equal(err.status, 401)
      return true
    })
  })
  assert.deepEqual(calls, ['expired'])
})

test('a non-401 error does not clear the session', async () => {
  const calls = []
  setUnauthorizedHandler(() => {
    calls.push('expired')
  })
  await withFetch(500, { error: 'down' }, async () => {
    await assert.rejects(apiGet('/allocation/plan-overview'), (err) => {
      assert.equal(err.status, 500)
      return true
    })
  })
  assert.deepEqual(calls, [])
})

test('a throwing session handler still surfaces ApiError', async () => {
  setUnauthorizedHandler(() => {
    throw new Error('listener failed')
  })
  await withFetch(401, { error: 'Unauthorized' }, async () => {
    await assert.rejects(apiGet('/operations/at-berth/cargo-progress'), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 401)
      return true
    })
  })
})
