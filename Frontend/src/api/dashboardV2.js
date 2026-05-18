import { apiGet } from './client.js'

export function fetchDashboardV2Weekly({ startDate, endDate }) {
  const sp = new URLSearchParams()
  if (startDate) sp.set('start_date', startDate)
  if (endDate) sp.set('end_date', endDate)
  const q = sp.toString()
  return apiGet(`/dashboard-v2/weekly-trends${q ? `?${q}` : ''}`)
}
