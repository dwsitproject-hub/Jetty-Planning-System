import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'Dashboard' },
  { path: '/shipping-instruction', label: 'Shipping Instruction' },
  { path: '/allocation', label: 'Allocation' },
  { path: '/docking', label: 'Docking' },
  { path: '/unloading', label: 'Unloading' },
  { path: '/quality', label: 'Quality' },
  { path: '/verification', label: 'Verification' },
]

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  const closeSidebar = () => setSidebarOpen(false)

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
          <nav>
            {navItems.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) => (isActive || (path === '/' && location.pathname === '/') ? 'active' : '')}
                onClick={closeSidebar}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="content">{children}</main>
      </div>
    </div>
  )
}
