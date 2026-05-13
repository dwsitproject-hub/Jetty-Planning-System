import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import {
  fetchNotificationsList,
  fetchNotificationsUnreadCount,
  markNotificationsRead,
  markAllNotificationsRead,
} from '../api/notifications'
import '../styles/notifications.css'

const POLL_MS = 45000

function kindModifier(kind) {
  if (kind === 'approval') return 'jps-notif-item--approval'
  if (kind === 'clearance') return 'jps-notif-item--clearance'
  if (kind === 'email_sent') return 'jps-notif-item--email'
  return 'jps-notif-item--info'
}

function BellIcon() {
  return (
    <svg className="jps-notif-bell__svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function EnvelopeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

function relativeTime(iso, locale) {
  if (!iso) return '—'
  const dt = DateTime.fromISO(iso)
  if (!dt.isValid) return '—'
  const loc = locale === 'id' ? 'id' : 'en'
  return dt.setLocale(loc).toRelative() || '—'
}

export default function NotificationBell() {
  const { t, i18n } = useTranslation('notifications')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const wrapRef = useRef(null)

  const refreshCount = useCallback(async () => {
    try {
      const data = await fetchNotificationsUnreadCount()
      setUnread(Number(data?.count) || 0)
      setErr(null)
    } catch {
      /* ignore transient */
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchNotificationsList({ limit: 25 })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setErr(null)
    } catch (e) {
      setErr(e?.message || 'Failed to load')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshCount()
    const id = window.setInterval(refreshCount, POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshCount])

  useEffect(() => {
    if (!open) return undefined
    loadList()
    refreshCount()
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, loadList, refreshCount])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = () => setOpen((o) => !o)

  const onRowNavigate = async (n) => {
    const href = n?.payload?.primaryHref
    if (n?.readAt == null && n?.id != null) {
      try {
        await markNotificationsRead([n.id])
      } catch {
        /* ignore */
      }
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)))
      refreshCount()
    }
    setOpen(false)
    if (!href || typeof href !== 'string') return
    let path = href
    if (href.startsWith('http://') || href.startsWith('https://')) {
      try {
        const u = new URL(href)
        path = `${u.pathname}${u.search || ''}`
      } catch {
        return
      }
    }
    if (path.startsWith('/')) navigate(path)
  }

  const onPrimaryAction = async (e, n) => {
    e.stopPropagation()
    await onRowNavigate(n)
  }

  const onMarkAllRead = async (e) => {
    e.stopPropagation()
    try {
      await markAllNotificationsRead()
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })))
      setUnread(0)
    } catch {
      /* ignore */
    }
  }

  const badge = unread > 99 ? '99+' : String(unread)

  return (
    <div className="jps-notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`jps-notif-bell ${open ? 'jps-notif-bell--open' : ''}`}
        data-testid="notification-bell"
        aria-label={t('bellAria')}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggle}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="jps-notif-bell__badge" aria-live="polite">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="jps-notif-panel" role="menu" data-testid="notification-panel">
          <div className="jps-notif-panel__head">
            <span className="jps-notif-panel__title">{t('bellAria')}</span>
            {unread > 0 ? (
              <button
                type="button"
                className="jps-notif-panel__mark-all btn btn--text btn--small"
                data-testid="notification-mark-all-read"
                onClick={onMarkAllRead}
              >
                {t('markAllRead')}
              </button>
            ) : null}
          </div>
          <div className="jps-notif-panel__body" data-testid="notification-panel-body">
            {loading ? <p className="jps-notif-panel__muted">{t('loading')}</p> : null}
            {err ? <p className="jps-notif-panel__err">{err}</p> : null}
            {!loading && !items.length ? (
              <p className="jps-notif-panel__muted" data-testid="notification-empty">
                {t('empty')}
              </p>
            ) : null}
            {!loading &&
              items.map((n) => {
                const unreadRow = n.readAt == null
                const labelKey = n.payload?.primaryActionLabelKey
                const actionLabel =
                  labelKey && typeof labelKey === 'string' ? t(labelKey, { defaultValue: labelKey }) : null
                return (
                  <div
                    key={n.id}
                    role="menuitem"
                    className={`jps-notif-item ${kindModifier(n.kind)} ${unreadRow ? 'jps-notif-item--unread' : ''}`}
                    onClick={() => onRowNavigate(n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowNavigate(n)
                      }
                    }}
                    tabIndex={0}
                  >
                    <div className="jps-notif-item__icon" aria-hidden>
                      {n.kind === 'email_sent' ? <EnvelopeIcon /> : <BellIcon />}
                    </div>
                    <div className="jps-notif-item__main">
                      <div className="jps-notif-item__row1">
                        <span className="jps-notif-item__title">{n.title}</span>
                        <time className="jps-notif-item__time" dateTime={n.createdAt || undefined}>
                          {relativeTime(n.createdAt, i18n.language)}
                        </time>
                      </div>
                      <p className="jps-notif-item__body">{n.body}</p>
                      {actionLabel && n.payload?.primaryHref ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--small jps-notif-item__cta"
                          onClick={(e) => onPrimaryAction(e, n)}
                        >
                          {actionLabel}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
