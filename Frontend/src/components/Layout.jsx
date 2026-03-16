import { useState, useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import ActivityLogPanel from './ActivityLogPanel'

const navStructure = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/shipping-instruction', label: 'Shipping Instruction', icon: '📄' },
  { path: '/allocation', label: 'Allocation & Berthing', icon: '⚓' },
  { path: '/at-berth', label: 'At-Berth Executions', icon: '🚢' },
  { path: '/verification', label: 'Clearance', icon: '🚀' },
  { path: '/reporting', label: 'Reporting', icon: '📑' },
  { path: '/master', label: 'Master Menu', icon: '📋' },
  { path: '/admin', label: 'Admin', icon: '⚙️' },
]

function isPathActive(path, currentPath) {
  if (path === '/') return currentPath === '/'
  return currentPath === path || currentPath.startsWith(path + '/')
}

/** Map pathname to Activity Log pageKey; null = do not show panel (e.g. Reporting). */
function pathToPageKey(pathname) {
  if (!pathname || pathname.startsWith('/reporting')) return null
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/master/port')) return 'master-port'
  if (pathname.startsWith('/master/jetty-layout')) return 'master-jetty-layout'
  if (pathname.startsWith('/master/jetty')) return 'master-jetty'
  if (pathname.startsWith('/master')) return 'master'
  if (pathname.startsWith('/shipping-instruction')) return 'shipping-instruction'
  if (pathname.startsWith('/allocation') || pathname.startsWith('/berthing')) return 'allocation'
  if (pathname.startsWith('/at-berth')) return 'at-berth'
  if (pathname.startsWith('/loading') || pathname.startsWith('/unloading')) return 'loading'
  if (pathname.startsWith('/quality')) return 'quality'
  if (pathname.startsWith('/verification')) return 'verification'
  if (pathname.startsWith('/admin')) return 'admin'
  return pathname.slice(1).split('/')[0] || 'dashboard'
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const currentPath = location.pathname

  const closeSidebar = () => setSidebarOpen(false)
  const activityLogPageKey = useMemo(() => pathToPageKey(currentPath), [currentPath])

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
        <span className="topbar__logo">Jetty Planning System</span>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--color-text-steel)' }}>Mockup</span>
      </header>

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <div className="main-wrap">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <nav className="sidebar-nav">
            {navStructure.map((item, i) => {
              if (!item.children) {
                return (
                  <NavLink
                    key={item.path || i}
                    to={item.path}
                    className={({ isActive }) => (isActive || isPathActive(item.path, currentPath) ? 'active' : '')}
                    onClick={closeSidebar}
                  >
                    {item.icon && <span className="sidebar-nav__icon" aria-hidden>{item.icon}</span>}
                    {item.label}
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
                    >
                      {child.icon && <span className="sidebar-nav__icon" aria-hidden>{child.icon}</span>}
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>

        <main className="content">{children}</main>
        <ActivityLogPanel pageKey={activityLogPageKey} />
      </div>
    </div>
  )
}
