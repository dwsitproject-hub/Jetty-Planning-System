# Jetty Live Stream — deployment guide

This guide explains how to run the **RTSP → WebSocket** helper (`rtsp-stream-viewer`) alongside the Jetty Planning System (JPS), on a **developer PC** and on a **Linux server** (including the Alicloud app host from [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md)).

The JPS page **Jetty Live** (`/jetty-live`) does **not** embed video inside the Node API container. It is a separate small Node process that:

1. Pulls RTSP from the camera with **FFmpeg**
2. Serves **MPEG1 over WebSocket** (default port **9999**)
3. Exposes **health / reconnect** HTTP APIs (default port **3080** locally)

Browsers load the built React app from JPS and talk to that helper for video and status.

**Deploy on the frontend (app) server only?** Use the runbook below: [Frontend (app) server — exact steps](#frontend-app-server--exact-steps).

---

## Frontend (app) server — exact steps

Run everything in this section on the **JPS frontend / app ECS** (the host where `docker compose -f docker-compose.app.yml` runs and users open port **3080**). Do **not** install the stream helper on the backend/API server unless that host alone can reach the camera.

**You need (one time, on the backend server):** migration `072` applied and **Jetty Live stream** view enabled for your role in Admin. See [§4 RBAC](#4-rbac-and-database).

### Step 0 — Confirm the app server can reach the camera

From an SSH session on the **app** server:

```bash
# Replace with your real RTSP URL
ffmpeg -rtsp_transport tcp -i "rtsp://USER:PASS@172.16.247.222:554/Stream1" -t 5 -f null -
```

If this fails (timeout / connection refused), fix VPN/peering first — Jetty Live will stay **Offline** even when the stream service is running.

### Step 1 — SSH to the frontend server

```bash
ssh ubuntu@<APP_PUBLIC_IP>
cd /opt/jetty-planning-system
git pull
```

Use your real repo path if different (see [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md)).

### Step 2 — Install Node.js and FFmpeg on the host (not inside Docker)

Docker runs **only** the JPS SPA/nginx container. The stream service runs **on the Ubuntu host** via systemd.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg jq

node -v
ffmpeg -version
```

### Step 3 — Configure `rtsp-stream-viewer`

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer
npm ci
nano .env
```

Paste and edit ( **required** ):

```bash
RTSP_URL=rtsp://<user>:<password>@<camera-ip>:554/Stream1
HTTP_PORT=3081
WS_PORT=9999
STREAM_CORS_ORIGINS=http://<APP_PUBLIC_IP>:3080,http://172.28.92.56:3080
```

| Variable | Why |
|----------|-----|
| `HTTP_PORT=3081` | Host port **3080** is already used by `jps-fe` (`JPS_FE_PORT=3080`). |
| `WS_PORT=9999` | WebSocket for video; nginx proxies `/jetty-live-ws` to this port on the host. |
| `STREAM_CORS_ORIGINS` | Only needed if you bypass nginx; safe to set to your real UI URL(s). |

Save the file. Restrict permissions:

```bash
chmod 600 .env
```

### Step 4 — Smoke-test the stream service (manual)

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer
set -a && source .env && set +a
npm start
```

Second SSH session:

```bash
curl -s http://127.0.0.1:3081/api/health | jq .
```

Expect `"status":"online"` when the camera is reachable. Stop the manual run with `Ctrl+C` in the first session.

### Step 5 — Install systemd (auto-start on boot)

```bash
sudo nano /etc/systemd/system/jps-jetty-live.service
```

```ini
[Unit]
Description=JPS Jetty Live RTSP stream (rtsp-stream-viewer)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/jetty-planning-system/rtsp-stream-viewer
EnvironmentFile=/opt/jetty-planning-system/rtsp-stream-viewer/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `User=ubuntu` if you deploy as another user.

```bash
sudo systemctl daemon-reload
sudo systemctl enable jps-jetty-live
sudo systemctl start jps-jetty-live
sudo systemctl status jps-jetty-live
```

Logs:

```bash
journalctl -u jps-jetty-live -f
```

### Step 6 — Nginx in `jps-fe` (already in repo)

The repo ships proxy rules in `Frontend/nginx.alicloud-app.conf`:

- `/jetty-live-stream/` → `http://host.docker.internal:3081/` (health + reconnect on the **host**)
- `/jetty-live-ws` → WebSocket on host port **9999**

`docker-compose.app.yml` adds `extra_hosts: host.docker.internal:host-gateway` so nginx **inside** the container can reach the host process. **Do not** use `127.0.0.1` in nginx for this — that would point at the container itself, not the host.

After `git pull`, confirm those blocks exist, then rebuild the frontend container:

```bash
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml up --build -d
docker compose -f docker-compose.app.yml ps
```

### Step 7 — Verify end-to-end on the app server

```bash
# Stream on host
curl -s http://127.0.0.1:3081/api/health | jq .

# Same path users hit via nginx (host port 3080 → container :80)
curl -s http://127.0.0.1:3080/jetty-live-stream/api/health | jq .
```

Both should return JSON with `"status":"online"` when healthy.

### Step 8 — Browser

1. Open `http://<APP_PUBLIC_IP>:3080/jetty-live`
2. Sidebar: **Jetty Live** (only if your role has **Jetty Live stream** view)
3. Expand **Stream health** if collapsed; use **Reconnect** if needed

**Do not** set `VITE_JETTY_LIVE_HTTP_ORIGIN` in the app `.env` for this layout — the SPA uses same-origin `/jetty-live-stream` and `/jetty-live-ws`.

### Step 9 — Security group (Alibaba Cloud)

| Port | Open to internet? | Notes |
|------|-------------------|--------|
| **3080** | Yes (users) | JPS UI + proxied API + Jetty Live paths |
| **3081**, **9999** | **No** | Stream service on host; only nginx on 3080 should be public |

### Updating later (frontend server only)

```bash
cd /opt/jetty-planning-system
git pull
cd rtsp-stream-viewer && npm ci
sudo systemctl restart jps-jetty-live
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml up --build -d
```

---

## Architecture

```text
Browser  →  JPS frontend (nginx / Vite)     /jetty-live  (React + JSMpeg)
              │
              ├─ /api/*              →  JPS API (port 3000)
              ├─ /jetty-live-stream/* →  rtsp-stream-viewer HTTP (health)
              └─ /jetty-live-ws      →  rtsp-stream-viewer WebSocket (video)

rtsp-stream-viewer  →  FFmpeg  →  rtsp://<camera>:554/...
```

| Component | Repo path | Typical ports |
|-----------|-----------|----------------|
| JPS frontend | `Frontend/` | **3080** (app server nginx) or **5173** (local Vite) |
| JPS API | `Backend/` | **3000** |
| Stream helper | `rtsp-stream-viewer/` | **3081** HTTP + **9999** WS on server (see below) |

**Important:** On the Alicloud **app** server, JPS nginx already uses host port **3080** (`JPS_FE_PORT=3080`). The stream helper’s default **HTTP_PORT=3080** would **conflict**. On a shared app host, run the stream service on **3081** (or another free port) and proxy it through nginx (recommended).

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | LTS recommended on the server (`node -v`). |
| **FFmpeg** | Must be on `PATH` (`ffmpeg -version`). Ubuntu: `sudo apt-get install -y ffmpeg`. |
| **Network to camera** | The host running `rtsp-stream-viewer` must reach the camera RTSP URL (e.g. `172.16.247.222` on VPN or site LAN). JPS API/DB hosts do **not** need camera access unless you run the stream there too. |
| **JPS migration 072** | Seeds RBAC catalog key `jetty-live`. Run `npm run migrate` on the backend (see [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) §5.3). |
| **Role permission** | In **Admin → Roles**, grant **view** on **Jetty Live stream** for roles that should see the nav item. |

---

## 1. Local development (Windows / Mac / Linux)

You need **two** processes:

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `cd rtsp-stream-viewer` → `.\start.bat` (Windows) or `./start.sh` | Stream + health on **3080** / **9999** |
| 2 | `cd Frontend` → `npm run dev` | JPS UI on **5173** |

Open: `http://127.0.0.1:5173/jetty-live`

Vite proxies `/jetty-live-stream` → `127.0.0.1:3080` and `/jetty-live-ws` → `127.0.0.1:9999` (see `Frontend/vite.config.js`). No extra env vars required locally.

**Symptom: Offline / “Health API unreachable”** — the stream helper is not running. See [LOCAL-FRONTEND-BACKEND-STARTUP.md](../Troubleshoot/LOCAL-FRONTEND-BACKEND-STARTUP.md) and verify:

```powershell
Invoke-RestMethod http://127.0.0.1:3080/api/health
netstat -ano | findstr ":3080 :9999"
```

---

## 2. Server deployment (Ubuntu / Alicloud ECS)

These steps assume the repo is at **`/opt/jetty-planning-system`** (same as the main deployment guide).

### 2.1 Choose where to run the stream service

| Option | When to use |
|--------|-------------|
| **A. Same host as JPS app (nginx)** | Simplest for users: one URL, nginx proxies stream paths. Camera must be reachable **from that ECS** (VPN/peering). |
| **B. Separate VM on site network** | Camera is only on plant LAN; run stream near the camera, set `VITE_JETTY_LIVE_HTTP_ORIGIN` at frontend build to that host’s URL. |
| **C. Backend server only** | Not recommended unless that host has camera network access and you expose stream ports or proxy from the app server. |

Most teams use **option A** on the **app** server (`172.28.92.56` in the standard two-server layout).

### 2.2 Install Node and FFmpeg (stream host)

SSH to the stream host (PuTTY / `ssh`):

```bash
# Node 20 LTS (Ubuntu) — if not already installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg

node -v
ffmpeg -version
```

### 2.3 Install dependencies and configure environment

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer
npm ci
```

Create **`/opt/jetty-planning-system/rtsp-stream-viewer/.env`** (do not commit; contains camera credentials):

```bash
# Camera RTSP URL (required in production — do not rely on defaults)
RTSP_URL=rtsp://<user>:<password>@<camera-ip>:554/Stream1

# On app server: avoid conflict with JPS nginx on host :3080
HTTP_PORT=3081
WS_PORT=9999

# Browser origins allowed to call /api/health and /api/reconnect (comma-separated)
# Use your real JPS UI origins:
STREAM_CORS_ORIGINS=http://<APP_PUBLIC_IP>:3080,http://172.28.92.56:3080

# Optional tuning
# WATCHDOG_RESTART_MS=3000
# STALL_MS=8000
# STALL_KILL_MS=30000
# FFMPEG_PATH=/usr/bin/ffmpeg
```

Load env when starting (systemd below uses `EnvironmentFile=`).

**Firewall / security group:** Do **not** expose **3081** or **9999** to the public internet if you use nginx on the app host. Bind access to **localhost** and only publish **`/jetty-live-stream`** and **`/jetty-live-ws`** through nginx on port **3080**. If you must open ports, restrict source IPs to your office/VPN.

### 2.4 Run manually (smoke test)

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer
set -a && source .env && set +a
npm start
```

In another SSH session:

```bash
curl -s http://127.0.0.1:3081/api/health | jq .
# Expect: "status":"online" when camera and FFmpeg are healthy
```

Stop with `Ctrl+C` before enabling systemd.

### 2.5 Run under systemd (recommended)

Create **`/etc/systemd/system/jps-jetty-live.service`**:

```ini
[Unit]
Description=JPS Jetty Live RTSP stream (rtsp-stream-viewer)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/jetty-planning-system/rtsp-stream-viewer
EnvironmentFile=/opt/jetty-planning-system/rtsp-stream-viewer/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust **`User=`** to your deploy user. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable jps-jetty-live
sudo systemctl start jps-jetty-live
sudo systemctl status jps-jetty-live
journalctl -u jps-jetty-live -f
```

After code or `.env` changes:

```bash
cd /opt/jetty-planning-system
git pull
cd rtsp-stream-viewer && npm ci
sudo systemctl restart jps-jetty-live
```

---

## 3. Connect JPS frontend (production nginx on app server)

Production builds **do not** use the Vite dev proxy. Use **same-origin paths** by extending nginx on the **app** server (recommended).

### 3.1 Add nginx locations

The repo already includes Jetty Live locations in **`Frontend/nginx.alicloud-app.conf`**, using **`host.docker.internal`** (not `127.0.0.1`) so nginx inside the `jps-fe` container reaches the stream process on the **host**. Ensure **`docker-compose.app.yml`** has `extra_hosts: host.docker.internal:host-gateway` (also in repo).

If you maintain a custom nginx file on the server, add the same blocks from that file, then ensure **`jps-jetty-live`** (systemd) is running on the host before rebuilding nginx.

Rebuild and restart the frontend container (from repo root on **app** server):

```bash
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml up --build -d
```

**Do not** set `VITE_JETTY_LIVE_HTTP_ORIGIN` in `.env` when using this nginx approach — the React app uses relative `/jetty-live-stream` and `/jetty-live-ws` (same host and port users already open, e.g. `http://<APP_PUBLIC_IP>:3080`).

### 3.2 Alternative: direct stream URL at build time

If the stream service runs on **another host** (option B), set at **frontend build** time in root `.env`:

```bash
VITE_JETTY_LIVE_HTTP_ORIGIN=http://<STREAM_HOST>:3081
```

Rebuild `jps-fe` so Vite bakes the value into `dist/`. The browser will call that origin for health and WebSocket (requires **CORS** on the stream service via `STREAM_CORS_ORIGINS` and may require **HTTPS/WSS** if the JPS UI is HTTPS — see §5).

---

## 4. RBAC and database

On the **backend** server:

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
```

Confirm migration **`072_jetty_live_page_permission.sql`** applied:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "SELECT resource_key FROM permissions WHERE resource_key = 'jetty-live' AND deleted_at IS NULL;"
```

In the JPS UI: **Admin → Role management** → edit role → enable **View** for **Jetty Live stream**.

---

## 5. HTTPS and mixed content

| JPS UI | Stream helper | Result |
|--------|---------------|--------|
| `http://...` | `http://` + `ws://` | OK if nginx proxies both on same origin (§3.1). |
| `https://...` | `http://` / `ws://` on another host | Browser may **block** mixed content. Use TLS on stream host or proxy WS through nginx with `wss`. |

Prefer **one public origin** (nginx on 443 or 3080) that proxies API, SPA, stream HTTP, and stream WebSocket.

---

## 6. Verification checklist

| Step | Command / action | Expected |
|------|------------------|----------|
| Stream process | `systemctl status jps-jetty-live` | `active (running)` |
| Health (on stream host) | `curl -s http://127.0.0.1:3081/api/health` | `"status":"online"` when camera OK |
| Health (via nginx) | `curl -s http://127.0.0.1:3080/jetty-live-stream/api/health` | Same JSON (host → `jps-fe` → host stream) |
| Browser | Open `http://<APP_PUBLIC_IP>:3080/jetty-live` | Nav **Jetty Live** (if RBAC granted), video on canvas |
| Logs | `journalctl -u jps-jetty-live -n 100` | FFmpeg connecting; no repeated `ENOENT` for ffmpeg |

---

## 7. Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| **Offline**, health unreachable | Stream service not running | `sudo systemctl start jps-jetty-live`; check `journalctl` |
| **Offline**, health OK but no video | WebSocket blocked or wrong URL | Confirm nginx `location /jetty-live-ws` and `host.docker.internal` in compose; browser devtools → Network → WS |
| Health via nginx fails, direct :3081 OK | nginx points at `127.0.0.1` inside container | Use `host.docker.internal` + `extra_hosts` (see [Frontend server steps](#frontend-app-server--exact-steps)) |
| **Offline**, `ffmpegRunning: false` | FFmpeg missing or RTSP failed | `which ffmpeg`; test `ffmpeg -rtsp_transport tcp -i "$RTSP_URL" -t 5 -f null -` |
| Worked locally, fails on server | Camera IP not routable from ECS | Run stream on a host with VPN/LAN to `172.16.x.x`; or fix peering |
| Port already in use | `HTTP_PORT` clashes with JPS | Use **3081** for stream HTTP; keep JPS on **3080** |
| Nav item missing | RBAC | Grant `jetty-live` view on role; hard-refresh after login |
| CORS errors in browser | Direct `VITE_JETTY_LIVE_HTTP_ORIGIN` | Add UI origin to `STREAM_CORS_ORIGINS` or switch to nginx proxy (§3.1) |

---

## 8. Environment reference (`rtsp-stream-viewer`)

| Variable | Default | Description |
|----------|---------|-------------|
| `RTSP_URL` | (dev default in code) | Full RTSP URL including credentials. **Set in production `.env`.** |
| `HTTP_PORT` | `3080` | Health + reconnect HTTP. Use **3081** on app server. |
| `WS_PORT` | `9999` | MPEG1 WebSocket port. |
| `STREAM_CORS_ORIGINS` | localhost Vite ports | Comma-separated origins for browser `fetch` to `/api/*`. |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary. |
| `WATCHDOG_RESTART_MS` | `3000` | Delay before auto-restart after failure. |
| `STALL_MS` | `8000` | Health marks offline if no frame this long. |
| `STALL_KILL_MS` | `30000` | Recycle stream if stalled this long. |

Frontend (build-time only, optional):

| Variable | Description |
|----------|-------------|
| `VITE_JETTY_LIVE_HTTP_ORIGIN` | e.g. `http://127.0.0.1:3081`. Omit when using nginx paths in §3.1. |
| `VITE_JETTY_LIVE_WS_PORT` | Used only with direct origin; health JSON usually supplies `wsPort`. |

---

## 9. Related documentation

- [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) — JPS app + backend ECS layout  
- [REBUILD-GUIDE.md](./REBUILD-GUIDE.md) — Rebuild frontend/backend after code changes  
- [LOCAL-FRONTEND-BACKEND-STARTUP.md](../Troubleshoot/LOCAL-FRONTEND-BACKEND-STARTUP.md) — Local port checks  
- `rtsp-stream-viewer/.env.example` — Stream service env template  
- `Frontend/.env.example` — Optional `VITE_JETTY_LIVE_*` notes  

---

## Quick reference — app server (standard Alicloud layout)

```bash
# 1) Stream service (same host as jps-fe)
cd /opt/jetty-planning-system/rtsp-stream-viewer
# edit .env: RTSP_URL, HTTP_PORT=3081, STREAM_CORS_ORIGINS
sudo systemctl enable --now jps-jetty-live

# 2) nginx: add /jetty-live-stream/ and /jetty-live-ws (§3.1)
# 3) Rebuild frontend container
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml up --build -d

# 4) Backend migration + RBAC (backend host)
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
```

Users open: **`http://<APP_PUBLIC_IP>:3080/jetty-live`**
