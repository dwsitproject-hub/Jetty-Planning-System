import { apiGet } from './client.js'

export function fetchDashboardV2Weekly({ startDate, endDate, purposes, commodityIds } = {}) {
  const sp = new URLSearchParams()
  if (startDate) sp.set('start_date', startDate)
  if (endDate) sp.set('end_date', endDate)
  if (Array.isArray(purposes)) {
    for (const p of purposes) {
      if (p) sp.append('purpose', p)
    }
  }
  if (Array.isArray(commodityIds)) {
    for (const id of commodityIds) {
      if (id != null && id !== '') sp.append('commodity_id', String(id))
    }
  }
  const q = sp.toString()
  return apiGet(`/dashboard-v2/weekly-trends${q ? `?${q}` : ''}`)
}
