# Production — 3-server deploy + full data migration (staging → production)

This runbook deploys JPS to **three ECS instances** and performs a **full copy of staging data** (master + transactional) into production.

**Production servers (private IPs):**

- **App**: `172.28.80.50`
- **API**: `172.28.80.51`
- **DB**: `172.28.92.59`

**Related docs:**

- Baseline two-server deployment + security group guidance: `ALICLOUD-DEPLOYMENT-GUIDE.md`
- Three-server practice migration: `THREE-SERVER-DB-SPLIT-GUIDE.md`
- After-hours production cutover: `THREE-SERVER-DB-CUTOVER-RUNBOOK.md`
- Upload backup/restore (API host): `MANUAL-UPLOAD-RESTORE-GUIDE.md`

---

## 0. Non-negotiables / safety

- **Plan a maintenance window.** A full data migration requires a point-in-time snapshot.
- **Never expose PostgreSQL to the internet.** DB is reachable only inside the VPC, from the API host.
- **Do not run** `docker compose down -v` on production (deletes named volumes).
- **Secrets stay on servers** (`Backend/.env`, root `.env`); do not commit them.

---

## 1. Security group rules (production)

### 1.1 App server (`172.28.80.50`)

- **Inbound**: TCP **3080** from users (or your office/VPN IP range)
- **Outbound**: TCP **3000** to `172.28.80.51` (nginx → API)

### 1.2 API server (`172.28.80.51`)

- **Inbound**: TCP **3000** from **App private IP only** (`172.28.80.50`)
- **Outbound**: TCP **5432** to `172.28.92.59` (API → DB)

### 1.3 DB server (`172.28.92.59`)

- **Inbound**: TCP **5432** from **API private IP only** (`172.28.80.51`)
- No other inbound ports required for JPS DB.

---

## 2. Best-practice execution order (read this first)

For a **three-server** production deployment with a **full staging → production** data copy, use this order:

1. **DB server**: prepare + start Postgres (empty)
2. **Data migration**: dump staging → restore into prod DB (API stopped during restore)
3. **API server**: start API-only compose pointing at the prod DB + run `npm run migrate` (catch-up)
4. **App server**: build + start nginx/SPA pointing at the API server
5. **Smoke test**: health endpoints + browser verification

---

## 3. Code checkout (all three servers)

Production should deploy from the **hub repository main branch**:

- Repo: `https://github.com/dwsitproject-hub/Jetty-Planning-System`
- Branch: `main`

On **each** production host:

```bash
cd /opt/jetty-planning-system
# First-time clone (if the directory is empty)
git clone https://github.com/dwsitproject-hub/Jetty-Planning-System.git .

# Or, if already cloned:
git remote -v
git fetch origin
git checkout main
git pull origin main
git log -1 --oneline
```

---

## 4. DB server — start PostgreSQL only (Server 3)

On **DB** (`172.28.92.59`) use `Backend/infra/docker-compose.db.yml`.

### 4.1 Create DB env

```bash
cd /opt/jetty-planning-system
nano Backend/.env
```

Minimum required:

```bash
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<STRONG_PASSWORD>
POSTGRES_DB=jps_db

DB_BIND_IP=172.28.92.59
```

### 4.2 Start DB

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml up -d
docker ps | grep jps-db
```

Optional health:

```bash
docker exec -T jps-db pg_isready -U jps_user -d jps_db
```

---

## 5. Full data migration (staging → production)

This replaces **all** production DB contents with the **staging** dataset (master + transactional).

### 5.1 Freeze writes on staging

Recommended: stop staging app and API to prevent changes during the final dump.

### 5.2 Dump staging database

On the **staging DB host** (where staging `jps-db` runs), create a custom format dump:

```bash
docker exec -t jps-db pg_dump -U jps_user -d jps_db -Fc > jps_db_staging.dump
ls -lh jps_db_staging.dump
```

### 5.3 Copy dump to production DB server

From staging host:

```bash
scp jps_db_staging.dump root@172.28.92.59:/opt/jetty-planning-system/
```

### 5.4 Restore into production DB

1) Stop production API briefly (if it is running already):

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml stop
```

2) Recreate the target DB (inside prod DB container):

```bash
docker exec -it jps-db psql -U jps_user -d postgres
```

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='jps_db';
DROP DATABASE IF EXISTS jps_db;
CREATE DATABASE jps_db;
\q
```

3) Restore:

```bash
cd /opt/jetty-planning-system
docker exec -i jps-db pg_restore -U jps_user -d jps_db --clean --if-exists < jps_db_staging.dump
```

4) Spot checks (DB + schema):

```bash
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT COUNT(*) FROM users;"
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 10;"
```

### 5.5 Upload files (documents/photos) — staging → production API host

If you want **attachments** to match staging, copy the **uploads volume** from staging to production **API host** (uploads remain on Server 2; DB-only host does not store files).

On **staging API host**:

```bash
docker run --rm -v jps_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/jps-uploads-staging.tar.gz -C /data .
```

Copy to production API host (`172.28.80.51`), then restore:

```bash
docker run --rm -v jps_uploads:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/jps-uploads-staging.tar.gz -C /data"
```

For detailed, step-by-step restore and verification: `MANUAL-UPLOAD-RESTORE-GUIDE.md`.

---

## 6. API server — start API only (Server 2)

On **API** (`172.28.80.51`) use `docker-compose.backend-api-only.yml`.

### 6.1 Create API env

```bash
cd /opt/jetty-planning-system
nano Backend/.env
```

Key values:

```bash
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<SAME_PASSWORD_AS_DB_HOST>
POSTGRES_DB=jps_db

DB_HOST=172.28.92.59
DB_PORT=5432

JWT_SECRET=<STRONG_SECRET>

# Include the real browser URL users open (EIP / domain + port). Add private URL if you use it too.
CORS_ORIGIN=http://<PROD_EIP_OR_DOMAIN>:3080,http://172.28.80.50:3080

# If production uses plain HTTP, set false. If HTTPS, remove or set true.
COOKIE_SECURE=false
```

### 6.2 Build + run API

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d
curl -sS http://127.0.0.1:3000/health
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

---

## 7. App server — nginx + SPA (Server 1)

On **App** (`172.28.80.50`) use `docker-compose.app.yml`.

### 7.1 Point nginx upstream to the API server

Edit `Frontend/nginx.alicloud-app.conf`:

```nginx
upstream jps_backend {
    server 172.28.80.51:3000;
    keepalive 8;
}
```

### 7.2 Root `.env` for frontend build

```bash
cd /opt/jetty-planning-system
nano .env
```

Recommended:

```bash
JPS_FE_PORT=3080
VITE_API_BASE_URL=/api/v1
```

### 7.3 Build + run frontend

```bash
docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/
curl -sS http://127.0.0.1:3080/api/v1/health
```

---

## 8. Production smoke test

From **App host**:

```bash
curl -sS http://127.0.0.1:3080/api/v1/health
```

In a browser:

- Login
- Allocation / Shipment plans show expected data (copied from staging)
- Open an SI document preview/download (verifies uploads)

---

## 9. Rollback options (high level)

- **Fast rollback (app/API):** redeploy the previous git commit + rebuild.
- **DB rollback:** restore the pre-cutover DB dump you took from production before overwriting it.

