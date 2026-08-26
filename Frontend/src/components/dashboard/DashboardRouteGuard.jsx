import { Navigate } from 'react-router-dom'
import { useRbac } from '../../context/RbacContext'

const DASHBOARD_FALLBACK_ROUTES = [
  { path: '/', pageKey: 'dashboard' },
  { path: '/ops-analytics', pageKey: 'dashboard-analytics' },
  { path: '/management-dashboard', pageKey: 'management-dashboard' },
]

export function firstAllowedDashboardPath(canView) {
  for (const route of DASHBOARD_FALLBACK_ROUTES) {
    if (canView(route.pageKey)) return route.path
  }
  return '/shipment-plans'
}

export default function DashboardRouteGuard({ pageKey, children }) {
  const { loading, canView } = useRbac()

  if (loading) {
    return (
      <div className="dashboard v2-dashboard">
        <p className="text-steel">Loading…</p>
      </div>
    )
  }

  if (!canView(pageKey)) {
    const fallback = firstAllowedDashboardPath(canView)
    return <Navigate to={fallback} replace />
  }

  return children
}
