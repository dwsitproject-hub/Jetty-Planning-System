/**
 * Rows for the "how this rate was calculated" panel (net-rate feature):
 * gross / net / normal / kuras rates and the stop hours behind them.
 */
import { voyageFlowRate } from './managementDashboardFlow.js'
import { voyageNetRate } from './managementDashboardCargoRate.js'

const fmt = (n, d = 1) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }))
const mtH = (n) => (n == null ? '—' : `${fmt(n)} MT/h`)
const hours = (n) => (n == null ? '—' : `${fmt(n, 2)} h`)

/**
 * @param {object} row voyage row merged with the rate breakdown
 * @param {(iso: string) => string} formatAt
 * @returns {Array<{ key: string, title: string, rows: Array<{ label: string, value: string, kind?: string }> }>}
 */
export function rateEvidenceSections(row, formatAt = (v) => v) {
  const b = row?.rateBreakdown
  if (!b) return []
  const kurasNote = b.kuras?.startedAt ? ` · from ${formatAt(b.kuras.startedAt)}` : ''
  return [
    {
      key: 'rates',
      title: 'Rates',
      rows: [
        { label: 'Gross rate (moved ÷ cargo window)', value: mtH(voyageFlowRate(row)), kind: 'source' },
        { label: 'Net rate (moved ÷ pumping hours)', value: mtH(voyageNetRate(row)), kind: 'computed' },
        { label: 'Normal pumping rate', value: mtH(b.normal?.rateMtH) },
        { label: 'Kuras rate', value: `${mtH(b.kuras?.rateMtH)}${b.kuras?.rateMtH != null ? kurasNote : ''}` },
      ],
    },
    {
      key: 'hours',
      title: 'Hours',
      rows: [
        { label: 'Cargo window (first start → last end)', value: hours(row.voyageLoggedHours), kind: 'source' },
        { label: 'Stopped during cargo (recorded)', value: hours(b.stopHours?.during) },
        { label: 'Pumping hours', value: hours(b.pumpingHours), kind: 'computed' },
        { label: 'Stopped before cargo started', value: hours(b.stopHours?.before) },
        { label: 'Stopped after cargo ended', value: hours(b.stopHours?.after) },
        { label: 'Stops recorded', value: String(b.stopCount ?? 0) },
      ],
    },
  ]
}
