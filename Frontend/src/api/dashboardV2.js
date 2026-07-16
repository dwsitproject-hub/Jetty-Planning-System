import { apiGet } from './client.js'

function buildDashboardV2Query({ startDate, endDate, purposes, commodityIds } = {}) {
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
  return sp.toString()
}

export function fetchDashboardV2Weekly({ startDate, endDate, purposes, commodityIds } = {}) {
  const q = buildDashboardV2Query({ startDate, endDate, purposes, commodityIds })
  return apiGet(`/dashboard-v2/weekly-trends${q ? `?${q}` : ''}`)
}

export function fetchDashboardV2PipelineActuals({ startDate, endDate, purposes, commodityIds } = {}) {
  const q = buildDashboardV2Query({ startDate, endDate, purposes, commodityIds })
  return apiGet(`/dashboard-v2/pipeline-actuals${q ? `?${q}` : ''}`)
}
