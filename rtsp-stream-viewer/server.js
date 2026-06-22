'use strict';
/**
 * RTSP → WebSocket MPEG1 stream service for Jetty Live CCTV.
 *
 * Architecture: one persistent WebSocket server (WS_PORT) + on-demand FFmpeg.
 * FFmpeg starts when the first viewer connects and stops after an idle grace
 * period when the last viewer disconnects. The WS server stays alive so
 * browsers never hit EADDRINUSE on rapid reconnects.
 *
 * POST /api/reconnect { rtspUrl?: string }  — optionally switch RTSP URL; restarts FFmpeg only if viewers are connected.
 * GET  /api/health                          — JSON status for the UI health card.
 */

const express = require('express');
const ws = require('ws');
const Mpeg1Muxer = require('./lib/mpeg1Muxer');

// ── configuration ────────────────────────────────────────────────────────────
const DEFAULT_RTSP_URL =
  process.env.RTSP_URL ||
  'rtsp://testing:KPN00000eup@172.16.247.222:554/Stream1';

const WS_PORT           = parseInt(process.env.WS_PORT           || '9999',  10);
const HTTP_PORT         = parseInt(process.env.HTTP_PORT         || '3080',  10);
const WATCHDOG_MS       = parseInt(process.env.WATCHDOG_RESTART_MS || '3000', 10);
const STALL_MS          = parseInt(process.env.STALL_MS          || '8000',  10);
const STALL_KILL_MS     = parseInt(process.env.STALL_KILL_MS     || '30000', 10);
const IDLE_STOP_MS      = parseInt(process.env.STREAM_IDLE_STOP_MS || '30000', 10);
const STREAM_OUTPUT_FPS = process.env.STREAM_OUTPUT_FPS || '1';
// mpeg1video only accepts standard MPEG-1 rates (e.g. 25). Throttle via -vf fps=, not -r 1.
const STREAM_MPEG1_RATE = process.env.STREAM_MPEG1_RATE || '25';
const STREAM_SCALE      = process.env.STREAM_SCALE || '640:-1';
const FFMPEG_PATH       = process.env.FFMPEG_PATH || 'ffmpeg';

// Input flags placed BEFORE -i (e.g. -rtsp_transport must come before -i).
// Default: no extra input flags so the camera works with UDP (original behaviour).
// Set RTSP_TRANSPORT=tcp in .env if you need TCP.
const INPUT_FLAGS = {};
if (process.env.RTSP_TRANSPORT) {
  INPUT_FLAGS['-rtsp_transport'] = process.env.RTSP_TRANSPORT;
}

function buildVideoFilter() {
  if (process.env.STREAM_VIDEO_FILTER) {
    return process.env.STREAM_VIDEO_FILTER;
  }
  const parts = [];
  if (STREAM_SCALE) parts.push(`scale=${STREAM_SCALE}`);
  parts.push('format=yuv420p');
  parts.push(`fps=${STREAM_OUTPUT_FPS}`);
  return parts.join(',');
}

const VIDEO_FILTER = buildVideoFilter();
const OUTPUT_FLAGS = { '-r': STREAM_MPEG1_RATE, '-stats': '' };

// ── mutable state ─────────────────────────────────────────────────────────────
let currentRtspUrl   = DEFAULT_RTSP_URL;
let muxer            = null;
let restartTimer     = null;
let idleStopTimer    = null;
let activeViewerCount = 0;
let restartCount     = 0;
let lastFrameAt      = null;
let serverStatus     = 'offline';
let bootAt           = 0;

// ── persistent WebSocket server (created once, never torn down) ──────────────
const STREAM_MAGIC = 'jsmp';
const wsServer = new ws.Server({ port: WS_PORT });

function clearIdleStopTimer() {
  if (idleStopTimer) {
    clearTimeout(idleStopTimer);
    idleStopTimer = null;
  }
}

function scheduleIdleStop() {
  clearIdleStopTimer();
  idleStopTimer = setTimeout(() => {
    idleStopTimer = null;
    if (activeViewerCount === 0) {
      console.log(`[stream] idle stop after ${IDLE_STOP_MS}ms with no viewers`);
      stopStream();
    }
  }, IDLE_STOP_MS);
}

function onViewerConnect() {
  clearIdleStopTimer();
  activeViewerCount += 1;
  console.log(`[ws] client connected (${activeViewerCount} tracked, ${wsServer.clients.size} on server)`);
  if (activeViewerCount === 1) {
    startStream({ reason: 'viewer_connect' });
  }
}

function onViewerDisconnect() {
  activeViewerCount = Math.max(0, activeViewerCount - 1);
  console.log(`[ws] client disconnected (${activeViewerCount} tracked, ${wsServer.clients.size} on server)`);
  if (activeViewerCount === 0) {
    scheduleIdleStop();
  }
}

wsServer.on('connection', (socket) => {
  const header = Buffer.alloc(8);
  header.write(STREAM_MAGIC);
  socket.send(header, { binary: true });
  onViewerConnect();
  socket.on('close', () => onViewerDisconnect());
});

function broadcast(data) {
  for (const client of wsServer.clients) {
    if (client.readyState === ws.OPEN) {
      client.send(data, { binary: true });
    }
  }
}

// ── FFmpeg lifecycle ──────────────────────────────────────────────────────────
function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart(reason) {
  if (activeViewerCount === 0) return;
  clearRestartTimer();
  console.warn(`[watchdog] restart in ${WATCHDOG_MS}ms (${reason})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (activeViewerCount === 0) return;
    restartCount += 1;
    startStream({ reason: `watchdog:${reason}` });
  }, WATCHDOG_MS);
}

function stopStream() {
  clearRestartTimer();
  const prev = muxer;
  muxer = null;
  if (!prev) return;
  try { prev.stream.kill(); } catch { /* ignore */ }
  if (serverStatus !== 'starting') serverStatus = 'offline';
}

function startStream(opts = {}) {
  const { reason } = opts;
  if (activeViewerCount === 0) return;
  if (reason) console.log(`[stream] start: ${reason}`);

  stopStream();

  bootAt       = Date.now();
  serverStatus = 'starting';
  lastFrameAt  = null;

  try {
    const m = new Mpeg1Muxer({
      url:                currentRtspUrl,
      ffmpegPath:         FFMPEG_PATH,
      inputFfmpegOptions: INPUT_FLAGS,
      ffmpegOptions:      OUTPUT_FLAGS,
      videoFilter:        VIDEO_FILTER,
      noAudio:            true,
    });
    muxer = m;

    m.on('mpeg1data', (data) => {
      lastFrameAt  = Date.now();
      serverStatus = 'online';
      broadcast(data);
    });

    if (process.env.STREAM_LOG_FFMPEG === '1') {
      m.on('ffmpegStderr', (d) => process.stderr.write(d));
    }

    m.stream.on('error', (err) => {
      if (muxer !== m) return;
      console.error('[stream] process error', err.message || err);
      serverStatus = 'offline';
      scheduleRestart('ffmpeg_error');
    });

    m.stream.on('exit', (code, signal) => {
      if (muxer !== m) return;
      console.warn('[stream] ffmpeg exit', { code, signal });
      serverStatus = 'offline';
      scheduleRestart(`ffmpeg_exit_${code}`);
    });

    m.on('exitWithError', () => {
      if (muxer !== m) return;
      serverStatus = 'offline';
      scheduleRestart('mpeg1_exit_error');
    });

  } catch (e) {
    console.error('[stream] failed to start', e);
    serverStatus = 'offline';
    scheduleRestart('create_failed');
  }
}

// Stall watchdog — recycle FFmpeg if frames stop arriving (only while streaming).
setInterval(() => {
  if (!muxer || activeViewerCount === 0) return;
  const now = Date.now();
  if (lastFrameAt == null) {
    if (serverStatus === 'starting' && now - bootAt > STALL_KILL_MS) {
      console.warn('[watchdog] no frames since boot, recycling');
      stopStream();
      scheduleRestart('stall_no_frames_boot');
    }
    return;
  }
  if (now - lastFrameAt > STALL_KILL_MS) {
    console.warn('[watchdog] stalled, recycling');
    stopStream();
    scheduleRestart('stall_no_frames');
  }
}, 5000).unref?.();

// ── HTTP API ──────────────────────────────────────────────────────────────────
function isValidRtsp(url) {
  return typeof url === 'string' && /^rtsp:\/\//i.test(url.trim());
}

function maskRtsp(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(invalid)';
  }
}

function parseAllowedOrigins() {
  const raw = process.env.STREAM_CORS_ORIGINS || '';
  if (!raw.trim()) {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const app = express();

app.use((req, res, next) => {
  const allowed = parseAllowedOrigins();
  const origin  = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.json());
app.use(express.static(require('path').join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  const now     = Date.now();
  const stale   = lastFrameAt != null && now - lastFrameAt > STALL_MS;
  const effective =
    serverStatus === 'online' && !stale ? 'online' : serverStatus;
  res.json({
    status:        effective,
    serverStatus,
    lastFrameAt,
    ffmpegRunning: Boolean(muxer?.stream && !muxer.stream.killed),
    viewerCount:   activeViewerCount,
    outputFps:     Number(STREAM_OUTPUT_FPS),
    idleStopMs:    IDLE_STOP_MS,
    wsPort:        WS_PORT,
    restartCount,
    stallMs:       STALL_MS,
    rtspSource:    maskRtsp(currentRtspUrl),
  });
});

app.post('/api/reconnect', (req, res) => {
  const raw    = (req.body || {}).rtspUrl ?? (req.body || {}).rtsp_url;
  let switched = false;
  if (raw != null && String(raw).trim() !== '') {
    const next = String(raw).trim();
    if (isValidRtsp(next)) {
      currentRtspUrl = next;
      switched = true;
    }
  }

  if (activeViewerCount > 0) {
    restartCount += 1;
    stopStream();
    setTimeout(() => {
      if (activeViewerCount > 0) {
        startStream({ reason: switched ? 'manual_reconnect_new_url' : 'manual_reconnect' });
      }
    }, 800);
  }

  res.json({
    ok:         true,
    message:    activeViewerCount > 0 ? 'Reconnect scheduled' : 'URL updated; stream starts when a viewer connects',
    rtspSource: maskRtsp(currentRtspUrl),
    urlUpdated: switched,
  });
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP  : http://localhost:${HTTP_PORT}`);
  console.log(`WS    : ws://localhost:${WS_PORT}`);
  console.log(`RTSP  : ${maskRtsp(currentRtspUrl)}`);
  console.log(`FPS   : ${STREAM_OUTPUT_FPS} (vf fps=; mpeg1 -r ${STREAM_MPEG1_RATE}; idle stop ${IDLE_STOP_MS}ms)`);
});
