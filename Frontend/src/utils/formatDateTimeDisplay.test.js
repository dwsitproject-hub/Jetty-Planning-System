import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDateDisplay,
  formatDateTimeDisplay,
  formatDateTimeCompact,
  formatActivityLogChangeValue,
  stripLegacyDatetimeLt,
} from './formatDateTimeDisplay.js'
import { JPS_LOCALE_STORAGE_KEY } from '../i18n/constants.js'

const storage = new Map()

function installLocalStorageMock() {
  global.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  }
}

describe('formatDateTimeDisplay', () => {
  beforeEach(() => {
    storage.clear()
    installLocalStorageMock()
  })

  afterEach(() => {
    delete global.localStorage
  })

  it('formats ISO datetime as DD/MMM/YYYY HH:mm in en-GB', () => {
    const out = formatDateTimeDisplay('2026-03-25T14:30:00')
    assert.match(out, /^25\/Mar\/2026 14:30$/)
  })

  it('formats date-only YYYY-MM-DD as DD/MMM/YYYY', () => {
    const out = formatDateDisplay('2026-03-25')
    assert.match(out, /^25\/Mar\/2026$/)
  })

  it('uses 24-hour time (no AM/PM)', () => {
    const out = formatDateTimeDisplay('2026-03-25T14:30:00')
    assert.doesNotMatch(out, /AM|PM/i)
    assert.match(out, /14:30/)
  })

  it('strips legacy LT suffix from unparseable strings', () => {
    assert.equal(stripLegacyDatetimeLt('25/03 14:30 LT'), '25/03 14:30')
    assert.equal(formatDateTimeDisplay('cached value LT'), 'cached value')
  })

  it('returns em dash for empty values', () => {
    assert.equal(formatDateTimeDisplay(null), '—')
    assert.equal(formatDateTimeDisplay(''), '—')
    assert.equal(formatDateDisplay(undefined), '—')
  })

  it('uses Indonesian month abbreviations when jps_locale is id', () => {
    localStorage.setItem(JPS_LOCALE_STORAGE_KEY, 'id')
    const out = formatDateDisplay('2026-05-15')
    assert.match(out, /^15\/Mei\/2026$/)
  })

  it('formats compact datetime as DD MMM HH:mm without year', () => {
    const out = formatDateTimeCompact('2026-03-25T14:30:00')
    assert.match(out, /^25 Mar 14:30$/)
    assert.doesNotMatch(out, /2026/)
  })

  it('formats compact datetime with Indonesian month when locale is id', () => {
    localStorage.setItem(JPS_LOCALE_STORAGE_KEY, 'id')
    const out = formatDateTimeCompact('2026-05-15T08:05:00')
    assert.match(out, /^15 Mei 08:05$/)
  })
})

describe('formatActivityLogChangeValue', () => {
  beforeEach(() => {
    storage.clear()
    installLocalStorageMock()
  })

  afterEach(() => {
    delete global.localStorage
  })

  it('returns em dash for empty values', () => {
    assert.equal(formatActivityLogChangeValue(null), '—')
    assert.equal(formatActivityLogChangeValue(undefined), '—')
    assert.equal(formatActivityLogChangeValue(''), '—')
  })

  it('formats zoned ISO datetimes the same as formatDateTimeDisplay', () => {
    const iso = '2026-09-10T03:00:00.000Z'
    const out = formatActivityLogChangeValue(iso)
    assert.equal(out, formatDateTimeDisplay(iso))
    assert.doesNotMatch(out, /^\d{4}-\d{2}-\d{2}T|\.000Z$/i)
    assert.match(out, /^\d{2}\/[A-Za-z]+\/\d{4} \d{2}:\d{2}$/)
  })

  it('formats offset ISO datetimes', () => {
    const iso = '2026-09-10T10:00:00+07:00'
    const out = formatActivityLogChangeValue(iso)
    assert.equal(out, formatDateTimeDisplay(iso))
    assert.doesNotMatch(out, /\+07:00/)
  })

  it('leaves jetty IDs, names, and date-only strings unchanged', () => {
    assert.equal(formatActivityLogChangeValue(1), '1')
    assert.equal(formatActivityLogChangeValue('1'), '1')
    assert.equal(formatActivityLogChangeValue('Jetty 1A'), 'Jetty 1A')
    assert.equal(formatActivityLogChangeValue('2026-09-10'), '2026-09-10')
    assert.equal(formatActivityLogChangeValue('2026-09-10T03:00:00'), '2026-09-10T03:00:00')
  })
})
