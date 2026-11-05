import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCommodityCards, recordWritePlan, samplingCardForProduct, toQcDecisionPill } from './sampling-commodity-qc.js'

const allowed = new Set([10, 20])

test('one commodity card accepts Hold without a spec and keeps an empty remark', () => {
  const parsed = parseCommodityCards(
    [{ commodityId: 10, decision: 'hold', remark: '   ', ffaAverage: '', records: [] }],
    allowed
  )
  assert.equal(parsed.provided, true)
  assert.equal(parsed.cards[0].decision, 'hold')
  assert.equal(parsed.cards[0].remark, '')
  assert.equal(parsed.cards[0].metrics.ffa_average, null)
})

test('two commodities stay independent', () => {
  const parsed = parseCommodityCards(
    [
      { commodityId: 10, decision: 'approve_in', remark: 'ok', records: [{ noPalka: '1', ffa: '1.2', moisture: '' }] },
      { commodityId: 20, decision: 'reject_out', remark: '', records: [] },
    ],
    allowed
  )
  assert.deepEqual(
    parsed.cards.map((c) => c.decision),
    ['approve_in', 'reject_out']
  )
  assert.equal(parsed.cards[0].records[0].noPalka, '1')
  assert.equal(parsed.cards[1].records.length, 0)
})

test('a commodity that is not on the instruction is rejected', () => {
  assert.throws(
    () => parseCommodityCards([{ commodityId: 99, decision: 'hold' }], allowed),
    (err) => err.statusCode === 400
  )
})

test('an unknown decision is rejected', () => {
  assert.throws(
    () => parseCommodityCards([{ commodityId: 10, decision: 'maybe' }], allowed),
    (err) => err.statusCode === 400
  )
})

test('leaving commodities out of the body keeps stored cards', () => {
  assert.deepEqual(parseCommodityCards(undefined, allowed), { provided: false, cards: [] })
})

test('Loading snapshots the tank code and Unloading strips tankId', () => {
  const tanksById = new Map([[5, { id: 5, code: 'TK-01' }]])
  const loading = parseCommodityCards(
    [{ commodityId: 10, records: [{ tankId: 5, noPalka: 'typed', ffa: '1.2', moisture: '' }] }],
    allowed,
    new Map(),
    { purpose: 'Loading', tanksById }
  )
  assert.deepEqual(loading.cards[0].records[0], { id: null, tankId: 5, noPalka: 'TK-01', ffa: '1.20', moisture: '' })
  assert.throws(
    () =>
      parseCommodityCards(
        [{ commodityId: 10, records: [{ tankId: 99, noPalka: 'TK-99', ffa: '1', moisture: '' }] }],
        allowed,
        new Map(),
        { purpose: 'Loading', tanksById }
      ),
    (err) => err.statusCode === 400
  )
  const unloading = parseCommodityCards(
    [{ commodityId: 10, records: [{ tankId: 5, noPalka: '2P', ffa: '1.2', moisture: '' }] }],
    allowed,
    new Map(),
    { purpose: 'Unloading', tanksById }
  )
  assert.equal(unloading.cards[0].records[0].noPalka, '2P')
  assert.equal(unloading.cards[0].records[0].tankId, undefined)
})

test('a palka edit targets one commodity and mirrors the parent only for a single product', () => {
  assert.deepEqual(recordWritePlan(10, 2), { scope: 'commodity', mirrorParent: false })
  assert.deepEqual(recordWritePlan(10, 1), { scope: 'commodity', mirrorParent: true })
  assert.deepEqual(recordWritePlan(null, 2), { scope: 'shared', mirrorParent: true })
})

test('a supplied spec drives the card fields instead of the CPO fallback', () => {
  const spec = {
    templateId: 4,
    name: 'Cangkang',
    parameters: [
      { code: 'moisture', labelEn: 'Moisture', kind: 'number', maxValue: 100, scope: 'both' },
      { code: 'dirt', labelEn: 'Dirt', kind: 'number', maxValue: 100, scope: 'both' },
    ],
  }
  const card = samplingCardForProduct(
    { commodityId: 8, shortName: 'PKS' },
    { metrics_json: { moisture: '12', dirt: '1.4' } },
    null,
    [],
    1,
    spec
  )
  assert.equal(card.spec.name, 'Cangkang')
  assert.equal(card.metrics.dirt, '1.40')
  assert.equal(card.iodineValue, '')
})

test('a single commodity with no card yet keeps the visit quality and untagged documents', () => {
  const card = samplingCardForProduct(
    { commodityId: 3, shortName: 'CPO', name: 'Crude palm oil' },
    undefined,
    { ffa_average: '4.900', moisture_average: '0.270', dobi: '10.000', iodine_value: '20.000', payload_json: { records: [{ id: 'p1', noPalka: '1' }] } },
    [{ id: 8, original_name: 'lab.pdf', mime_type: 'application/pdf', commodity_id: null }],
    1
  )
  assert.equal(card.ffaAverage, '4.90')
  assert.equal(card.iodineValue, '20.00')
  assert.equal(card.records[0].noPalka, '1')
  assert.equal(card.documents[0].name, 'lab.pdf')
  const stored = samplingCardForProduct(
    { commodityId: 3, shortName: 'CPO', name: 'Crude palm oil' },
    { decision: 'hold', remark: '', ffa_average: null, records_json: [] },
    { ffa_average: '4.900', payload_json: { records: [{ id: 'p1' }] } },
    [],
    1
  )
  assert.equal(stored.ffaAverage, '')
  assert.equal(stored.records.length, 0)
  assert.equal(stored.decision, 'hold')
})

test('a decision pill keeps the commodity short name and an empty remark', () => {
  assert.deepEqual(
    toQcDecisionPill({
      commodity_id: '21',
      short_name: 'ROL',
      name: 'RBD olein',
      decision: 'approve_in',
      remark: null,
    }),
    { commodityId: 21, shortName: 'ROL', name: 'RBD olein', decision: 'approve_in', remark: '' }
  )
})

test('backfill copies a sampling row only when the instruction has one commodity', () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../migrations/142_sampling_commodity_qc.sql'),
    'utf8'
  )
  assert.match(sql, /HAVING COUNT\(DISTINCT b\.commodity_id\) = 1/)
  assert.match(sql, /NOT EXISTS/)
  assert.match(sql, /operation_sub_process_documents/)
})
