import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateSampleMetric,
  buildSamplingPayload,
  buildSampleRecord,
  computeAverages,
  findEmptySamplingCards,
  normalizeMetric,
  parseMetric,
  recordsDiffer,
  suggestNextPalka,
  validateSample,
  validateSummaryFields,
} from './qcSampling.js'

test('parseMetric accepts dot and comma decimals and rejects junk', () => {
  assert.equal(parseMetric('4.91'), 4.91)
  assert.equal(parseMetric('0,25'), 0.25)
  assert.equal(parseMetric('5%'), 5)
  assert.equal(parseMetric('abc'), null)
  assert.equal(parseMetric(''), null)
})

test('normalizeMetric stores a dot decimal and keeps blanks empty', () => {
  assert.equal(normalizeMetric(' 0,25 '), '0.25')
  assert.equal(normalizeMetric(''), '')
  assert.equal(normalizeMetric('x'), 'x')
})

test('validateSample requires palka and one metric, and checks ranges', () => {
  assert.deepEqual(validateSample({ noPalka: '', ffa: '', moisture: '' }, []).errors, {
    noPalka: 'palkaRequired',
    metrics: 'metricRequired',
  })
  assert.equal(validateSample({ noPalka: '1', ffa: '101', moisture: '' }, []).errors.ffa, 'range')
  assert.equal(validateSample({ noPalka: '1', ffa: 'x', moisture: '' }, []).errors.ffa, 'invalid')
  assert.equal(validateSample({ noPalka: '1', ffa: '4,9', moisture: '' }, []).ok, true)
  assert.equal(validateSample({ noPalka: '', tankId: '', ffa: '4' }, [], null, { kind: 'tank' }).errors.noPalka, 'tankRequired')
  assert.equal(validateSample({ noPalka: 'TK-01', tankId: '5', ffa: '4' }, [], null, { kind: 'tank' }).ok, true)
})

test('validateSample flags duplicate palka as a warning and ignores the record being edited', () => {
  const records = [{ id: 'a', noPalka: '2P', ffa: '4', moisture: '0.2' }]
  const dup = validateSample({ noPalka: ' 2p ', ffa: '5', moisture: '' }, records)
  assert.equal(dup.duplicate, true)
  assert.equal(dup.ok, true)
  assert.equal(validateSample({ noPalka: '2P', ffa: '5', moisture: '' }, records, 'a').duplicate, false)
})

test('buildSampleRecord trims and normalizes', () => {
  assert.deepEqual(buildSampleRecord({ noPalka: ' 3 ', ffa: '4,5', moisture: '', remark: '  off spec ' }, 'id1'), {
    id: 'id1',
    noPalka: '3',
    ffa: '4.5',
    moisture: '',
    remark: 'off spec',
  })
  assert.deepEqual(buildSampleRecord({ noPalka: 'TK-01', tankId: '5', ffa: '4', moisture: '' }, 'id2'), {
    id: 'id2',
    noPalka: 'TK-01',
    tankId: 5,
    ffa: '4',
    moisture: '',
    remark: '',
  })
})

test('suggestNextPalka increments the last numeric palka label', () => {
  assert.equal(suggestNextPalka([]), '')
  assert.equal(suggestNextPalka([{ noPalka: '3' }]), '4')
  assert.equal(suggestNextPalka([{ noPalka: '1' }, { noPalka: '2P' }]), '3P')
  assert.equal(suggestNextPalka([{ noPalka: 'Forward' }]), '')
})

test('aggregateSampleMetric averages or sums one code and skips blanks', () => {
  const records = [
    { ffa: '4.00', moisture: '0.20' },
    { ffa: '5,00', moisture: '' },
    { metrics: { ffa: 'abc', moisture: '0.10' } },
  ]
  assert.equal(aggregateSampleMetric(records, 'ffa', 'average'), '4.50')
  assert.equal(aggregateSampleMetric(records, 'ffa', 'sum'), '9.00')
  assert.equal(aggregateSampleMetric(records, 'moisture', 'average'), '0.15')
  assert.equal(aggregateSampleMetric(records, 'moisture', 'sum'), '0.30')
  assert.equal(aggregateSampleMetric([], 'ffa', 'average'), null)
  assert.equal(aggregateSampleMetric(records, 'dobi', 'sum'), null)
})

test('computeAverages averages numeric cells per metric', () => {
  const out = computeAverages([
    { ffa: '4.00', moisture: '0.20' },
    { ffa: '5,00', moisture: '' },
  ])
  assert.deepEqual(out, { avgFfa: '4.50', avgMoisture: '0.20' })
  assert.deepEqual(computeAverages([]), { avgFfa: null, avgMoisture: null })
})

test('buildSamplingPayload maps draft/final to status and tags the QC source', () => {
  const sampling = { startTime: '2026-10-28T08:00', records: [{ id: 'a', noPalka: '1' }], dobi: '2,85' }
  const draft = buildSamplingPayload(sampling, 'draft')
  assert.equal(draft.status, 'In Progress')
  assert.equal(draft.dobi, '2.85')
  assert.equal(draft.source, 'qc')
  assert.equal(draft.payload.records.length, 1)
  assert.equal(buildSamplingPayload(sampling, 'final').status, 'Done')
})

test('buildSamplingPayload can leave records out and carries the optimistic-lock stamp', () => {
  const sampling = { records: [{ id: 'a', noPalka: '1' }] }
  const out = buildSamplingPayload(sampling, 'draft', {
    includeRecords: false,
    expectedUpdatedAt: '2026-10-28T03:00:00.000Z',
  })
  assert.equal('payload' in out, false)
  assert.equal(out.expectedUpdatedAt, '2026-10-28T03:00:00.000Z')
  assert.equal('expectedUpdatedAt' in buildSamplingPayload(sampling, 'draft'), false)
})

test('recordsDiffer compares readings and ignores ids', () => {
  const a = [{ id: 'x', noPalka: '1', ffa: '4.00', moisture: '' }]
  assert.equal(recordsDiffer(a, [{ id: 'y', noPalka: '1', ffa: '4.00', moisture: '' }]), false)
  assert.equal(recordsDiffer(a, [{ id: 'x', noPalka: '1', ffa: '4.50', moisture: '' }]), true)
  assert.equal(recordsDiffer(a, []), true)
})

test('validateSummaryFields enforces per-field ceilings', () => {
  assert.deepEqual(validateSummaryFields({ ffaAverage: '101', iodineValue: '150', dobi: 'x' }), {
    ffa: 'range',
    dobi: 'invalid',
  })
})

test('findEmptySamplingCards names commodities saved final with no QC evidence', () => {
  const empty = { commodityId: 17, shortName: 'INS POMEFAD', records: [], documents: [], metrics: {}, ffaAverage: '' }
  assert.deepEqual(findEmptySamplingCards({ commodities: [empty] }), ['INS POMEFAD'])
  assert.deepEqual(findEmptySamplingCards({ commodities: [{ ...empty, records: [{ id: 'a' }] }] }), [])
  assert.deepEqual(findEmptySamplingCards({ commodities: [{ ...empty, documents: [{ name: 'r.pdf' }] }] }), [])
  assert.deepEqual(findEmptySamplingCards({ commodities: [{ ...empty, metrics: { dobi: '2.1' } }] }), [])
  assert.deepEqual(findEmptySamplingCards({ commodities: [{ ...empty, iodineValue: '52' }] }), [])
  assert.deepEqual(
    findEmptySamplingCards({ commodities: [{ ...empty, records: [{ id: 'a' }] }, { ...empty, shortName: 'RBD PO' }] }),
    ['RBD PO']
  )
})

test('findEmptySamplingCards checks the visit itself when there are no commodity cards', () => {
  assert.deepEqual(findEmptySamplingCards({ commodities: [], records: [], documents: [] }), [''])
  assert.deepEqual(findEmptySamplingCards({ records: [], documents: [], ffaAverage: '3.1' }), [])
})
