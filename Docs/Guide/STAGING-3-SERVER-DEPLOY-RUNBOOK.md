# Staging — First-Time 3-Server Deployment Runbook

Deploys JPS from the **`sit`** branch onto **three** Ubuntu servers in one private VPC:

| # | Server | Role | Compose file | Host port(s) |
|---|--------|------|--------------|--------------|
| 1 | **DB** | PostgreSQL only | `Backend/infra/docker-compose.db.yml` | `5432` (private only) |
| 2 | **Backend** | Node API only | `docker-compose.backend-api-only.yml` | `3000` (private only) |
| 3 | **Frontend / App** | nginx + React SPA + Jetty Live | `docker-compose.app.yml` | `3080` or `3001` (public) |

**Deploy order is mandatory: DB → Backend (migrate + seed) → Frontend.**

Substitute these placeholders throughout (use your real **private** VPC IPs):

| Placeholder | Meaning | Example |
|---|---|---|
| `DB_IP` | DB server private IP | `172.28.92.60` |
| `API_IP` | Backend server private IP | `172.28.92.57` |
| `APP_IP` | App server private IP | `172.28.92.56` |
| `APP_PUBLIC` | App public IP / DNS users hit | `203.0.113.10` or `staging.example.com` |
| `APP_PORT` | App host port | `3080` |

Target directory on **every** server: `/opt/jetty-planning-system`.

---

## 0. Security Group (Alibaba Cloud ECS → Inbound)

| Port | Server | Source | Purpose |
|---|---|---|---|
| 22 | all | your office/VPN IP | SSH |
| `APP_PORT` (3080/3001) | App | users / internet | SPA + proxied `/api/` |
| 3000 | Backend | **`APP_IP/32` only** | API (nginx → API) |
| 5432 | DB | **`API_IP/32` only** | Postgres (API → DB) |

Never expose 3000 or 5432 to the internet. The browser only ever talks to the App server.

---

## 1. One-time prep on ALL three servers

```bash
# Docker Engine + compose plugin (Ubuntu)
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker   # re-login afterwards

# Clone the repo (sit branch) into the standard path
sudo mkdir -p /opt/jetty-planning-system && sudo chown $USER:$USER /opt/jetty-planning-system
git clone https://github.com/dwsitproject-hub/Jetty-Planning-System.git /opt/jetty-planning-system
cd /opt/jetty-planning-system
git checkout sit && git pull origin sit
```

---

## 2. DB server (`DB_IP`) — PostgreSQL

```bash
cd /opt/jetty-planning-system

# Pre-create the bind-mount data dir (postgres runs as uid 999)
sudo mkdir -p /data/jps-postgres/docker-volumes/jps_pgdata
sudo chown -R 999:999 /data/jps-postgres/docker-volumes/jps_pgdata

# Allow the API server to authenticate to Postgres
sed -i 's/172.28.92.57/API_IP/' Backend/infra/postgres/pg_hba.conf   # replace API_IP with the real IP

# Backend/.env on the DB host (only DB vars are needed here)
cat > Backend/.env <<'ENV'
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=__STRONG_DB_PASSWORD__
POSTGRES_DB=jps_db
DB_BIND_IP=DB_IP
ENV

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml up -d
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml ps
docker logs jps-db --tail 30   # expect "database system is ready to accept connections"
```

Notes: Postgres binds to `DB_IP:5432` (private only) and uses the tuned `Backend/infra/postgres/postgresql.conf` / `pg_hba.conf`. Replace `__STRONG_DB_PASSWORD__` with a real secret.

---

## 3. Backend server (`API_IP`) — API + migrations

```bash
cd /opt/jetty-planning-system

cat > Backend/.env <<'ENV'
NODE_ENV=production
PORT=3000

# Point the API at the dedicated DB host
DB_HOST=DB_IP
DB_PORT=5432
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=__STRONG_DB_PASSWORD__       # must match the DB server
POSTGRES_DB=jps_db

JWT_SECRET=__STRONG_RANDOM_64_CHARS__
JWT_EXPIRES_IN=8h

# Browser origin(s) users actually open (the APP url). Comma-separate private + public.
CORS_ORIGIN=http://APP_PUBLIC:APP_PORT,http://APP_IP:APP_PORT
# If the app is served over plain http (not https), cookies must NOT require Secure:
COOKIE_SECURE=false
JPS_PUBLIC_ORIGIN=http://APP_PUBLIC:APP_PORT
APP_PUBLIC_URL=http://APP_PUBLIC:APP_PORT

# Uploads: NAS mount on the host (see SYNOLOGY-INTEGRATION). Omit to use a named volume.
# UPLOAD_HOST_PATH=/mnt/synology/dev/JETTYPLANNING
ENV

# Start the API (remote DB)
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d --build

# Run migrations (idempotent), then seed/refresh the admin login
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run seed:admin

# Health
curl -s http://localhost:3000/api/v1/health   # {"status":"ok",...}
```

Migrations apply all 86 files cleanly (031 is now a no-op). `seed:admin` sets `admin` / `admin123` — change it after first login.

> Switch to HTTPS later? Set `COOKIE_SECURE=true`, use `https://` in `CORS_ORIGIN`/`JPS_PUBLIC_ORIGIN`, and front the app with TLS (see `SUBDOMAIN-HTTPS-GUIDE.md`).

---

## 4. Frontend / App server (`APP_IP`)

```bash
cd /opt/jetty-planning-system

# Point nginx at the backend API private IP
sed -i 's/172.28.92.57:3000/API_IP:3000/' Frontend/nginx.alicloud-app.conf

# Root .env — browser API base. Relative path works for both private IP and public EIP.
cat > .env <<'ENV'
VITE_API_BASE_URL=/api/v1
JPS_FE_PORT=APP_PORT
ENV
# Optional: VITE_USE_LEGACY_VESSEL_PIPELINE=true to also show the legacy plan-based pipeline

# Jetty Live stream config (camera RTSP). Required for the jps-jetty-live container.
cp rtsp-stream-viewer/.env.example rtsp-stream-viewer/.env
# edit rtsp-stream-viewer/.env: set RTSP_URL=rtsp://USER:PASS@CAMERA_IP:554/Stream1 and RTSP_TRANSPORT=tcp

docker compose -f docker-compose.app.yml up -d --build
docker compose -f docker-compose.app.yml ps
```

Open **`http://APP_PUBLIC:APP_PORT`** → log in with `admin` / `admin123`.

---

## 5. Smoke test

```bash
# On the App server
curl -s -o /dev/null -w "SPA %{http_code}\n"  http://localhost:APP_PORT/
curl -s -o /dev/null -w "API %{http_code}\n"  http://localhost:APP_PORT/api/v1/health
```
In the browser: log in → Dashboard loads → Allocation & Berthing → **Jetty schedule** renders (2-colour bars, status/LATE chips, Export JPEG, visible scrollbars) → Jetty Live page shows the player.

---

## 6. Updating staging later (subsequent releases)

```bash
# App server (most releases are frontend-only)
cd /opt/jetty-planning-system && git pull origin sit
docker compose -f docker-compose.app.yml up -d --build

# Backend server (only when backend code or migrations change)
cd /opt/jetty-planning-system && git pull origin sit
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d --build
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

## 7. Rollback

```bash
# Redeploy a known-good commit on the affected server
cd /opt/jetty-planning-system
git log --oneline -5
git checkout <previous-good-sha>
docker compose -f docker-compose.app.yml up -d --build            # app, or the backend compose
# DB: migrations are forward-only — restore from a dump if a migration must be undone
# (pg_dump/pg_restore; see MANUAL-UPLOAD-RESTORE-GUIDE.md / PGADMIN-STAGING-DB-TUNNEL-WINDOWS.md)
```

---

### Secrets checklist (do not commit `.env` files — they are gitignored)
- `POSTGRES_PASSWORD` — identical on DB and Backend servers.
- `JWT_SECRET` — strong random, Backend only.
- `CORS_ORIGIN` — every origin users open the app from.
- `COOKIE_SECURE=false` for http staging; `true` once on https.

---

## 8. SLA email notification scheduler (cron)

After migration **093** and SMTP configured in **Admin → Notifications** (or via `SMTP_*` env vars):

The backend API process runs the **email worker** (polls `notification_deliveries` every ~20s). A separate **cron job** on the backend host evaluates SLA rules and queues notifications — no user login required.

```bash
# On the backend server (adjust path to your deploy root)
crontab -e
```

Add:

```cron
# D-1 ETC reminder — every 30 minutes
*/30 * * * * cd /opt/jetty-planning-system/Backend && /usr/bin/node scripts/run-sla-notifications.js --mode=d1 >> /var/log/jps-sla-notifications.log 2>&1

# SLA breach daily alert — 08:00 WIB (01:00 UTC)
0 1 * * * cd /opt/jetty-planning-system/Backend && /usr/bin/node scripts/run-sla-notifications.js --mode=breach >> /var/log/jps-sla-notifications.log 2>&1
```

**Docker backend:** run cron on the host with `DATABASE_URL` pointing at Postgres, or `docker compose exec` the script from the host cron:

```cron
*/30 * * * * docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api node scripts/run-sla-notifications.js --mode=d1
```

**Windows dev (optional):** Task Scheduler → `Backend/scripts/run-sla-notifications.bat --mode=d1`

**Verify:** Admin → Email Delivery Log; Activity Log on Notification Settings page shows job summaries.

**Smoke test:** `cd Backend && npm run test:sla-notifications`
