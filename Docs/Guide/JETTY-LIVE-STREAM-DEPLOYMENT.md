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

**You need (one time, on the backend server):** migrations **077** and **078** applied; **View Jetty Live stream** enabled under **At-Berth Executions** for your role in Admin. See [§4 RBAC](#4-rbac-and-database).

### Step 0 — Confirm the app server can reach the camera

From an SSH session on the **app** server:

```bash
# Replace with your real RTSP URL
ffmpeg -rtsp_transport tcp -i "rtsp://USER:PASS@172.16.247.222:554/Stream1" -t 5 -f null -
```

If this fails (timeout / connection refused), fix VPN/peering first — Jetty Live will stay **Offline** even when the stream service is running.

**Ping is not enough.** ICMP can succeed while TCP **554** (RTSP) is blocked. Always run the `ffmpeg` test above on the **app server**, not only `ping`.

**Security group direction (common mistake):** Jetty Live **pulls** video from the camera. The app server is the **client** connecting **outbound** to `172.16.247.222:554`.

| Rule you often need | Direction | What it does |
|---------------------|-----------|--------------|
| App server → camera | **Egress (outbound)** from app server to `172.16.247.222/32` (or `172.16.0.0/16`) port **554** | Lets FFmpeg open RTSP to the camera |
| Camera allows app server | On camera / camera VLAN firewall | Allow **source IP = app server private IP** to destination **554** |
| Inbound 554 on **Jetty FE** | **Inbound** to ECS on port 554 | Only needed if something connects **to** the FE host on 554 (not for pull-from-camera) |

An inbound rule like “Source `172.16.0.0/16` → Destination port **554** on current instance” allows cameras **in** that range to connect **to your server** on 554. It does **not** by itself allow your server to connect **out** to `172.16.247.222:554`. Confirm **outbound** on the app server security group (often default allow) and that the **camera side** permits your app server’s IP.

High RTT (e.g. ping ~800 ms) is normal over VPN/peering but can make the stream slow to start; set `RTSP_TRANSPORT=tcp` in `.env` and use the `ffmpeg` test with a longer `-t` if needed.

### Step 1 — SSH to the frontend server

```bash
ssh ubuntu@<APP_PUBLIC_IP>
cd /opt/jetty-planning-system
git pull
```

Use your real repo path if different (see [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md)).

### Step 2 — Install Node.js and FFmpeg on the host (not inside Docker)

Docker runs **only** the JPS SPA/nginx container. The stream service runs **on the Ubuntu host** via systemd.

Before installing, confirm free space on `/` (`df -h /`). If the disk is full, follow [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md) first.

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
RTSP_TRANSPORT=tcp
HTTP_PORT=3081
WS_PORT=9999
STREAM_OUTPUT_FPS=1
STREAM_MPEG1_RATE=25
STREAM_SCALE=640:-1
STREAM_IDLE_STOP_MS=30000
STREAM_CORS_ORIGINS=http://<APP_PUBLIC_IP>:3080,http://172.28.92.56:3080
```

Or copy the template: `cp .env.example .env` then edit.

| Variable | Why |
|----------|-----|
| `RTSP_TRANSPORT=tcp` | Required on many VPN/cloud paths; without it FFmpeg may hang on UDP. |
| `HTTP_PORT=3081` | Host port **3080** is already used by `jps-fe` (`JPS_FE_PORT=3080`). |
| `WS_PORT=9999` | WebSocket for video; nginx proxies `/jetty-live-ws` to this port on the host. |
| `STREAM_OUTPUT_FPS=1` | Throttle via **`-vf fps=1`** (target display rate). |
| `STREAM_MPEG1_RATE=25` | **mpeg1video** encoder `-r` (must be 24/25/30 — not `1`). |
| `STREAM_SCALE=640:-1` | Downscale HEVC/H.265 before MPEG-1; omit only if all cameras are H.264. |
| `STREAM_IDLE_STOP_MS=30000` | Stop FFmpeg 30 s after the last WebSocket viewer disconnects. |
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

1. Open **Allocation & Berthing → Jetty schematic**, click a **camera** icon on a jetty with an RTSP link (opens **`/jetty-live`** in a new tab)
2. Grant **View Jetty Live stream** under **At-Berth Executions** in **Admin → Roles** if the camera button is missing
3. Expand **Stream health** on the viewer if collapsed; use **Reconnect** if needed

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

rtsp-stream-viewer  →  FFmpeg (on-demand)  →  rtsp://<camera>:554/...
```

**On-demand FFmpeg:** the Node process and WebSocket server run continuously (systemd), but **FFmpeg starts only when the first viewer connects** to `/jetty-live-ws` and **stops 30 s after the last viewer disconnects**. Default transcode output is **1 fps** (`STREAM_OUTPUT_FPS=1`), not 25 fps.

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
| **Free disk on `/`** | FFmpeg + apt need **~1–2 GiB** free on the root filesystem. If `df -h /` shows **100%**, see [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md). |
| **JPS migrations 077 + 078** | **077** adds `jetties.rtsp_link`; **078** retires `jetty-live` page permission and migrates grants to **At-Berth `can_approve`**. Run `npm run migrate` on the backend. |
| **Role permission** | In **Admin → Roles**, under **At-Berth Executions**, enable **View Jetty Live stream** (`can_approve`) for roles that should see schematic camera buttons and open the viewer. |

---

## 1. Local development (Windows / Mac / Linux)

You need **two** processes:

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `cd rtsp-stream-viewer` → `.\start.bat` (Windows) or `./start.sh` — or from repo root: `npm run dev:stream` | Stream + health on **3080** / **9999** |
| 2 | `cd Frontend` → `npm run dev` — or repo root: `npm run dev:jetty-live` (starts stream + UI together) | JPS UI on **5173** |

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

### 2.2 Docker (recommended — unified app-server compose)

Jetty Live runs as container **`jps-jetty-live`** alongside **`jps-fe`** in **`docker-compose.app.yml`**. No separate Node/FFmpeg install or systemd unit on the host.

**One-time setup on the app server:**

```bash
cd /opt/jetty-planning-system   # adjust nested clone path if needed
cp rtsp-stream-viewer/.env.example rtsp-stream-viewer/.env
nano rtsp-stream-viewer/.env      # RTSP_URL, RTSP_TRANSPORT=tcp, optional STREAM_* tuning
chmod 600 rtsp-stream-viewer/.env
```

**If you previously used host systemd**, disable it before starting the container (avoids duplicate processes):

```bash
sudo systemctl disable --now jps-jetty-live
```

**Deploy / update (frontend + stream together):**

```bash
cd /opt/jetty-planning-system
git pull
docker compose -f docker-compose.app.yml up -d --build
docker compose -f docker-compose.app.yml ps
```

**Smoke test:**

```bash
# From app host — via nginx (same path browsers use)
curl -s http://127.0.0.1:3080/jetty-live-stream/api/health | jq .

# Stream container logs
docker compose -f docker-compose.app.yml logs -f jps-jetty-live
```

**Ports:** `3081` (HTTP) and `9999` (WebSocket) are **internal to the Docker network** only. Users reach Jetty Live through nginx on **`JPS_FE_PORT`** (e.g. **3080**) at `/jetty-live-stream/` and `/jetty-live-ws`. No UFW rules for Docker bridge → host **3081/9999** are required with this layout.

**Camera network:** the **`jps-jetty-live` container** must reach the camera RTSP URL (same egress/peering rules as when FFmpeg ran on the host). Test from inside the container:

```bash
docker compose -f docker-compose.app.yml exec jps-jetty-live \
  ffmpeg -rtsp_transport tcp -i "$RTSP_URL" -t 5 -f null -
```

(set `RTSP_URL` inline or export from `.env` first)

---

### 2.3 Legacy: host Node + systemd (optional)

Use only if you cannot run Docker for the stream service. Skip this section if you use **§2.2 Docker**.

#### 2.3.1 Install Node and FFmpeg (stream host)

SSH to the stream host (PuTTY / `ssh`):

```bash
# Node 20 LTS (Ubuntu) — if not already installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg

node -v
ffmpeg -version
```

### 2.3.2 Install dependencies and configure environment

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

### 2.3.3 Run manually (smoke test)

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

### 2.3.4 Run under systemd

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

The repo includes Jetty Live locations in **`Frontend/nginx.alicloud-app.conf`**, proxying to the **`jps-jetty-live`** container on the Docker network (`jps-jetty-live:3081` and `:9999`). **`docker-compose.app.yml`** defines both **`jps-fe`** and **`jps-jetty-live`** — no `host.docker.internal` or host systemd required.

Rebuild and restart on the **app** server:

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

Confirm migrations **`077_jetties_rtsp_link.sql`** and **`078_retire_jetty_live_page_permission.sql`** applied (migrate command above).

Verify **`jetty-live`** is retired:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c \
  "SELECT resource_key, deleted_at IS NOT NULL AS retired FROM permissions WHERE resource_key IN ('jetty-live','at-berth') AND resource_type = 'page';"
```

In the JPS UI: **Admin → Role management** → edit role → under **At-Berth Executions**, enable **View Jetty Live stream** (sub-checkbox, `can_approve`).

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
| Stream container | `docker compose -f docker-compose.app.yml ps jps-jetty-live` | `Up` |
| Idle (no viewers) | `curl -s http://127.0.0.1:3080/jetty-live-stream/api/health` | `"ffmpegRunning":false`, `"viewerCount":0` — normal when nobody is watching |
| Idle CPU | `docker compose -f docker-compose.app.yml exec jps-jetty-live ps aux` | No ffmpeg when no viewers |
| With viewer | Open **`/jetty-live`**, then curl health via nginx | `"viewerCount":≥1`, `"ffmpegRunning":true`, `"outputFps":1` when camera OK |
| Health (via nginx) | `curl -s http://127.0.0.1:3080/jetty-live-stream/api/health` | JSON from `jps-jetty-live` via `jps-fe` nginx |
| Browser | Allocation schematic → camera on jetty with RTSP | Opens **`/jetty-live`** popup; video on canvas when stream + RBAC OK |
| Logs | `docker compose -f docker-compose.app.yml logs -f jps-jetty-live` | `[stream] start: viewer_connect` when a tab opens; `idle stop` after last tab closes |

---

## 7. Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| **Offline**, `ffmpegRunning: false`, `viewerCount: 0` | No Jetty Live viewers (on-demand idle) | **Expected** when nobody is watching; open **`/jetty-live`** to start FFmpeg |
| **Offline**, health unreachable | Stream container not running | `docker compose -f docker-compose.app.yml up -d jps-jetty-live`; check logs |
| High CPU when CCTV unused | Old build ran FFmpeg 24/7 @ 25 fps | Deploy on-demand + `STREAM_OUTPUT_FPS=1`; verify no `ffmpeg` when idle |
| **Offline**, health OK but no video | WebSocket blocked or wrong URL | Confirm nginx `location /jetty-live-ws`; browser devtools → Network → WS |
| Health via nginx fails | `jps-jetty-live` not on same compose network as `jps-fe` | Use repo `docker-compose.app.yml`; `docker compose ps` shows both services |
| **Offline**, `ffmpegRunning: false` | FFmpeg missing or RTSP failed | `which ffmpeg`; test `ffmpeg -rtsp_transport tcp -i "$RTSP_URL" -t 5 -f null -` |
| Worked locally, fails on server | Camera IP not routable from ECS | Run stream on a host with VPN/LAN to `172.16.x.x`; or fix peering |
| Ping OK, RTSP/ffmpeg fails | Wrong firewall direction or TCP 554 blocked | See [Step 0](#step-0--confirm-the-app-server-can-reach-the-camera); fix **egress** + camera allowlist, not only inbound 554 on FE |
| `status: starting`, high `restartCount` | FFmpeg cannot read RTSP | `RTSP_TRANSPORT=tcp`; test `ffmpeg` on server; `journalctl -u jps-jetty-live -f` |
| Port already in use | `HTTP_PORT` clashes with JPS | Use **3081** for stream HTTP; keep JPS on **3080** |
| Camera button missing on schematic | RBAC | Enable **View Jetty Live stream** under **At-Berth Executions** in Admin → Roles; hard-refresh after login |
| CORS errors in browser | Direct `VITE_JETTY_LIVE_HTTP_ORIGIN` | Add UI origin to `STREAM_CORS_ORIGINS` or switch to nginx proxy (§3.1) |
| `apt` / **No space left on device** | Root disk `/` full (often 40 GiB ECS) | [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md) — check `df -h`, free Docker/apt cache, resize disk |

---

## 8. Environment reference (`rtsp-stream-viewer`)

| Variable | Default | Description |
|----------|---------|-------------|
| `RTSP_URL` | (dev default in code) | Full RTSP URL including credentials. **Set in production `.env`.** |
| `RTSP_TRANSPORT` | (unset) | Set to `tcp` on app server / VPN when UDP RTSP fails. |
| `HTTP_PORT` | `3080` | Health + reconnect HTTP. Use **3081** on app server. |
| `WS_PORT` | `9999` | MPEG1 WebSocket port. |
| `STREAM_OUTPUT_FPS` | `1` | Target frames/sec via **`-vf fps=`** (not `-r` on mpeg1video — MPEG-1 only supports rates like 24/25/30). |
| `STREAM_MPEG1_RATE` | `25` | Encoder `-r` passed to **mpeg1video** (must be a valid MPEG-1 rate). |
| `STREAM_SCALE` | `640:-1` | Width for **`scale=`** in the video filter (HEVC/H.265 friendly). Override full chain with **`STREAM_VIDEO_FILTER`**. |
| `STREAM_IDLE_STOP_MS` | `30000` | Stop FFmpeg this many ms after the last WebSocket viewer disconnects. |
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
- [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md) — Check usage, free space, resize ECS disk  
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

# 4) Backend migrations + RBAC (backend host)
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
# Admin → Roles → At-Berth Executions → View Jetty Live stream
```

Users open CCTV from **Allocation & Berthing → Jetty schematic** (camera icon → **`/jetty-live`** popup).
