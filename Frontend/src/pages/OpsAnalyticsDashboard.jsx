import DashboardRouteGuard from '../components/dashboard/DashboardRouteGuard'
import DashboardShell from '../components/dashboard/DashboardShell'
import { useOpsAnalyticsDashboard } from '../hooks/useOpsAnalyticsDashboard'

export default function OpsAnalyticsDashboard() {
  const { mode, pageKey } = useOpsAnalyticsDashboard()

  return (
    <DashboardRouteGuard pageKey={pageKey}>
      <DashboardShell mode={mode} />
    </DashboardRouteGuard>
  )
}
