import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMySsoStatus } from '../api/usersApi'
import ChangePasswordModal from './ChangePasswordModal'
import '../styles/user-menu.css'

function getInitials(me) {
  const source = (me?.displayName || me?.username || '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export default function UserMenu({ me, onLogout }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [authSource, setAuthSource] = useState(null)
  const wrapRef = useRef(null)

  const displayName = me?.displayName || me?.username || ''
  const email = me?.email || ''
  const initials = getInitials(me)
  const canChangePassword = authSource === 'local'

  const loadSsoStatus = useCallback(async () => {
    try {
      const data = await fetchMySsoStatus()
      setAuthSource(data?.authSource || 'local')
    } catch {
      setAuthSource('local')
    }
  }, [])

  useEffect(() => {
    if (me) loadSsoStatus()
  }, [me, loadSsoStatus])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const handleChangePassword = () => {
    setOpen(false)
    setPasswordModalOpen(true)
  }

  const handleLogout = () => {
    setOpen(false)
    onLogout()
  }

  return (
    <>
      <div className="user-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`user-menu-trigger${open ? ' user-menu-trigger--open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span className="user-menu-trigger__name">{displayName}</span>
          <span className="user-menu-trigger__avatar" aria-hidden>
            {initials}
          </span>
        </button>

        {open && (
          <div className="user-menu-panel" role="menu">
            <div className="user-menu-panel__identity">
              <div className="user-menu-panel__name">{displayName}</div>
              {email ? <div className="user-menu-panel__email">{email}</div> : null}
            </div>
            <hr className="user-menu-panel__divider" />
            {canChangePassword && (
              <button
                type="button"
                className="user-menu-panel__item"
                role="menuitem"
                onClick={handleChangePassword}
              >
                {t('changePassword.menuItem')}
              </button>
            )}
            <button
              type="button"
              className="user-menu-panel__item user-menu-panel__item--logout"
              role="menuitem"
              onClick={handleLogout}
            >
              {t('logout')}
            </button>
          </div>
        )}
      </div>

      <ChangePasswordModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
    </>
  )
}
