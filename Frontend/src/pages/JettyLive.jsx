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
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/dashboard.css'
import '../styles/jetty-live.css'

const AT_BERTH_PAGE_KEY = 'at-berth'
// Served same-origin from Frontend/public/jsmpeg.min.js so the app CSP (script-src 'self')
// allows it and the player works on air-gapped/offline deployments. Previously loaded from
// cdn.jsdelivr.net, which the CSP blocked (player never initialised).
const JSMPEG_SCRIPT = '/jsmpeg.min.js'

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

export default function JettyLive() {
  const { t } = useTranslation('pages')
  const { canApprove } = useRbac()
  const canViewStream = canApprove(AT_BERTH_PAGE_KEY)
  const [searchParams] = useSearchParams()
  const rtspFromQuery = useMemo(() => parseRtspFromSearch(searchParams), [searchParams])
  const jettyLabel = (searchParams.get('label') || '').trim() || null
  const rtspParamPresent = searchParams.has('rtsp')
  const showNoCameraHint = rtspParamPresent && !rtspFromQuery

  const canvasRef = useRef(null)
  const playerRef = useRef(null)
  const wsPortRef = useRef(null)

  const isPlayerConnected = useCallback(() => {
    const p = playerRef.current
    const ws = p?.source?.socket ?? p?.source?.ws
    return ws?.readyState === 1 // WebSocket.OPEN
  }, [])

  const [health, setHealth] = useState(null)
  const [healthErr, setHealthErr] = useState(null)
  const [reconnectBusy, setReconnectBusy] = useState(false)
  /** Stream health card: collapsed by default */
  const [healthExpanded, setHealthExpanded] = useState(false)
  /** 'boot' | 'reconnect' | null */
  const [overlayKind, setOverlayKind] = useState('boot')

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

  const startPlayer = useCallback(async ({ force = false } = {}) => {
    if (!force && isPlayerConnected()) return

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
  }, [destroyPlayer, isPlayerConnected])

  useEffect(() => {
    if (!canViewStream) return undefined
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
  }, [canViewStream, rtspFromQuery, destroyPlayer, startPlayer])

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
    const outputFps = Number(health.outputFps) || 1
    // Allow several frame intervals before calling stale (1 fps → ~10 s).
    const stallMs = Math.max(health.stallMs ?? 8000, Math.ceil(10000 / outputFps))
    const stale =
      health.lastFrameAt != null && now - health.lastFrameAt > stallMs
    if (health.status === 'online' && !stale) {
      return { key: 'online', label: t('jettyLiveOnline') }
    }
    if (health.status === 'starting' || (health.status === 'online' && stale)) {
      return { key: 'starting', label: t('jettyLiveStarting') }
    }
    return { key: 'offline', label: t('jettyLiveOffline') }
  }, [health, t])

  const onReconnect = useCallback(async () => {
    setReconnectBusy(true)
    try {
      await postStreamReconnect(rtspFromQuery)
      setOverlayKind('reconnect')
      await new Promise((r) => setTimeout(r, 2000))
      destroyPlayer()
      await startPlayer({ force: true })
    } catch (e) {
      console.warn('[JettyLive] reconnect', e)
      setOverlayKind(null)
    } finally {
      setReconnectBusy(false)
    }
  }, [rtspFromQuery, destroyPlayer, startPlayer])

  if (!canViewStream) {
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

      {healthErr && (
        <section className="card jetty-live-helper-banner" role="alert">
          <p className="jetty-live-helper-banner__title">{t('jettyLiveHealthUnreachableBanner')}</p>
          {usingProxy && (
            <p className="jetty-live-meta jetty-live-helper-banner__hint">
              {t('jettyLiveHealthUnreachableDevHint')}
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
                  {formatDateTimeDisplay(health?.lastFrameAt)}
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
            {streamStruggling && (
              <p className="text-steel jetty-live-health-card__alert" role="status">
                {t('jettyLiveStreamStruggling')}
              </p>
            )}
            {health?.rtspSource && (
              <p className="jetty-live-meta jetty-live-health-card__source">
                {t('jettyLiveStreamSource', { source: health.rtspSource })}
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
