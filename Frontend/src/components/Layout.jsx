import { useState, useMemo, useEffect, useLayoutEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import ActivityLogPanel from './ActivityLogPanel'
import { useRbac } from '../context/RbacContext'
import { useAuth } from '../context/AuthContext'
import { usePortScope } from '../context/PortScopeContext'

const navStructure = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/shipping-instruction', label: 'Shipping Instruction', icon: '📄' },
  { path: '/allocation', label: 'Allocation & Berthing', icon: '⚓' },
  { path: '/at-berth', label: 'At-Berth Executions', icon: '🚢' },
  { path: '/verification', label: 'Clearance', icon: '🚀' },
  { path: '/demurrage-risk-calculator', label: 'Demurrage Risk Calculator', icon: '🧮' },
  { path: '/reporting', label: 'Reporting', icon: '📑' },
  { path: '/master', label: 'Master Menu', icon: '📋' },
  { path: '/admin', label: 'Admin', icon: '⚙️' },
]

function isPathActive(path, currentPath) {
  if (path === '/') return currentPath === '/'
  return currentPath === path || currentPath.startsWith(path + '/')
}

function isPortScopeBypassed(pathname) {
  if (!pathname) return false
  return pathname.startsWith('/admin') || pathname.startsWith('/master')
}

/** Map pathname to Activity Log pageKey; null = do not show panel (e.g. Reporting). */
function pathToPageKey(pathname) {
  if (!pathname || pathname.startsWith('/reporting')) return null
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/demurrage-risk-calculator')) return 'demurrage-risk-calculator'
  if (pathname.startsWith('/master/port')) return 'master-port'
  if (pathname.startsWith('/master/jetty-layout')) return 'master-jetty-layout'
  if (pathname.startsWith('/master/jetty')) return 'master-jetty'
  if (pathname.startsWith('/master/si-term')) return 'master-si-term'
  if (pathname.startsWith('/master/si-shipper')) return 'master-si-shipper'
  if (pathname.startsWith('/master/si-loading-port')) return 'master-si-loading-port'
  if (pathname.startsWith('/master/si-surveyor')) return 'master-si-surveyor'
  if (pathname.startsWith('/master/si-agent')) return 'master-si-agent'
  if (pathname.startsWith('/master/si-commodity')) return 'master-si-commodity'
  if (pathname.startsWith('/master/freight-terms')) return 'master-si-freight-terms'
  if (pathname.startsWith('/master')) return 'master'
  if (pathname.startsWith('/shipping-instruction')) return 'shipping-instruction'
  if (pathname.startsWith('/allocation') || pathname.startsWith('/berthing')) return 'allocation'
  if (pathname.startsWith('/at-berth')) return 'at-berth'
  if (pathname.startsWith('/loading/operation')) return 'loading'
  if (pathname.startsWith('/loading') || pathname.startsWith('/unloading')) return 'loading'
  if (pathname.startsWith('/quality')) return 'quality'
  if (pathname.startsWith('/verification')) return 'verification'
  if (pathname.startsWith('/admin')) return 'admin'
  return pathname.slice(1).split('/')[0] || 'dashboard'
}

const SIDEBAR_COLLAPSED_KEY = 'jps_sidebar_collapsed'

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function SidebarCollapseFabIcon({ expanded }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {expanded ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const location = useLocation()
  const currentPath = location.pathname
  const { loading: rbacLoading, canView, refresh: refreshRbac } = useRbac()
  const { me, logout } = useAuth()
  const {
    loading: portScopeLoading,
    assignedPorts,
    selectedPort,
    requiresSelection,
    noPortAssigned,
    noPortMessage,
  } = usePortScope()
  const navigate = useNavigate()

  const closeSidebar = () => setSidebarOpen(false)

  const handleLogout = async () => {
    logout()
    await refreshRbac()
    navigate('/login')
    closeSidebar()
  }
  const activityLogPageKey = useMemo(() => pathToPageKey(currentPath), [currentPath])
  const currentPageKey = useMemo(() => pathToPageKey(currentPath), [currentPath])
  const portScopeBypassed = isPortScopeBypassed(currentPath)

  useLayoutEffect(() => {
    if (!me || portScopeBypassed || portScopeLoading || noPortAssigned) return
    if (!requiresSelection) return
    const params = new URLSearchParams()
    params.set('returnTo', `${currentPath}${location.search || ''}`)
    navigate(`/select-port?${params.toString()}`, { replace: true })
  }, [
    me,
    portScopeBypassed,
    portScopeLoading,
    noPortAssigned,
    requiresSelection,
    currentPath,
    location.search,
    navigate,
  ])

  const filteredNav = useMemo(() => {
    // While loading permissions, show nothing (avoid flashing unauthorized items).
    if (rbacLoading) return []
    return navStructure.filter((item) => canView(pathToPageKey(item.path)))
  }, [rbacLoading, canView])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed])

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="topbar__nav-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          ☰
        </button>
        <div className="topbar__brand" aria-label="Jetty Planning System">
          <img className="topbar__brand-logo" src="/kpn-header.png" alt="KPN" />
          <div className="topbar__brand-text">
            <span className="topbar__brand-title">Jetty Planning System</span>
            <span className="topbar__brand-tagline">Smart scheduling for smarter ports</span>
          </div>
        </div>
        <div className="topbar__actions">
          {me && !portScopeBypassed && assignedPorts.length > 1 && selectedPort && (
            <button
              type="button"
              className="btn btn--secondary btn--small topbar__greeting"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => {
                const params = new URLSearchParams()
                params.set('returnTo', `${currentPath}${location.search || ''}`)
                navigate(`/select-port?${params.toString()}`)
              }}
              title="Choose a different port"
            >
              <span>Port: {selectedPort.name}</span>
              <span className="admin-role-summary">Change…</span>
            </button>
          )}
          {me && !portScopeBypassed && assignedPorts.length === 1 && selectedPort && (
            <span className="topbar__greeting">Port: {selectedPort.name}</span>
          )}
          <span className="topbar__greeting">
            {me ? `Hi, ${me.displayName || me.username}` : ''}
          </span>
          {me && (
            <button type="button" className="btn btn--secondary btn--small topbar__logout" onClick={handleLogout} title="Logout">
              <LogoutIcon />
              <span>Logout</span>
            </button>
          )}
          {!me && (
            <NavLink to="/login" className="btn btn--secondary btn--small">
              Login
            </NavLink>
          )}
        </div>
      </header>

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <div className="main-wrap">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
          <div className="sidebar__inner">
            <button
              type="button"
              className="sidebar__collapse-fab"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <SidebarCollapseFabIcon expanded={!sidebarCollapsed} />
            </button>

            <div className="sidebar__brand">
              <div className="sidebar__brand-mark" aria-hidden>
                JPS
              </div>
              <div className="sidebar__brand-text">
                <span className="sidebar__brand-title">Jetty Planning</span>
                <span className="sidebar__brand-sub">Operations console</span>
              </div>
            </div>

            <nav className="sidebar-nav">
              {filteredNav.map((item, i) => {
                if (!item.children) {
                  return (
                    <NavLink
                      key={item.path || i}
                      to={item.path}
                      className={({ isActive }) => (isActive || isPathActive(item.path, currentPath) ? 'active' : '')}
                      onClick={closeSidebar}
                      title={item.label}
                    >
                      {item.icon && <span className="sidebar-nav__icon" aria-hidden>{item.icon}</span>}
                      <span className="sidebar-nav__label">{item.label}</span>
                    </NavLink>
                  )
                }

                return (
                  <div key={item.label || i} className="sidebar-nav-group">
                    <span className="sidebar-nav-group__label">{item.label}</span>
                    {item.children.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        className={({ isActive }) => (isActive || isPathActive(child.path, currentPath) ? 'active' : '')}
                        onClick={closeSidebar}
                        title={child.label}
                      >
                        {child.icon && <span className="sidebar-nav__icon" aria-hidden>{child.icon}</span>}
                        <span className="sidebar-nav__label">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )
              })}
            </nav>

          </div>
        </aside>

        <main className="content">
          {me && !portScopeBypassed && portScopeLoading ? (
            <div className="card">
              <p className="text-steel">Loading assigned ports…</p>
            </div>
          ) : me && !portScopeBypassed && noPortAssigned ? (
            <div className="card" style={{ maxWidth: '40rem' }}>
              <h2 style={{ marginTop: 0 }}>Access not configured</h2>
              <p className="text-steel">{noPortMessage}</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn--secondary" onClick={handleLogout}>Back to Login</button>
              </div>
            </div>
          ) : me && !portScopeBypassed && requiresSelection ? (
            <div className="card">
              <p className="text-steel">Opening port selection…</p>
            </div>
          ) : rbacLoading ? (
            <div className="card">
              <p className="text-steel">Loading permissions…</p>
            </div>
          ) : currentPageKey && !canView(currentPageKey) ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Forbidden</h2>
              <p className="text-steel">You don’t have permission to view this page.</p>
            </div>
          ) : (
            children
          )}
        </main>
        <ActivityLogPanel pageKey={activityLogPageKey} />
      </div>
    </div>
  )
}
