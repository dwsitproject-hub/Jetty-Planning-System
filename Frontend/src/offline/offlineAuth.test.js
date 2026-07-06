import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hashPassword, verifyPassword, deriveHashB64, isWithinGrace } from './offlineAuth.js'

describe('offlineAuth hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const cred = await hashPassword('admin123')
    assert.ok(cred.hash && cred.salt)
    assert.equal(cred.algo, 'PBKDF2-SHA256')
    assert.equal(await verifyPassword('admin123', cred), true)
    assert.equal(await verifyPassword('wrong', cred), false)
  })

  it('never stores the plaintext password', async () => {
    const cred = await hashPassword('s3cret-pw')
    assert.ok(!JSON.stringify(cred).includes('s3cret-pw'))
  })

  it('derivation is deterministic for the same salt', async () => {
    const cred = await hashPassword('pw')
    const salt = Uint8Array.from(atob(cred.salt), (c) => c.charCodeAt(0))
    const again = await deriveHashB64('pw', salt, cred.iterations)
    assert.equal(again, cred.hash)
  })

  it('uses a random salt (two hashes of the same password differ)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    assert.notEqual(a.salt, b.salt)
    assert.notEqual(a.hash, b.hash)
  })

  it('verifyPassword is safe on missing/garbage records', async () => {
    assert.equal(await verifyPassword('x', null), false)
    assert.equal(await verifyPassword('x', {}), false)
    assert.equal(await verifyPassword('x', { hash: 'a', salt: '!!!' }), false)
  })
})

describe('isWithinGrace', () => {
  const DAY = 24 * 60 * 60 * 1000
  it('allows within the window and blocks after it', () => {
    const now = 10 * DAY
    assert.equal(isWithinGrace({ lastOnlineLoginAt: now - 12 * 60 * 60 * 1000 }, now, 1), true)
    assert.equal(isWithinGrace({ lastOnlineLoginAt: now - 2 * DAY }, now, 1), false)
  })
  it('honors a configurable window', () => {
    const now = 10 * DAY
    assert.equal(isWithinGrace({ lastOnlineLoginAt: now - 5 * DAY }, now, 7), true)
    assert.equal(isWithinGrace({ lastOnlineLoginAt: now - 5 * DAY }, now, 3), false)
  })
  it('blocks when there is no recorded login', () => {
    assert.equal(isWithinGrace(null, 1, 1), false)
    assert.equal(isWithinGrace({}, 1, 1), false)
  })
})
