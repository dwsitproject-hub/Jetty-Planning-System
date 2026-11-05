import test from 'node:test'
import assert from 'node:assert/strict'
import { matchTankId, sampleRefKindFromPurpose, tankCodeOf, tankOptions } from './samplingSampleRef.js'

test('sampleRefKindFromPurpose uses purpose then loadDischarge', () => {
  assert.equal(sampleRefKindFromPurpose('Loading'), 'tank')
  assert.equal(sampleRefKindFromPurpose('Unloading'), 'palka')
  assert.equal(sampleRefKindFromPurpose(null, 'LOAD'), 'tank')
  assert.equal(sampleRefKindFromPurpose(null, 'DISCH'), 'palka')
})

test('matchTankId prefers tankId and falls back to the stored code', () => {
  const tanks = [{ id: 5, code: 'TK-01', name: 'Shore 1' }]
  assert.equal(matchTankId({ tankId: 5, noPalka: 'old' }, tanks), '5')
  assert.equal(matchTankId({ noPalka: 'tk-01' }, tanks), '5')
  assert.equal(matchTankId({ noPalka: '2P' }, tanks), '')
})

test('tankOptions keep a deleted tank as the current value', () => {
  const options = tankOptions([{ id: 5, code: 'TK-01', name: 'Shore 1' }], { tankId: '9', noPalka: 'TK-99' })
  assert.equal(options[0].value, '9')
  assert.equal(options[0].label, 'TK-99')
  assert.equal(tankCodeOf([{ id: 5, code: ' TK-01 ' }], 5), 'TK-01')
})
