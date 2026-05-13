'use strict';

const path = require('path');
const express = require('express');
const RtspStream = require('node-rtsp-stream');

const RTSP_URL =
  process.env.RTSP_URL ||
  'rtsp://testing:KPN00000eup@172.16.247.222:554/Stream1';
const WS_PORT = parseInt(process.env.WS_PORT || '9999', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3080', 10);
const WATCHDOG_RESTART_MS = parseInt(
  process.env.WATCHDOG_RESTART_MS || '3000',
  10
);
const STALL_MS = parseInt(process.env.STALL_MS || '8000', 10);
const STALL_KILL_MS = parseInt(process.env.STALL_KILL_MS || '30000', 10);

let videoStream = null;
let restartTimer = null;
let restartCount = 0;
let lastFrameAt = null;
let serverStatus = 'offline';

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart(reason) {
  clearRestartTimer();
  console.warn(`[watchdog] scheduling restart in ${WATCHDOG_RESTART_MS}ms (${reason})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartCount += 1;
    startRtspStream({ reason: `watchdog:${reason}` });
  }, WATCHDOG_RESTART_MS);
}

function stopRtspStream() {
  clearRestartTimer();
  const prev = videoStream;
  videoStream = null;
  if (!prev) return;
  try {
    prev.stop();
  } catch (e) {
    console.error('[stream] stop error', e);
  }
  if (serverStatus !== 'starting') serverStatus = 'offline';
}

function attachStreamHandlers(streamInstance) {
  streamInstance.on('camdata', () => {
    lastFrameAt = Date.now();
    serverStatus = 'online';
  });

  const proc = streamInstance.stream;
  if (proc && typeof proc.on === 'function') {
    proc.on('error', (err) => {
      if (videoStream !== streamInstance) {
        return;
      }
      console.error('[stream] ffmpeg process error', err.message || err);
      serverStatus = 'offline';
      scheduleRestart('ffmpeg_process_error');
    });
    proc.on('exit', (code, signal) => {
      if (videoStream !== streamInstance) {
        return;
      }
      console.warn('[stream] ffmpeg exit', { code, signal });
      serverStatus = 'offline';
      scheduleRestart(`ffmpeg_exit_${code}`);
    });
  }
}

function startRtspStream(opts = {}) {
  const { reason } = opts;
  if (reason) console.log('[stream] start:', reason);

  stopRtspStream();

  global.__streamBootAt = Date.now();
  serverStatus = 'starting';
  lastFrameAt = null;

  try {
    const instance = new RtspStream({
      name: 'Stream1',
      streamUrl: RTSP_URL,
      wsPort: WS_PORT,
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      ffmpegOptions: {
        '-r': 25,
        '-stats': '',
      },
    });
    videoStream = instance;
    attachStreamHandlers(instance);
  } catch (e) {
    console.error('[stream] failed to create', e);
    serverStatus = 'offline';
    scheduleRestart('create_failed');
  }
}

const app = express();

/** Comma-separated browser origins allowed to call /api/* (Jetty Vite dev, etc.). */
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
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsMiddleware(req, res, next) {
  const allowed = parseAllowedOrigins();
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
}

app.use(corsMiddleware);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  const now = Date.now();
  const ffmpegRunning = Boolean(
    videoStream && videoStream.stream && !videoStream.stream.killed
  );
  let effective = serverStatus;
  if (
    serverStatus === 'online' &&
    lastFrameAt != null &&
    now - lastFrameAt > STALL_MS
  ) {
    effective = 'offline';
  }
  res.json({
    status: effective,
    serverStatus,
    lastFrameAt,
    ffmpegRunning,
    wsPort: WS_PORT,
    restartCount,
    stallMs: STALL_MS,
  });
});

app.post('/api/reconnect', (req, res) => {
  clearRestartTimer();
  restartCount += 1;
  stopRtspStream();
  setTimeout(() => {
    startRtspStream({ reason: 'manual_reconnect' });
  }, 500);
  res.json({ ok: true, message: 'Reconnect scheduled' });
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`WebSocket MPEG1 (video): ws://localhost:${WS_PORT}`);
  console.log(`RTSP source: ${maskRtsp(RTSP_URL)}`);
  startRtspStream({ reason: 'boot' });
});

setInterval(() => {
  const now = Date.now();
  if (!videoStream || !videoStream.stream || videoStream.stream.killed) return;
  if (lastFrameAt == null) {
    if (serverStatus === 'starting' && now - (global.__streamBootAt || 0) > STALL_KILL_MS) {
      console.warn('[watchdog] no frames since boot, recycling stream');
      stopRtspStream();
      scheduleRestart('stall_no_frames_boot');
    }
    return;
  }
  if (now - lastFrameAt > STALL_KILL_MS) {
    console.warn('[watchdog] no frames for', STALL_KILL_MS, 'ms, recycling stream');
    stopRtspStream();
    scheduleRestart('stall_no_frames');
  }
}, 5000).unref?.();

function maskRtsp(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(invalid RTSP URL)';
  }
}
