import DashboardRouteGuard from '../components/dashboard/DashboardRouteGuard'
import DashboardShell from '../components/dashboard/DashboardShell'
import { useLiveOpsDashboard } from '../hooks/useLiveOpsDashboard'

export default function LiveOpsDashboard() {
  const { mode, pageKey } = useLiveOpsDashboard()

  return (
    <DashboardRouteGuard pageKey={pageKey}>
      <DashboardShell mode={mode} />
    </DashboardRouteGuard>
  )
}
