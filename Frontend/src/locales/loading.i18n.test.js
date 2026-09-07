import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const en = JSON.parse(readFileSync(join(__dirname, 'en/loading.json'), 'utf8'))
const id = JSON.parse(readFileSync(join(__dirname, 'id/loading.json'), 'utf8'))

const REQUIRED_KEYS = [
  'sampling.entriesTitle',
  'sampling.qualitySummaryTitle',
  'sampling.recordedSamples',
  'sampling.chipAvgFfa',
  'sampling.chipAvgMoisture',
  'extractWarning.ocr_quality',
  'extractWarning.vessel_mismatch',
  'extractWarning.palka_count',
  'extractWarning.avg_ffa_mismatch',
  'extractWarning.avg_moisture_mismatch',
  'extractApply.added_one',
  'extractApply.added_other',
  'extractApply.qualityFilled_one',
  'extractApply.qualityFilled_other',
  'extractApply.none',
  'extractReview.title',
]

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

test('EN and ID loading locales define the same sampling OCR keys', () => {
  for (const path of REQUIRED_KEYS) {
    const enVal = getPath(en, path)
    const idVal = getPath(id, path)
    assert.equal(typeof enVal, 'string', `missing EN key: ${path}`)
    assert.equal(typeof idVal, 'string', `missing ID key: ${path}`)
    assert.notEqual(enVal.trim(), '', `empty EN key: ${path}`)
    assert.notEqual(idVal.trim(), '', `empty ID key: ${path}`)
  }
})

test('summary chip labels no longer reference rows below', () => {
  assert.match(en.sampling.chipAvgFfa, /recorded sample/i)
  assert.match(en.sampling.chipAvgMoisture, /recorded sample/i)
  assert.match(id.sampling.chipAvgFfa, /sampel tercatat/i)
  assert.match(id.sampling.chipAvgMoisture, /sampel tercatat/i)
  assert.doesNotMatch(en.sampling.chipAvgFfa, /rows below/i)
  assert.doesNotMatch(id.sampling.chipAvgFfa, /baris di bawah/i)
})

test('quality summary title is the short form', () => {
  assert.equal(en.sampling.qualitySummaryTitle, 'Quality Summary')
  assert.equal(id.sampling.qualitySummaryTitle, 'Ringkasan Mutu')
})

const SOUNDING_KEYS = [
  'sounding.skipAtg',
  'sounding.addTank',
  'sounding.beginCapture',
  'sounding.soundingTime',
  'sounding.atgSourceLive',
  'sounding.atgSourceSample',
  'sounding.atgSourceSkipped',
  'sounding.historicalNoSample',
  'sounding.saveRequiresReading',
]

test('EN and ID loading locales define Phase 2 sounding keys', () => {
  for (const path of SOUNDING_KEYS) {
    const enVal = getPath(en, path)
    const idVal = getPath(id, path)
    assert.equal(typeof enVal, 'string', `missing EN key: ${path}`)
    assert.equal(typeof idVal, 'string', `missing ID key: ${path}`)
    assert.notEqual(enVal.trim(), '', `empty EN key: ${path}`)
    assert.notEqual(idVal.trim(), '', `empty ID key: ${path}`)
  }
})
