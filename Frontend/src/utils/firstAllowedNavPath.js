/** Ordered app landing routes — first match wins (mirrors sidebar nav priority). */
export const APP_NAV_ROUTES = [
  { path: '/', pageKey: 'dashboard' },
  { path: '/ops-analytics', pageKey: 'dashboard-analytics' },
  { path: '/management-dashboard', pageKey: 'management-dashboard' },
  { path: '/shipment-plans', pageKey: 'shipment-plan' },
  { path: '/allocation-plans', pageKey: 'allocation-plan' },
  { path: '/at-berth', pageKey: 'at-berth' },
  { path: '/operator/at-berth', pageKey: 'operator-at-berth' },
  { path: '/verification', pageKey: 'verification' },
  { path: '/demurrage-risk-calculator', pageKey: 'demurrage-risk-calculator' },
  { path: '/reporting', pageKey: 'reporting' },
  { path: '/master', pageKey: 'master' },
  { path: '/admin', pageKey: 'admin' },
]

export function pathToPageKey(pathname) {
  if (!pathname || pathname.startsWith('/reporting') || pathname.startsWith('/dev/')) return null
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/ops-analytics')) return 'dashboard-analytics'
  if (pathname.startsWith('/management-dashboard')) return 'management-dashboard'
  if (pathname.startsWith('/jetty-live')) return 'allocation-plan'
  if (pathname.startsWith('/demurrage-risk-calculator')) return 'demurrage-risk-calculator'
  if (pathname.startsWith('/master/port')) return 'master-port'
  if (pathname.startsWith('/master/jetty-layout')) return 'master-jetty-layout'
  if (pathname.startsWith('/master/tanks')) return 'master-tanks'
  if (pathname.startsWith('/tank-farm')) return 'tank-farm'
  if (pathname.startsWith('/master/jetty')) return 'master-jetty'
  if (pathname.startsWith('/master/si-term')) return 'master-si-term'
  if (pathname.startsWith('/master/si-shipper')) return 'master-si-shipper'
  if (pathname.startsWith('/master/si-loading-port')) return 'master-si-loading-port'
  if (pathname.startsWith('/master/si-surveyor')) return 'master-si-surveyor'
  if (pathname.startsWith('/master/si-agent')) return 'master-si-agent'
  if (pathname.startsWith('/master/si-commodity')) return 'master-si-commodity'
  if (pathname.startsWith('/master/freight-terms')) return 'master-si-freight-terms'
  if (pathname.startsWith('/master')) return 'master'
  if (pathname.startsWith('/shipping-instruction')) return 'shipment-plan'
  if (pathname.startsWith('/shipment-plans')) return 'shipment-plan'
  if (pathname.startsWith('/allocation-plans')) return 'allocation-plan'
  if (pathname.startsWith('/allocation') || pathname.startsWith('/berthing')) return 'allocation-plan'
  if (pathname.startsWith('/at-berth')) return 'at-berth'
  if (pathname.startsWith('/operator')) return 'operator-at-berth'
  if (pathname.startsWith('/loading/operation')) return 'loading'
  if (pathname.startsWith('/loading') || pathname.startsWith('/unloading')) return 'loading'
  if (pathname.startsWith('/quality')) return 'quality'
  if (pathname.startsWith('/verification')) return 'verification'
  if (pathname.startsWith('/admin')) return 'admin'
  return pathname.slice(1).split('/')[0] || 'dashboard'
}

export function firstAllowedNavPath(canView) {
  for (const route of APP_NAV_ROUTES) {
    if (canView(route.pageKey)) return route.path
  }
  return null
}

export function safeReturnPath(raw, canView) {
  if (raw == null || typeof raw !== 'string') {
    return firstAllowedNavPath(canView) || '/'
  }
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return firstAllowedNavPath(canView) || '/'
  }
  const pageKey = pathToPageKey(trimmed)
  if (pageKey && canView(pageKey)) return trimmed
  return firstAllowedNavPath(canView) || '/'
}
