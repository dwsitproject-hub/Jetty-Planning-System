/**
 * Rows for the "how this was calculated" panel behind the Pumped, Active rate, Cleaned / Kuras
 * and Total downtime columns.
 */
import { voyageFlowRate } from './managementDashboardFlow.js'

const fmt = (n, d = 1) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }))
const mtH = (n) => (n == null ? '—' : `${fmt(n)} MT/h`)
const mt = (n) => (n == null ? '—' : `${fmt(n)} MT`)
const hours = (n) => (n == null ? '—' : `${fmt(n, 2)} h`)

/**
 * @param {object} row voyage row merged with the breakdown
 * @param {(iso: string) => string} formatAt
 * @returns {Array<{ key: string, title: string, rows: Array<{ label: string, value: string, kind?: string }> }>}
 */
export function rateEvidenceSections(row, formatAt = (v) => v) {
  const b = row?.rateBreakdown
  if (!b) return []
  const kurasFrom = b.kuras?.startedAt ? ` · from ${formatAt(b.kuras.startedAt)}` : ''
  return [
    {
      key: 'quantities',
      title: 'Quantities',
      rows: [
        { label: 'Pumped (outside kuras)', value: mt(b.normal?.qty), kind: 'source' },
        { label: 'Cleaned / Kuras', value: mt(b.kuras?.qty), kind: 'source' },
      ],
    },
    {
      key: 'rates',
      title: 'Rates',
      rows: [
        { label: 'Achieved rate (moved ÷ cargo window)', value: mtH(voyageFlowRate(row)) },
        { label: 'Active rate (pumped ÷ hours entries ran, kuras left out)', value: mtH(b.normal?.rateMtH), kind: 'computed' },
        { label: 'Cleaning / Kuras rate (cleaned ÷ hours entries ran in kuras)', value: `${mtH(b.kuras?.rateMtH)}${b.kuras?.rateMtH != null ? kurasFrom : ''}`, kind: 'computed' },
      ],
    },
    {
      key: 'hours',
      title: 'Hours',
      rows: [
        { label: 'Cargo window (first start → last end)', value: hours(row.voyageLoggedHours) },
        { label: 'Entries running, outside kuras', value: hours(b.normal?.hours) },
        { label: 'Entries running, in kuras', value: hours(b.kuras?.hours) },
        { label: 'Total downtime (stops during cargo)', value: hours(b.stopHours?.during), kind: 'computed' },
        { label: 'Stops recorded in all phases', value: String(b.stopCount ?? 0) },
      ],
    },
  ]
}
