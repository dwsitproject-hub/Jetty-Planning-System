import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEntryMovement, formatKurasReason, movementDraftFromLine } from './kurasMovementReason.js'

const t = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key)

test('movementDraftFromLine keeps manual tags and maps auto lines to auto', () => {
  assert.equal(movementDraftFromLine({ movementType: 'kuras', movementTypeSource: 'manual' }).movementType, 'kuras')
  assert.equal(movementDraftFromLine({ movementType: 'kuras', movementTypeSource: 'auto' }).movementType, 'auto')
  assert.equal(movementDraftFromLine({}).movementType, 'auto')
})

test('formatKurasReason fills the decided sentence with comparisons and rule', () => {
  const s = formatKurasReason(
    t,
    { code: 'kuras', remainingPct: 12, remainingLimit: 20, rateMtPerHour: 24.6, rateLimit: 30, remainingHit: true, rateHit: true, match: 'and', ruleLabel: null },
    'en'
  )
  assert.match(s, /^kurasReasonDecided/)
  assert.match(s, /"remainingCmp":"kurasReasonBelow"/)
  assert.match(s, /"rule":"kurasReasonRuleDefault"/)
  assert.match(s, /"rate":"24.6"/)
  assert.equal(formatKurasReason(t, { code: 'open' }, 'en'), 'kurasReasonOpen')
  assert.equal(formatKurasReason(t, null, 'en'), null)
})

test('describeEntryMovement shows pending until the server has decided', () => {
  assert.equal(describeEntryMovement(t, { movementType: 'auto', persistedMovement: null }).text, 'cargoOpsMovementPending')
  const manual = describeEntryMovement(t, {
    movementType: 'kuras',
    persistedMovement: { type: 'kuras', source: 'manual', setByName: 'Budi', setAt: 'x' },
  })
  assert.deepEqual(manual.badge, { type: 'kuras', source: 'manual' })
  assert.match(manual.text, /^kurasReasonManual /)
  const changed = describeEntryMovement(t, { movementType: 'normal', persistedMovement: { type: 'kuras', source: 'auto' } })
  assert.match(changed.text, /^kurasReasonManualNoName/)
})

test('entry label: Normal, Kuras, Mixed with palkas, Normal then Kuras, unclassified', async () => {
  const { entryMovementLabel } = await import('./kurasMovementReason.js')
  const t = (k) => ({ cargoOpsMovementNormal: 'Normal', cargoOpsMovementMixedShort: 'Mixed', cargoOpsMovementNormalThenKuras: 'Normal, then Kuras' }[k] ?? k)
  assert.equal(entryMovementLabel(t, { movementType: 'normal' }).text, 'Normal')
  assert.equal(entryMovementLabel(t, { movementType: 'kuras' }).type, 'kuras')
  assert.equal(entryMovementLabel(t, { movementType: 'mixed', kurasPeriods: [{ palka: '1B' }, { palka: '2A' }, { palka: '1B' }] }).text, 'Mixed (1B, 2A)')
  assert.equal(entryMovementLabel(t, { movementType: 'normal', kurasStartedAt: '2026-11-23T05:40:00Z' }).text, 'Normal, then Kuras')
  assert.equal(entryMovementLabel(t, {}), null)
})
