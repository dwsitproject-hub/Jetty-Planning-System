import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeKurasStart, kurasStartDraftFromLine, kurasStartPayload } from './kurasStart.js'

const toLocal = (iso) => `L:${iso}`
const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k)
const formatAt = (iso) => `F:${iso}`

test('draft from a saved line', () => {
  assert.equal(kurasStartDraftFromLine({}, toLocal).kurasStartMode, 'auto')
  const manual = kurasStartDraftFromLine({ kurasStartedAt: 'X', kurasStartSource: 'manual' }, toLocal)
  assert.equal(manual.kurasStartMode, 'manual')
  assert.equal(manual.kurasStartInput, 'L:X')
  assert.equal(kurasStartDraftFromLine({ kurasStartSource: 'manual' }, toLocal).kurasStartMode, 'none')
  assert.equal(kurasStartDraftFromLine({ kurasStartedAt: 'X', kurasStartSource: 'auto' }, toLocal).kurasStartInput, '')
})

test('payload only when the operator changed the field', () => {
  const toApi = (v) => `A:${v}`
  assert.deepEqual(kurasStartPayload({ kurasStartMode: 'manual', kurasStartInput: 'x' }, toApi), {})
  assert.deepEqual(kurasStartPayload({ kurasStartTouched: true, kurasStartMode: 'auto' }, toApi), { value: 'auto' })
  assert.deepEqual(kurasStartPayload({ kurasStartTouched: true, kurasStartMode: 'none' }, toApi), { value: 'none' })
  assert.deepEqual(kurasStartPayload({ kurasStartTouched: true, kurasStartMode: 'manual', kurasStartInput: 'x' }, toApi), { value: 'A:x' })
  assert.deepEqual(kurasStartPayload({ kurasStartTouched: true, kurasStartMode: 'manual', kurasStartInput: '' }, toApi), { error: 'kurasStartTimeRequired' })
})

test('explanation text', () => {
  const d = (p) => describeKurasStart(t, { persistedKurasStart: p }, { formatAt, locale: 'en' })
  assert.equal(describeKurasStart(t, {}, { formatAt }), 'kurasStartPending')
  assert.match(d({ source: 'manual', startedAt: 'X' }), /^kurasStartManual .*F:X/)
  assert.equal(d({ source: 'manual', startedAt: null }), 'kurasStartManualNone')
  assert.match(
    d({ source: 'auto', startedAt: 'X', reason: { code: 'kurasStart', remainingPct: 15.83, rateMtPerHour: 30 } }),
    /kurasStartAuto .*"remaining":"15.8".*"rate":"30"/
  )
  assert.equal(d({ source: 'auto', startedAt: null, reason: { code: 'noKuras' } }), 'kurasStartAutoNone')
  assert.equal(d({ source: 'auto', startedAt: null, reason: { code: 'noHourly' } }), 'kurasStartNoHourly')
})
