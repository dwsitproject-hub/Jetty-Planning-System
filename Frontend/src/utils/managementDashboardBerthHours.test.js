import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBerthHourSegments, rowStopParts } from './managementDashboardBerthHours.js'
import { mergeCargoRatesIntoRow } from './managementDashboardCargoRate.js'

// 10 h at berth: 1 h before cargo, 6 h cargo window, 2 h after, 1 h idle.
const row = { wait: 4, berth: 10, pre: 1, opsH: 6, cargoDoneToSailH: 2, stopHoursBefore: 0.5, stopHoursDuring: 2, stopHoursAfter: 0.5 }
const sum = (segs) => segs.reduce((s, x) => s + x.v, 0)

test('default view is unchanged', () => {
  const wf = buildBerthHourSegments([row], { purpose: 'Unloading' })
  assert.deepEqual(wf.segs.map((s) => s.n), [
    'Anchorage wait (TA→TB)', 'Berth → start cargo', 'Cargo operations', 'Idle / delays at berth', 'Cargo done → sailed off',
  ])
  assert.deepEqual(wf.segs.map((s) => s.v), [4, 1, 6, 1, 2])
  assert.equal(wf.segs[2].cls, 'wf-disch')
  assert.equal(wf.total, 14)
  assert.equal(wf.opsShare, (6 / 14) * 100)
})

test('split view takes stops out of their phase and keeps the total', () => {
  const wf = buildBerthHourSegments([row], { purpose: 'Loading', split: true })
  const by = Object.fromEntries(wf.segs.map((s) => [s.n, s.v]))
  assert.equal(by['Berth → start cargo'], 0.5)
  assert.equal(by.Pumping, 4)
  assert.equal(by['Stopped (recorded)'], 3)
  assert.equal(by['Idle, no stop recorded'], 1)
  assert.equal(by['Cargo done → sailed off'], 1.5)
  assert.equal(sum(wf.segs), 14)
  assert.equal(wf.segs.find((s) => s.n === 'Pumping').cls, 'wf-load')
})

test('stops are limited to the phase they sit in', () => {
  assert.deepEqual(rowStopParts({ pre: 1, opsH: 2, cargoDoneToSailH: 0, stopHoursBefore: 5, stopHoursDuring: 9, stopHoursAfter: 3 }), { before: 1, during: 2, after: 0 })
  assert.deepEqual(rowStopParts({}), { before: 0, during: 0, after: 0 })
})

test('rows without a rate breakdown merge as before; with one they gain the breakdown and stop hours', () => {
  const plain = mergeCargoRatesIntoRow({ id: 7 }, { 7: { voyage: { rateMtH: 40, movedQty: 100 } } })
  assert.equal('rateBreakdown' in plain, false)
  assert.equal(plain.voyageRateMtH, 40)
  const withBreakdown = mergeCargoRatesIntoRow(
    { id: 7 },
    { 7: { voyage: { rateMtH: 40, breakdown: { stopHours: { before: 1, during: 2, after: 0, total: 3 }, normal: { rateMtH: 90 }, kuras: { rateMtH: 20 } } } } }
  )
  assert.equal(withBreakdown.rateBreakdown.normal.rateMtH, 90)
  assert.equal(withBreakdown.stopHoursBefore, 1)
  assert.equal(withBreakdown.stopHoursDuring, 2)
  assert.equal(withBreakdown.stopHoursAfter, 0)
})

test('evidence sections list quantities, rates and hours; none without a breakdown', async () => {
  const { rateEvidenceSections } = await import('./managementDashboardRateEvidence.js')
  assert.deepEqual(rateEvidenceSections({}), [])
  const sections = rateEvidenceSections(
    mergeCargoRatesIntoRow(
      { id: 1 },
      { 1: { voyage: { rateMtH: 40, loggedHours: 10, breakdown: { stopCount: 2, downtime: { hours: 3.5, gapHours: 1.5, noReasonHours: 1.5, reasons: [{ code: 'OVT', name: 'Waiting overtime', hours: 2 }] }, stopHours: { before: 1, during: 2, after: 0, total: 3 }, normal: { qty: 900, hours: 6, rateMtH: 150 }, kuras: { qty: 100, hours: 4, rateMtH: 25, startedAt: '2026-11-14T08:00:00Z' } } } } }
    ),
    (v) => `@${v}`
  )
  const flat = Object.fromEntries(sections.flatMap((s) => s.rows.map((r) => [r.label, r.value])))
  assert.equal(flat['Pumped (outside kuras)'], '900 MT')
  assert.equal(flat['Cleaned / Kuras'], '100 MT')
  assert.equal(flat['Achieved rate (moved ÷ cargo window)'], '40 MT/h')
  assert.equal(flat['Active rate (pumped ÷ hours entries ran, kuras left out)'], '150 MT/h')
  assert.equal(flat['Cleaning / Kuras rate (cleaned ÷ hours entries ran in kuras)'], '25 MT/h · from @2026-11-14T08:00:00Z')
  assert.equal(flat['Gaps between entries (no entry running)'], '1.5 h')
  assert.equal(flat['Total downtime (gaps + recorded stops, counted once)'], '3.5 h')
  assert.equal(flat['Stops recorded in all phases'], '2')
  assert.equal(flat['Waiting overtime'], '2 h')
  assert.equal(flat['No Reason'], '1.5 h')
})

test('stops without a reason become their own segment, taken from pumping, total unchanged', () => {
  const wf = buildBerthHourSegments([{ ...row, unexplainedHours: 1.5 }], { split: true })
  const by = Object.fromEntries(wf.segs.map((s) => [s.n, s.v]))
  assert.equal(by.Pumping, 2.5)
  assert.equal(by['No reason yet'], 1.5)
  assert.equal(sum(wf.segs), 14)
})
