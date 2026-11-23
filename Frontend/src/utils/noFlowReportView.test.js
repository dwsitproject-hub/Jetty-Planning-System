import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  API_MAX_DAYS, buildVesselReasonMatrix, dashboardWindowToRange, dateInputsToRange, reportReasonLabel, toDateInput,
} from './noFlowReportView.js'

const report = {
  summary: { stopHours: 10 },
  byReason: [
    { code: 'OVT', nameEn: 'Over tank', nameId: 'Overtank', category: 'terminal', hours: 7 },
    { code: 'HOA', nameEn: 'Waiting HO', nameId: 'Menunggu HO', category: 'external', hours: 3 },
  ],
  byVoyage: [{ operationId: 1, vessel: 'BG ONE', jetty: 'J1', totalHours: 10, byReason: { OVT: 7, HOA: 3 } }],
}

test('reason label follows the language', () => {
  assert.equal(reportReasonLabel(report.byReason[0], 'en'), 'Over tank')
  assert.equal(reportReasonLabel(report.byReason[0], 'id'), 'Overtank')
  assert.equal(reportReasonLabel({ nameEn: 'X', nameId: '' }, 'id'), 'X')
})

test('vessel by reason matrix keeps the biggest reasons first', () => {
  const m = buildVesselReasonMatrix(report, 'en')
  assert.deepEqual(m.columns.map((c) => c.code), ['OVT', 'HOA'])
  assert.deepEqual(m.rows[0].cells, { OVT: 7, HOA: 3 })
  assert.equal(m.grandTotal, 10)
})

test('dashboard period becomes API instants, capped to the maximum', () => {
  const now = Date.parse('2026-11-20T00:00:00Z')
  const day = 86400000
  const r = dashboardWindowToRange({ start: now - 30 * day, end: now + 5 * day }, now)
  assert.equal(r.to, new Date(now).toISOString())
  assert.equal(r.from, new Date(now - 30 * day).toISOString())
  const all = dashboardWindowToRange({ start: null, end: null }, now)
  assert.equal((Date.parse(all.to) - Date.parse(all.from)) / day, API_MAX_DAYS)
})

test('date inputs include the last day', () => {
  const r = dateInputsToRange('2026-11-01', '2026-11-03')
  assert.equal((Date.parse(r.to) - Date.parse(r.from)) / 86400000, 3)
  assert.equal(toDateInput(new Date(2026, 10, 5).getTime()), '2026-11-05')
})
