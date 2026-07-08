/**
 * IANA timezone list + display labels (IANA · UTC offset) for Master Port and similar UIs.
 * Memoized after first build.
 */
import { DateTime } from 'luxon'

const FALLBACK_ZONES = [
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Manila',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Port_Moresby',
  'UTC',
  'Europe/London',
  'America/New_York',
]

/** @type {{ value: string, label: string }[] | null} */
let cachedBase = null

function offsetLabelForZone(id) {
  const dt = DateTime.now().setZone(id)
  if (!dt.isValid) return null
  if (dt.offset === 0) return `${id} · UTC±00:00`
  const zz = dt.toFormat('ZZ')
  return `${id} · UTC${zz}`
}

/**
 * @returns {{ value: string, label: string }[]}
 */
export function getIanaTimeZoneOptions() {
  if (cachedBase) return cachedBase
  let ids = []
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      ids = Intl.supportedValuesOf('timeZone')
    }
  } catch {
    /* ignore */
  }
  if (!ids.length) ids = [...FALLBACK_ZONES]

  const enriched = []
  for (const id of ids) {
    const dt = DateTime.now().setZone(id)
    if (!dt.isValid) continue
    const label = offsetLabelForZone(id)
    if (!label) continue
    enriched.push({ value: id, label, offset: dt.offset })
  }
  enriched.sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value))
  cachedBase = enriched.map(({ value, label }) => ({ value, label }))
  return cachedBase
}

/**
 * Prepend a row when `currentValue` is not in the standard list (legacy DB / typo).
 * @param {string} currentValue
 * @param {{ value: string, label: string }[]} baseOptions from getIanaTimeZoneOptions()
 */
export function mergeTimezoneOptionsWithOrphan(currentValue, baseOptions) {
  const v = String(currentValue || '').trim()
  if (!v) return baseOptions
  if (baseOptions.some((o) => o.value === v)) return baseOptions
  return [
    {
      value: v,
      label: `${v} (current value — not in standard list)`,
    },
    ...baseOptions,
  ]
}
