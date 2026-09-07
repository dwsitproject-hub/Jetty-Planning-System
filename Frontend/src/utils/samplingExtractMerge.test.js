import test from 'node:test'
import assert from 'node:assert/strict'
import {
  proposeSamplingExtractMerge,
  defaultSamplingExtractChoices,
  applySamplingExtractMerge,
  samplingExtractChoicesAreEmpty,
  summarizeSamplingExtractApply,
} from './samplingExtractMerge.js'

const EXTRACTED = [
  { noPalka: '1P', ffa: '5.47', moisture: '0.38' },
  { noPalka: '2P', ffa: '5.36', moisture: '0.32' },
  { noPalka: '1S', ffa: '5.47', moisture: '0.25' },
]

const fields = (over = {}) => ({
  records: EXTRACTED,
  documentDate: '2026-08-25',
  vesselName: 'MT Victoria II',
  dobi: '1.58',
  iodineValue: '51.25',
  statedAvgFfa: null,
  statedAvgMoisture: null,
  ...over,
})

const emptySampling = {
  startTime: '',
  endTime: '',
  remark: '',
  records: [],
  ffaAverage: '',
  moistureAverage: '',
  dobi: '',
  iodineValue: '',
}

/** Averages consistent with EXTRACTED (5.43 / 0.32), so no mismatch warning muddies the assertions. */
const withAverages = (over = {}) => fields({ statedAvgFfa: 5.43, statedAvgMoisture: 0.32, ...over })
let idCounter = 0
const makeId = () => `test-id-${(idCounter += 1)}`

test('empty form: every extracted row is new', () => {
  const p = proposeSamplingExtractMerge(emptySampling, fields())
  assert.equal(p.newRecords.length, 3)
  assert.equal(p.conflicts.length, 0)
  assert.equal(p.unchanged.length, 0)
})

test('classifies new, conflicting and unchanged rows', () => {
  const sampling = {
    ...emptySampling,
    records: [
      { id: 'a', noPalka: '1P', ffa: '5.40', moisture: '0.38' }, // FFA differs -> conflict
      { id: 'b', noPalka: '2P', ffa: '5.36', moisture: '0.32' }, // identical -> unchanged
    ],
  }
  const p = proposeSamplingExtractMerge(sampling, fields())
  assert.deepEqual(p.conflicts.map((c) => c.key), ['1P'])
  assert.deepEqual(p.unchanged.map((c) => c.key), ['2P'])
  assert.deepEqual(p.newRecords.map((c) => c.key), ['1S'])
  assert.deepEqual(p.conflicts[0].current, { ffa: '5.40', moisture: '0.38' })
  assert.deepEqual(p.conflicts[0].extracted, { ffa: '5.47', moisture: '0.38' })
})

test('numerically equal values are not a conflict', () => {
  const sampling = { ...emptySampling, records: [{ id: 'a', noPalka: '1P', ffa: '5.470', moisture: '.38' }] }
  const p = proposeSamplingExtractMerge(sampling, fields())
  assert.equal(p.conflicts.length, 0)
  assert.deepEqual(p.unchanged.map((c) => c.key), ['1P'])
})

test('palka matching ignores case and spacing', () => {
  const sampling = { ...emptySampling, records: [{ id: 'a', noPalka: ' 1p ', ffa: '1.00', moisture: '1.00' }] }
  const p = proposeSamplingExtractMerge(sampling, fields())
  assert.deepEqual(p.conflicts.map((c) => c.key), ['1P'])
})

test('duplicate extracted rows are collapsed', () => {
  const p = proposeSamplingExtractMerge(
    emptySampling,
    fields({ records: [...EXTRACTED, { noPalka: '1P', ffa: '9.99', moisture: '9.99' }] })
  )
  assert.equal(p.newRecords.length, 3)
})

test('start time defaults on only when empty', () => {
  const on = proposeSamplingExtractMerge(emptySampling, fields())
  assert.equal(on.startTimeHint.value, '2026-08-25T00:00')
  assert.equal(on.startTimeHint.defaultOn, true)

  const off = proposeSamplingExtractMerge({ ...emptySampling, startTime: '2026-08-29T00:40' }, fields())
  assert.equal(off.startTimeHint.defaultOn, false)
})

test('quality summary values are all proposed as new when the form is empty', () => {
  const p = proposeSamplingExtractMerge(emptySampling, withAverages())
  assert.deepEqual(
    p.qualityProposals.map((q) => [q.key, q.extracted, q.status]),
    [
      ['ffaAverage', '5.43', 'new'],
      ['moistureAverage', '0.32', 'new'],
      ['dobi', '1.58', 'new'],
      ['iodineValue', '51.25', 'new'],
    ]
  )
  const choices = defaultSamplingExtractChoices(p)
  assert.deepEqual(choices.quality, {
    ffaAverage: 'extracted',
    moistureAverage: 'extracted',
    dobi: 'extracted',
    iodineValue: 'extracted',
  })
})

test('quality values missing from the document are not proposed', () => {
  const p = proposeSamplingExtractMerge(emptySampling, fields({ dobi: null }))
  assert.deepEqual(p.qualityProposals.map((q) => q.key), ['iodineValue'])
})

test('quality values already on the form are conflict or unchanged', () => {
  const sampling = { ...emptySampling, dobi: '1.58', iodineValue: '52.30' }
  const p = proposeSamplingExtractMerge(sampling, fields())
  const byKey = Object.fromEntries(p.qualityProposals.map((q) => [q.key, q]))
  assert.equal(byKey.dobi.status, 'unchanged')
  assert.equal(byKey.iodineValue.status, 'conflict')
  assert.equal(byKey.iodineValue.current, '52.30')
  assert.equal(byKey.iodineValue.extracted, '51.25')

  // Conflicts default to keeping what the operator already entered.
  const choices = defaultSamplingExtractChoices(p)
  assert.equal(choices.quality.iodineValue, 'keep')
})

test('a numerically equal quality value is unchanged, not a conflict', () => {
  const p = proposeSamplingExtractMerge({ ...emptySampling, dobi: '1.580' }, fields())
  const dobi = p.qualityProposals.find((q) => q.key === 'dobi')
  assert.equal(dobi.status, 'unchanged')
})

test('vessel mismatch warns, tolerating prefix and punctuation differences', () => {
  const same = proposeSamplingExtractMerge(emptySampling, fields(), { vesselName: 'Victoria-II' })
  assert.equal(same.warnings.filter((w) => w.code === 'vessel_mismatch').length, 0)

  const diff = proposeSamplingExtractMerge(emptySampling, fields(), { vesselName: 'MT Sinar Bulan' })
  assert.equal(diff.warnings.filter((w) => w.code === 'vessel_mismatch').length, 1)
})

test('palka count mismatch warns', () => {
  const p = proposeSamplingExtractMerge(emptySampling, fields(), { numberOfPalka: 8 })
  assert.equal(p.warnings.filter((w) => w.code === 'palka_count').length, 1)

  const ok = proposeSamplingExtractMerge(emptySampling, fields(), { numberOfPalka: 3 })
  assert.equal(ok.warnings.filter((w) => w.code === 'palka_count').length, 0)
})

test('OCR results warn that rows can be misread or dropped', () => {
  const ocr = proposeSamplingExtractMerge(emptySampling, fields(), { source: 'ocr_image' })
  assert.equal(ocr.warnings.filter((w) => w.code === 'ocr_quality').length, 1)

  for (const source of ['xlsx', 'pdf_text', undefined]) {
    const p = proposeSamplingExtractMerge(emptySampling, fields(), { source })
    assert.equal(p.warnings.filter((w) => w.code === 'ocr_quality').length, 0)
  }
})

test('stated average disagreeing with parsed rows warns', () => {
  // Rows average 5.43; a report claiming 5.90 means rows were missed or misread.
  const p = proposeSamplingExtractMerge(emptySampling, fields({ statedAvgFfa: 5.9 }))
  assert.equal(p.warnings.filter((w) => w.code === 'avg_ffa_mismatch').length, 1)

  const consistent = proposeSamplingExtractMerge(emptySampling, fields({ statedAvgFfa: 5.43 }))
  assert.equal(consistent.warnings.filter((w) => w.code === 'avg_ffa_mismatch').length, 0)
})

test('apply adds only the checked new rows', () => {
  const p = proposeSamplingExtractMerge(emptySampling, fields())
  const choices = defaultSamplingExtractChoices(p)
  choices.includeNew['2P'] = false
  const { nextSampling, summary } = applySamplingExtractMerge(emptySampling, p, choices, { makeId })
  assert.deepEqual(nextSampling.records.map((r) => r.noPalka), ['1P', '1S'])
  assert.equal(summary.added, 2)
})

test('conflicts keep current values unless the operator picks the extracted ones', () => {
  const sampling = { ...emptySampling, records: [{ id: 'a', noPalka: '1P', ffa: '5.40', moisture: '0.38' }] }
  const p = proposeSamplingExtractMerge(sampling, fields())

  const kept = applySamplingExtractMerge(sampling, p, defaultSamplingExtractChoices(p), { makeId })
  assert.equal(kept.nextSampling.records[0].ffa, '5.40')
  assert.equal(kept.summary.updated, 0)

  const choices = defaultSamplingExtractChoices(p)
  choices.conflictMode['1P'] = 'extracted'
  const applied = applySamplingExtractMerge(sampling, p, choices, { makeId })
  assert.equal(applied.nextSampling.records[0].ffa, '5.47')
  assert.equal(applied.summary.updated, 1)
})

test('overwriting a conflict updates every duplicate row for that palka', () => {
  const sampling = {
    ...emptySampling,
    records: [
      { id: 'a', noPalka: '1P', ffa: '5.40', moisture: '0.38' },
      { id: 'b', noPalka: '1P', ffa: '5.41', moisture: '0.39' },
    ],
  }
  const p = proposeSamplingExtractMerge(sampling, fields())
  const choices = defaultSamplingExtractChoices(p)
  choices.conflictMode['1P'] = 'extracted'
  const { nextSampling, summary } = applySamplingExtractMerge(sampling, p, choices, { makeId })
  const onePalka = nextSampling.records.filter((r) => r.noPalka.trim().toUpperCase() === '1P')
  assert.deepEqual(onePalka.map((r) => r.ffa), ['5.47', '5.47'])
  assert.equal(summary.updated, 2)
})

test('apply never touches end time, and only sets start time when chosen', () => {
  const sampling = { ...emptySampling, endTime: '2026-08-29T02:00' }
  const p = proposeSamplingExtractMerge(sampling, fields())
  const choices = defaultSamplingExtractChoices(p)

  choices.applyStartTime = false
  const skipped = applySamplingExtractMerge(sampling, p, choices, { makeId })
  assert.equal(skipped.nextSampling.startTime, '')
  assert.equal(skipped.nextSampling.endTime, '2026-08-29T02:00')

  choices.applyStartTime = true
  const set = applySamplingExtractMerge(sampling, p, choices, { makeId })
  assert.equal(set.nextSampling.startTime, '2026-08-25T00:00')
  assert.equal(set.nextSampling.endTime, '2026-08-29T02:00')
})

test('apply fills the quality values that were selected', () => {
  const p = proposeSamplingExtractMerge(emptySampling, withAverages())
  const choices = defaultSamplingExtractChoices(p)
  choices.quality.moistureAverage = 'keep'
  const { nextSampling, summary } = applySamplingExtractMerge(emptySampling, p, choices, { makeId })
  assert.equal(nextSampling.ffaAverage, '5.43')
  assert.equal(nextSampling.moistureAverage, '')
  assert.equal(nextSampling.dobi, '1.58')
  assert.equal(nextSampling.iodineValue, '51.25')
  assert.equal(summary.qualityFilled, 3)
})

test('a quality conflict is only overwritten when the operator picks the extracted value', () => {
  const sampling = { ...emptySampling, iodineValue: '52.30' }
  const p = proposeSamplingExtractMerge(sampling, fields())

  const kept = applySamplingExtractMerge(sampling, p, defaultSamplingExtractChoices(p), { makeId })
  assert.equal(kept.nextSampling.iodineValue, '52.30')

  const choices = defaultSamplingExtractChoices(p)
  choices.quality.iodineValue = 'extracted'
  const applied = applySamplingExtractMerge(sampling, p, choices, { makeId })
  assert.equal(applied.nextSampling.iodineValue, '51.25')
})

test('apply leaves Remark alone now that the values have their own fields', () => {
  const sampling = { ...emptySampling, remark: 'Sampling done with surveyor' }
  const p = proposeSamplingExtractMerge(sampling, withAverages())
  const { nextSampling } = applySamplingExtractMerge(sampling, p, defaultSamplingExtractChoices(p), { makeId })
  assert.equal(nextSampling.remark, 'Sampling done with surveyor')
})

test('quality values alone are enough to enable Apply', () => {
  const sampling = { ...emptySampling, startTime: '2026-08-29T00:40', records: EXTRACTED.map((r, i) => ({ id: `x${i}`, ...r })) }
  const p = proposeSamplingExtractMerge(sampling, fields())
  assert.equal(p.newRecords.length, 0)
  assert.equal(samplingExtractChoicesAreEmpty(p, defaultSamplingExtractChoices(p)), false)
})

test('detects when nothing would change', () => {
  const sampling = {
    ...emptySampling,
    startTime: '2026-08-29T00:40',
    records: EXTRACTED.map((r, i) => ({ id: `x${i}`, ...r })),
    dobi: '1.58',
    iodineValue: '51.25',
  }
  const p = proposeSamplingExtractMerge(sampling, fields())
  assert.equal(p.newRecords.length, 0)
  assert.equal(p.conflicts.length, 0)
  assert.equal(samplingExtractChoicesAreEmpty(p, defaultSamplingExtractChoices(p)), true)
})

test('handles an empty extract result without throwing', () => {
  const p = proposeSamplingExtractMerge(emptySampling, fields({ records: [], documentDate: null, dobi: null, iodineValue: null }))
  assert.equal(p.totalExtracted, 0)
  assert.equal(p.startTimeHint, null)
  assert.deepEqual(p.qualityProposals, [])
  assert.equal(samplingExtractChoicesAreEmpty(p, defaultSamplingExtractChoices(p)), true)
})

test('summary sentence reads naturally', () => {
  assert.equal(
    summarizeSamplingExtractApply({ added: 8, updated: 0, startTimeSet: true }, 'Quality.xlsx'),
    '8 palka rows added, start time set from Quality.xlsx.'
  )
  assert.equal(summarizeSamplingExtractApply({ added: 1 }, ''), '1 palka row added.')
  assert.equal(
    summarizeSamplingExtractApply({ qualityFilled: 4 }, ''),
    '4 quality values filled.'
  )
  assert.equal(summarizeSamplingExtractApply({ qualityFilled: 1 }, ''), '1 quality value filled.')
  assert.equal(summarizeSamplingExtractApply({}, 'a.pdf'), 'No changes applied.')
})
