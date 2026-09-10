import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCargoMovementBlock,
  buildCargoMovementHeader,
  buildPlanRefByShipmentPlanId,
  CARGO_MOVEMENT_HEADER_FIELDS,
  filterOperationsForCargoMovement,
  formatCargoMovementQty,
  operationMatchesCargoLookup,
  sortCargoMovementBlocksNewestFirst,
} from './cargoMovementReportFromApi.js'

const planRefs = buildPlanRefByShipmentPlanId([
  { id: 21, planReference: 'SP-26-09-00021' },
  { id: 22, planReference: 'SP-26-08-00010' },
])

function sampleOp(overrides = {}) {
  return {
    id: 12,
    vesselName: 'MT SUKSES JAYA',
    referenceNumber: 'SI-2026-0042',
    shippingInstructionId: 9,
    jettyOperationCode: 'LD-26-09-0042',
    shipmentPlanId: 21,
    purpose: 'Loading',
    commodityShortDisplay: 'CPO',
    cargoSiQty: 5000,
    cargoSiMetricCode: 'MT',
    createdAt: '2026-09-01T08:00:00.000Z',
    eta: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('operationMatchesCargoLookup', () => {
  it('matches vessel name, plan ref, jetty operation ID, or SI (contains, case-insensitive)', () => {
    const op = sampleOp()
    assert.equal(operationMatchesCargoLookup(op, 'sukses', planRefs), true)
    assert.equal(operationMatchesCargoLookup(op, 'SP-26-09', planRefs), true)
    assert.equal(operationMatchesCargoLookup(op, 'ld-26-09-0042', planRefs), true)
    assert.equal(operationMatchesCargoLookup(op, 'SI-2026-0042', planRefs), true)
    assert.equal(operationMatchesCargoLookup(op, 'SI-9', planRefs), true)
  })

  it('returns false for empty term or no field match', () => {
    const op = sampleOp()
    assert.equal(operationMatchesCargoLookup(op, '   ', planRefs), false)
    assert.equal(operationMatchesCargoLookup(op, 'UNKNOWN-VESSEL', planRefs), false)
    assert.equal(operationMatchesCargoLookup(null, 'sukses', planRefs), false)
  })
})

describe('filterOperationsForCargoMovement', () => {
  it('stacks every matching operation (OR lookup)', () => {
    const ops = [
      sampleOp({ id: 1, vesselName: 'MT SUKSES JAYA', createdAt: '2026-09-02T00:00:00.000Z' }),
      sampleOp({
        id: 2,
        vesselName: 'BG OTHER',
        jettyOperationCode: 'UN-26-09-0001',
        shipmentPlanId: 22,
        referenceNumber: 'SI-OTHER',
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
      sampleOp({
        id: 3,
        vesselName: 'MT SUKSES JAYA',
        jettyOperationCode: 'LD-26-08-0010',
        createdAt: '2026-08-15T00:00:00.000Z',
      }),
    ]
    const matches = filterOperationsForCargoMovement(ops, {
      lookup: 'SUKSES',
      planRefByShipmentPlanId: planRefs,
    })
    assert.equal(matches.length, 2)
    assert.deepEqual(matches.map((o) => o.id), [1, 3])
  })
})

describe('buildCargoMovementHeader', () => {
  it('maps the six header fields', () => {
    const header = buildCargoMovementHeader(sampleOp(), planRefs)
    assert.equal(header.planRef, 'SP-26-09-00021')
    assert.equal(header.shippingInstruction, 'SI-2026-0042')
    assert.equal(header.jettyOperationId, 'LD-26-09-0042')
    assert.equal(header.commodity, 'CPO')
    assert.equal(header.quantity, '5000 MT')
    assert.equal(header.purpose, 'Loading')
    assert.equal(CARGO_MOVEMENT_HEADER_FIELDS.length, 6)
  })

  it('uses totalQtyDisplay when present', () => {
    assert.equal(formatCargoMovementQty({ totalQtyDisplay: '1,250 KL' }), '1,250 KL')
  })
})

describe('buildCargoMovementBlock', () => {
  it('keeps empty hourly buckets so the header still renders', () => {
    const block = buildCargoMovementBlock(sampleOp(), null, planRefs)
    assert.equal(block.vesselName, 'MT SUKSES JAYA')
    assert.equal(block.hourlyBuckets.length, 0)
    assert.equal(block.header.jettyOperationId, 'LD-26-09-0042')
    assert.equal(block.unit, 'MT')
  })

  it('passes through hourly buckets, purpose, and SI metric from progress', () => {
    const buckets = [{ hourStart: '2026-09-02T00:00:00.000Z', hourEnd: '2026-09-02T01:00:00.000Z' }]
    const block = buildCargoMovementBlock(
      sampleOp(),
      { hourlyBuckets: buckets, purpose: 'Unloading', siMetric: 'KL' },
      planRefs
    )
    assert.equal(block.hourlyBuckets.length, 1)
    assert.equal(block.purpose, 'Unloading')
    assert.equal(block.unit, 'KL')
  })
})

describe('sortCargoMovementBlocksNewestFirst', () => {
  it('orders by createdAt descending', () => {
    const sorted = sortCargoMovementBlocksNewestFirst([
      { operationId: 1, createdAt: '2026-08-01T00:00:00.000Z' },
      { operationId: 2, createdAt: '2026-09-01T00:00:00.000Z' },
      { operationId: 3, createdAt: '2026-08-15T00:00:00.000Z' },
    ])
    assert.deepEqual(sorted.map((b) => b.operationId), [2, 3, 1])
  })
})
