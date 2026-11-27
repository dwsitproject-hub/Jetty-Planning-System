import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanPalka, emptyPeriod, hasPeriodErrors, kurasPeriodsDraftFromLine, kurasPeriodsPayload, validatePeriods } from './kurasPeriods.js'

const entry = { entryStart: '2026-11-23T05:00', entryEnd: '2026-11-23T06:00' }
const row = (o) => ({ ...emptyPeriod(), palka: '1B', from: '2026-11-23T05:20', until: '2026-11-23T05:50', ...o })

test('palka text is upper-case letters and digits, 3 characters at most', () => {
  assert.equal(cleanPalka('1b'), '1B')
  assert.equal(cleanPalka('a-b c d'), 'ABC')
})

test('a good row has no errors', () => {
  assert.equal(hasPeriodErrors(validatePeriods([row({})], entry)), false)
})

test('from cannot be before the entry start', () => {
  const [e] = validatePeriods([row({ from: '2026-11-23T04:40' })], entry)
  assert.equal(e.from, 'kurasErrFromBefore')
})

test('until must be after from and not after the entry end', () => {
  assert.equal(validatePeriods([row({ until: '2026-11-23T05:10' })], entry)[0].until, 'kurasErrUntilAfterFrom')
  assert.equal(validatePeriods([row({ until: '2026-11-23T06:30' })], entry)[0].until, 'kurasErrUntilBeyond')
})

test('an open entry has no end limit', () => {
  const open = { entryStart: '2026-11-23T05:00', entryEnd: '' }
  assert.equal(hasPeriodErrors(validatePeriods([row({ until: '2026-11-24T09:00' })], open)), false)
})

test('palka and from are required', () => {
  const [e] = validatePeriods([row({ palka: '', from: '' })], entry)
  assert.equal(e.palka, 'kurasErrPalka')
  assert.equal(e.from, 'kurasErrFromRequired')
})

test('quantity must be above 0 and within the entry quantity', () => {
  assert.equal(validatePeriods([row({ qty: '0' })], { ...entry, entryQty: 100 })[0].qty, 'kurasErrQty')
  assert.equal(validatePeriods([row({ qty: '150' })], { ...entry, entryQty: 100 })[0].qty, 'kurasErrQtyMax')
  assert.equal(hasPeriodErrors(validatePeriods([row({ qty: '38' })], { ...entry, entryQty: 100 })), false)
})

test('the same palka cannot overlap, other palkas can', () => {
  const same = validatePeriods([row({}), row({ from: '2026-11-23T05:30', until: '2026-11-23T05:55' })], entry)
  assert.equal(same[1].palka, 'kurasErrOverlap')
  const other = validatePeriods([row({}), row({ palka: '2A', from: '2026-11-23T05:30', until: '2026-11-23T05:55' })], entry)
  assert.equal(hasPeriodErrors(other), false)
})

test('draft from a saved line and the payload round trip', () => {
  const line = { kurasPeriods: [{ palka: '1B', startAt: '2026-11-23T05:20:00Z', endAt: null, qty: 38 }] }
  const { kurasPeriods } = kurasPeriodsDraftFromLine(line, (iso) => iso.slice(0, 16))
  assert.equal(kurasPeriods[0].showQty, true)
  const payload = kurasPeriodsPayload(kurasPeriods, (v) => `${v}:00Z`)
  assert.deepEqual(payload, [{ palka: '1B', from: '2026-11-23T05:20:00Z', until: null, qty: 38 }])
})
