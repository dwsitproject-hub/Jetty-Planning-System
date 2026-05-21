/**
 * Jetty Live RTSP viewer (browser): JSMpeg over WebSocket + health from rtsp-stream-viewer.
 *
 * Env:
 * - VITE_JETTY_LIVE_HTTP_ORIGIN — e.g. http://127.0.0.1:3080 (direct to stream service). If unset, uses
 *   same-origin paths /jetty-live-stream/* (Vite dev proxy in vite.config.js → port 3080).
 * - HTTPS UI + plain ws/http stream may be blocked by the browser; use TLS or reverse-proxy both apps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRbac } from '../context/RbacContext'
import '../styles/dashboard.css'
import '../styles/jetty-live.css'

const PAGE_KEY = 'jetty-live'
const JSMPEG_SCRIPT =
  'https://cdn.jsdelivr.net/gh/phoboslab/jsmpeg@master/jsmpeg.min.js'

function getStreamHttpBase() {
  const raw = import.meta.env.VITE_JETTY_LIVE_HTTP_ORIGIN
  if (raw === undefined || raw === '') return ''
  return String(raw).replace(/\/$/, '')
}

/** API paths on stream service */
function streamApiUrl(apiPath) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  const base = getStreamHttpBase()
  if (!base) return `/jetty-live-stream${path}`
  return `${base}${path}`
}

function buildWsUrl(wsPortHint) {
  const base = getStreamHttpBase()
  const port =
    wsPortHint != null && Number.isFinite(Number(wsPortHint))
      ? Number(wsPortHint)
      : Number(import.meta.env.VITE_JETTY_LIVE_WS_PORT || 9999)

  if (!base) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/jetty-live-ws`
  }

  try {
    const u = new URL(base.includes('://') ? base : `http://${base}`)
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.hostname}:${port}`
  } catch {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${window.location.hostname}:${port}`
  }
}

function loadJsmpegScript() {
  if (typeof window !== 'undefined' && window.JSMpeg) {
    return Promise.resolve()
  }
  if (typeof window !== 'undefined' && window.__jettyLiveJsmpegLoading) {
    return window.__jettyLiveJsmpegLoading
  }
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = JSMPEG_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('JSMpeg script failed to load'))
    document.head.appendChild(s)
  })
  if (typeof window !== 'undefined') window.__jettyLiveJsmpegLoading = p
  return p
}

function parseRtspFromSearch(params) {
  const raw = params.get('rtsp')
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw).trim()
    if (/^rtsp:\/\//i.test(decoded)) return decoded
  } catch {
    return null
  }
  return null
}

async function postStreamReconnect(rtspUrl) {
  const body = rtspUrl ? { rtspUrl } : {}
  const r = await fetch(streamApiUrl('/api/reconnect'), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

function fmtTime(ts, locale) {
  if (ts == null) return '—'
  try {
    return new Date(ts).toLocaleString(locale)
  } catch {
    return String(ts)
  }
}

export default function JettyLive() {
  const { t } = useTranslation('pages')
  const { canView } = useRbac()
  const canDoView = canView(PAGE_KEY)
  const [searchParams] = useSearchParams()
  const rtspFromQuery = useMemo(() => parseRtspFromSearch(searchParams), [searchParams])
  const jettyLabel = (searchParams.get('label') || '').trim() || null
  const rtspParamPresent = searchParams.has('rtsp')
  const showNoCameraHint = rtspParamPresent && !rtspFromQuery

  const canvasRef = useRef(null)
  const playerRef = useRef(null)
  const wsPortRef = useRef(null)
  const lastHealthKeyRef = useRef(null)

  const [health, setHealth] = useState(null)
  const [healthErr, setHealthErr] = useState(null)
  const [reconnectBusy, setReconnectBusy] = useState(false)
  /** Stream health card: collapsed by default */
  const [healthExpanded, setHealthExpanded] = useState(false)
  /** 'boot' | 'reconnect' | null */
  const [overlayKind, setOverlayKind] = useState('boot')

  const locale = useMemo(() => {
    try {
      return navigator.language || 'en-US'
    } catch {
      return 'en-US'
    }
  }, [])

  const destroyPlayer = useCallback(() => {
    const p = playerRef.current
    playerRef.current = null
    if (!p) return
    try {
      if (typeof p.destroy === 'function') p.destroy()
    } catch {
      /* ignore */
    }
    try {
      if (p.source?.socket && typeof p.source.socket.close === 'function') {
        p.source.socket.close()
      }
    } catch {
      /* ignore */
    }
  }, [])

  const startPlayer = useCallback(async () => {
    await loadJsmpegScript()
    const JSMpeg = window.JSMpeg
    if (!JSMpeg?.Player) return

    destroyPlayer()
    const canvas = canvasRef.current
    if (!canvas) return

    const wsUrl = buildWsUrl(wsPortRef.current)

    playerRef.current = new JSMpeg.Player(wsUrl, {
      canvas,
      autoplay: true,
      audio: false,
      videoBufferSize: 512 * 1024,
    })

    setTimeout(() => setOverlayKind(null), 1200)
  }, [destroyPlayer])

  useEffect(() => {
    if (!canDoView) return undefined
    let cancelled = false

    ;(async () => {
      try {
        setOverlayKind('boot')
        if (rtspFromQuery) {
          await postStreamReconnect(rtspFromQuery)
          if (cancelled) return
          await new Promise((r) => setTimeout(r, 2000))
        }
        if (cancelled) return
        await startPlayer()
      } catch (e) {
        if (!cancelled) console.warn('[JettyLive] player start', e)
        setOverlayKind(null)
      }
    })()

    return () => {
      cancelled = true
      destroyPlayer()
    }
  }, [canDoView, rtspFromQuery, destroyPlayer, startPlayer])

  useEffect(() => {
    let alive = true

    async function poll() {
      try {
        const r = await fetch(streamApiUrl('/api/health'), {
          cache: 'no-store',
          credentials: 'omit',
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const h = await r.json()
        if (!alive) return
        wsPortRef.current = h.wsPort ?? wsPortRef.current
        setHealth(h)
        setHealthErr(null)
      } catch (e) {
        if (!alive) return
        setHealth(null)
        setHealthErr(e?.message || 'health')
      }
    }

    poll()
    const id = setInterval(poll, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const displayStatus = useMemo(() => {
    if (!health) return { key: 'offline', label: t('jettyLiveOffline') }
    const now = Date.now()
    const stallMs = health.stallMs ?? 8000
    const stale =
      health.lastFrameAt != null && now - health.lastFrameAt > stallMs
    if (health.status === 'online' && !stale) {
      return { key: 'online', label: t('jettyLiveOnline') }
    }
    if (health.status === 'starting') {
      return { key: 'starting', label: t('jettyLiveStarting') }
    }
    return { key: 'offline', label: t('jettyLiveOffline') }
  }, [health, t])

  /** Re-attach JSMpeg when the stream service starts delivering frames. */
  useEffect(() => {
    if (!canDoView) return undefined
    const key = displayStatus.key
    const prev = lastHealthKeyRef.current
    lastHealthKeyRef.current = key
    if (key === 'online' && prev !== 'online') {
      let cancelled = false
      ;(async () => {
        try {
          destroyPlayer()
          if (!cancelled) await startPlayer()
        } catch (e) {
          console.warn('[JettyLive] player refresh on online', e)
        }
      })()
      return () => {
        cancelled = true
      }
    }
    return undefined
  }, [canDoView, displayStatus.key, destroyPlayer, startPlayer])

  const onReconnect = useCallback(async () => {
    setReconnectBusy(true)
    try {
      await postStreamReconnect(rtspFromQuery)
      setOverlayKind('reconnect')
      await new Promise((r) => setTimeout(r, 2000))
      destroyPlayer()
      await startPlayer()
    } catch (e) {
      console.warn('[JettyLive] reconnect', e)
      setOverlayKind(null)
    } finally {
      setReconnectBusy(false)
    }
  }, [rtspFromQuery, destroyPlayer, startPlayer])

  if (!canDoView) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="page-title">{t('jettyLiveTitle')}</h1>
        </header>
        <section className="card">
          <p style={{ color: 'var(--color-danger, #c00)' }}>{t('jettyLiveNoPermission')}</p>
          <p className="text-steel">
            <Link to="/allocation-plans" className="link">
              ← {t('jettyLiveBackDashboard')}
            </Link>
          </p>
        </section>
      </div>
    )
  }

  const usingProxy = !getStreamHttpBase()
  const streamStruggling =
    !healthErr &&
    health &&
    (health.restartCount ?? 0) >= 3 &&
    displayStatus.key !== 'online'

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="page-title">
          {jettyLabel ? t('jettyLiveForJetty', { label: jettyLabel }) : t('jettyLiveTitle')}
        </h1>
        <span className="dashboard-header__meta text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
          <Link to="/allocation-plans" className="link">
            ← {t('jettyLiveBackDashboard')}
          </Link>
        </span>
      </header>

      {showNoCameraHint && (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <p className="text-steel" role="status">
            {t('jettyLiveNoCameraUrl')}
          </p>
        </section>
      )}

      {streamStruggling && (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <p className="text-steel" role="status">
            {t('jettyLiveStreamStruggling')}
          </p>
          {health?.rtspSource && (
            <p className="jetty-live-meta" style={{ marginTop: '0.5rem' }}>
              {t('jettyLiveStreamSource', { source: health.rtspSource })}
            </p>
          )}
        </section>
      )}

      <section
        className={`card jetty-live-health-card ${healthExpanded ? 'jetty-live-health-card--open' : 'jetty-live-health-card--collapsible'}`}
      >
        <button
          type="button"
          className="jetty-live-health-card__header"
          onClick={() => setHealthExpanded((v) => !v)}
          aria-expanded={healthExpanded}
          aria-controls="jetty-live-health-panel"
          id="jetty-live-health-toggle"
          aria-label={healthExpanded ? t('jettyLiveCollapseHealth') : t('jettyLiveExpandHealth')}
        >
          <span className="jetty-live-health-card__header-main">
            <h2 className="card__title jetty-live-health-card__title">{t('jettyLiveHealthTitle')}</h2>
            {!healthExpanded && (
              <span
                className={`jetty-live-health-card__summary jetty-live-health-card__summary--${healthErr ? 'offline' : displayStatus.key}`}
              >
                {healthErr ? t('jettyLiveHealthUnreachableShort') : displayStatus.label}
              </span>
            )}
          </span>
          <span className="jetty-live-health-card__chevron" aria-hidden>
            {healthExpanded ? '▼' : '▶'}
          </span>
        </button>
        {healthExpanded && (
          <div className="jetty-live-health-card__body" id="jetty-live-health-panel" role="region" aria-labelledby="jetty-live-health-toggle">
            <div className="jetty-live-health-card__grid">
              <div>
                <div className="jetty-live-meta">{t('jettyLiveStatusLabel')}</div>
                <div
                  className={
                    displayStatus.key === 'online'
                      ? 'jetty-live-status--online'
                      : displayStatus.key === 'starting'
                        ? 'jetty-live-status--starting'
                        : 'jetty-live-status--offline'
                  }
                >
                  {displayStatus.label}
                </div>
              </div>
              <div>
                <div className="jetty-live-meta">{t('jettyLiveLastFrameLabel')}</div>
                <div className="font-mono" style={{ fontSize: '0.9rem' }}>
                  {fmtTime(health?.lastFrameAt, locale)}
                </div>
              </div>
              <div>
                <div className="jetty-live-meta">{t('jettyLiveRestartsLabel')}</div>
                <div>{health?.restartCount ?? '—'}</div>
              </div>
            </div>
            {healthErr && (
              <p className="text-steel jetty-live-health-card__alert" role="alert">
                {t('jettyLiveHealthUnreachable')}
              </p>
            )}
            <div className="jetty-live-health-card__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={reconnectBusy}
                onClick={onReconnect}
              >
                {t('jettyLiveReconnect')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: '1rem' }}>
        <div className="jetty-live-canvas-wrap">
          {overlayKind && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)',
                color: '#f1f5f9',
                fontSize: '0.9rem',
                zIndex: 1,
                pointerEvents: 'none',
              }}
            >
              {overlayKind === 'reconnect'
                ? t('jettyLiveReconnecting')
                : t('jettyLiveConnecting')}
            </div>
          )}
          <canvas ref={canvasRef} width={960} height={540} />
        </div>
        <p className="text-steel jetty-live-meta" style={{ marginTop: '0.75rem' }}>
          {usingProxy
            ? t('jettyLiveProxyHint')
            : t('jettyLiveDirectHint', { origin: getStreamHttpBase() })}
        </p>
      </section>
    </div>
  )
}
