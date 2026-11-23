import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNoFlowReportWorkbook } from './noFlowReportExcel.js'

const report = {
  range: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T00:00:00.000Z' },
  summary: { stopHours: 10 },
  byReason: [
    { code: 'OVT', nameEn: 'Over tank', nameId: 'Overtank', category: 'terminal', hours: 7 },
    { code: 'HOA', nameEn: 'Waiting HO', nameId: 'Menunggu HO', category: 'external', hours: 3 },
  ],
  byVoyage: [{ operationId: 1, vessel: 'BG ONE', jetty: 'J1', totalHours: 10, byReason: { OVT: 7, HOA: 3 } }],
  stops: [{ id: 5, vessel: 'BG ONE', jetty: 'J1', startedAt: '2026-11-02T01:00:00.000Z', endedAt: null, hours: 3, phase: 'before', category: 'external', reasonCode: 'HOA', reasonNameEn: 'Waiting HO', reasonNameId: 'Menunggu HO', note: 'waiting', source: 'manual' }],
}

test('workbook has the vessel by reason table and the stop list', () => {
  const wb = buildNoFlowReportWorkbook(report, { language: 'en' })
  const fleet = wb.getWorksheet('Vessel by reason')
  assert.deepEqual([4, 5, 6].map((r) => fleet.getCell(r, 2).value), ['Vessel', 'BG ONE', 'TOTAL'])
  assert.equal(fleet.getCell(4, 4).value, 'Over tank')
  assert.equal(fleet.getCell(5, 4).value, 7)
  assert.equal(fleet.getCell(6, 6).value, 10)
  const list = wb.getWorksheet('All stops')
  assert.equal(list.getCell(2, 4).value, 'in progress')
  assert.equal(list.getCell(2, 6).value, 'Before cargo')
  assert.equal(list.getCell(2, 7).value, 'External')
  assert.equal(buildNoFlowReportWorkbook(report, { language: 'id' }).getWorksheet('Vessel by reason').getCell(4, 4).value, 'Overtank')
})
