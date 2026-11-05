import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_SPEC,
  metricValue,
  paramFieldLabel,
  paramLabel,
  paramMethod,
  paramUnit,
  patchCardMetric,
  queuePreviewMetrics,
  reportParams,
  sampleParams,
  specOf,
  valueCodesOf,
} from './qcSpec.js'

test('fallback has sample FFA/Moisture and report DOBI/IV', () => {
  assert.deepEqual(sampleParams(FALLBACK_SPEC).map((p) => p.code), ['ffa', 'moisture'])
  assert.equal(reportParams(FALLBACK_SPEC).length, 4)
})

test('specOf uses the fallback when the card has no template', () => {
  assert.equal(specOf({}).parameters[0].code, 'ffa')
  assert.equal(specOf({ spec: { parameters: [{ code: 'dirt', scope: 'both' }] } }).parameters[0].code, 'dirt')
})

test('patchCardMetric writes metrics and the CPO aliases', () => {
  const next = patchCardMetric({ ffaAverage: '' }, 'ffa', '4.1')
  assert.equal(next.metrics.ffa, '4.1')
  assert.equal(next.ffaAverage, '4.1')
  assert.equal(metricValue(next, 'ffa'), '4.1')
  assert.equal(metricValue({ ffa: '4.50', moisture: '' }, 'ffa'), '4.50')
})

test('paramLabel stays the name; unit and method are separate', () => {
  const param = { labelEn: 'FFA', labelId: 'FFA', unit: '%', method: 'AOCS Ca 5a-40' }
  assert.equal(paramLabel(param, 'en'), 'FFA')
  assert.equal(paramUnit(param), '%')
  assert.equal(paramMethod(param), 'AOCS Ca 5a-40')
  assert.equal(paramFieldLabel({ ...param, kind: 'color_pair', labelEn: 'Color' }, 'color_red', 'en'), 'Color R')
})

test('report-only templates hide sample columns', () => {
  const spec = { parameters: [{ code: 'ffa', scope: 'report', kind: 'number' }, { code: 'dirt', scope: 'sample', kind: 'number' }] }
  assert.deepEqual(reportParams(spec).map((p) => p.code), ['ffa'])
  assert.deepEqual(sampleParams(spec).map((p) => p.code), ['dirt'])
})

test('color pair writes two keys', () => {
  assert.deepEqual(valueCodesOf({ kind: 'color_pair', code: 'color' }), ['color_red', 'color_yellow'])
  const next = patchCardMetric({}, 'color_red', '3.2')
  assert.equal(next.metrics.color_red, '3.2')
})

test('queue preview uses extras only when FFA and moisture are empty', () => {
  assert.deepEqual(queuePreviewMetrics({ avgFfa: '4.1', previewMetrics: [{ label: 'Dirt', value: '1.4' }] }), [])
  assert.deepEqual(
    queuePreviewMetrics({ previewMetrics: [{ label: 'Dirt', value: '1.4' }, { label: 'Moisture', value: '12' }] }),
    [{ label: 'Dirt', value: '1.4' }, { label: 'Moisture', value: '12' }]
  )
})
