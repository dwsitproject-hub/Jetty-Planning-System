import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SI_REFERENCE_BERTHING_ERROR,
  validateSiReferenceForBerthing,
  validateQueueRowSiReferencesForBerthing,
  isSyntheticSiLabel,
  BERTHING_INVALID_SI_REF_TOOLTIP,
} from './siReferenceValidation.js'
import { berthingDisabledReason, BERTHING_NO_SI_TOOLTIP } from './berthingEligibility.js'

describe('siReferenceValidation', () => {
  it('rejects empty, quote, and vessel-name refs', () => {
    assert.equal(validateSiReferenceForBerthing('', 'TANKER ONE'), SI_REFERENCE_BERTHING_ERROR)
    assert.equal(validateSiReferenceForBerthing("'", 'TANKER ONE'), SI_REFERENCE_BERTHING_ERROR)
    assert.equal(validateSiReferenceForBerthing('TANKER ONE', 'tanker one'), SI_REFERENCE_BERTHING_ERROR)
    assert.equal(validateSiReferenceForBerthing('SI/EUP/2026/1', 'TANKER ONE'), null)
  })

  it('detects synthetic SI labels', () => {
    assert.equal(isSyntheticSiLabel('SI-42'), true)
    assert.equal(isSyntheticSiLabel('SI/EUP/1'), false)
  })

  it('validates queue rows with plan SI entries', () => {
    const invalid = validateQueueRowSiReferencesForBerthing({
      vesselName: 'MV ALPHA',
      planQueueSiEntries: [{ referenceNumber: null, label: 'SI-9' }],
    })
    assert.equal(invalid, SI_REFERENCE_BERTHING_ERROR)

    const valid = validateQueueRowSiReferencesForBerthing({
      vesselName: 'MV ALPHA',
      planQueueSiEntries: [{ referenceNumber: 'SI/EUP/1', label: 'SI/EUP/1' }],
    })
    assert.equal(valid, null)
  })
})

describe('berthingDisabledReason with SI ref gate', () => {
  const planCentric = { planCentric: true }

  it('returns invalid ref tooltip when approved but ref missing', () => {
    const reason = berthingDisabledReason(
      {
        berthingAllowed: false,
        vesselName: 'MV BETA',
        shippingInstructionId: 12,
        shippingInstruction: 'SI-12',
      },
      planCentric
    )
    assert.equal(reason, BERTHING_INVALID_SI_REF_TOOLTIP)
  })

  it('returns no-SI tooltip for plan-only rows', () => {
    const reason = berthingDisabledReason(
      { berthingAllowed: false, shipmentPlanId: 5, source: 'incoming-plan' },
      planCentric
    )
    assert.equal(reason, BERTHING_NO_SI_TOOLTIP)
  })
})
