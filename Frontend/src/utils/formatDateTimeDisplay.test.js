import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDateDisplay,
  formatDateTimeDisplay,
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
})
