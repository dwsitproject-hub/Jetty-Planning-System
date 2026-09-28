# DataHub inbound webhooks — staging deploy (3-server + `staging` branch)

Deploy webhook code to the **staging environment** first. Source code comes from GitHub branch **`staging`**, not **`main`**.

**Repo:** `https://github.com/dwsitproject-hub/Jetty-Planning-System.git`  
**Deploy path on each server:** `/opt/jetty-planning-system`

**Related:** [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) (greenfield), [DATAHUB-WEBHOOK-IMPLEMENTATION-PLAN.md §6.1](./DATAHUB-WEBHOOK-IMPLEMENTATION-PLAN.md), [DATAHUB-WEBHOOK-PRODUCTION-DEPLOY.md](./DATAHUB-WEBHOOK-PRODUCTION-DEPLOY.md) (after staging E2E).

---

## 1. Staging topology

| # | Role | IP | Compose |
| --- | --- | --- | --- |
| **1 — App** | nginx + SPA | **`172.28.92.56`** | `docker-compose.app.yml` → **3080** |
| **2 — API** | Node `jps-api` | **`172.28.92.57`** | `docker-compose.backend-api-only.yml` → **3000** |
| **3 — DB** | PostgreSQL | **`172.28.92.60`** | `Backend/infra/docker-compose.db.yml` → **5432** |

**Users:** `http://172.28.92.56:3080` (or public EIP on **3080**).  
**DHM portal (reference):** often **`172.28.92.56:2001`** — separate from JPS.  
**DHM → JPS webhook (Option D, co-located on `.57`):**

`http://172.28.92.57:3000/api/v1/datahub/webhook`

DHM dispatcher on **`.57`** POSTs to JPS on the same host (HTTP allowed for staging per integrator).

---

## 2. Workstation — confirm GitHub `staging`

```bash
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline
git push origin staging   # if you have unpushed commits
```

Expect migration **`Backend/migrations/120_datahub_webhook.sql`** on this branch.

---

## 3. Save rollback (App + API)

On **`172.28.92.57`** and **`172.28.92.56`**:

```bash
cd /opt/jetty-planning-system
git fetch origin
git rev-parse HEAD | tee /root/jps-staging-rollback-sha.txt
git log -1 --oneline
```

One-time: track **`staging`** if the server still uses **`sit`** or **`main`**:

```bash
git checkout staging
git pull origin staging
git branch -u origin/staging staging
```

**DB host (`.60`):** no git pull required for this release unless you change Postgres infra.

---

## 4. API server — `172.28.92.57`

### 4.1 Pull code

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline
```

### 4.2 Edit `Backend/.env` (add lines; keep existing secrets)

```bash
nano /opt/jetty-planning-system/Backend/.env
```

**Typical staging core (verify, do not overwrite blindly):**

```bash
NODE_ENV=production
PORT=3000

DB_HOST=172.28.92.60
DB_PORT=5432
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<staging db password>
POSTGRES_DB=jps_db

JWT_SECRET=<staging secret>
JWT_EXPIRES_IN=8h

CORS_ORIGIN=http://172.28.92.56:3080,http://<STAGING_PUBLIC_EIP>:3080
COOKIE_SECURE=false
JPS_PUBLIC_ORIGIN=http://172.28.92.56:3080
APP_PUBLIC_URL=http://172.28.92.56:3080

UPLOAD_HOST_PATH=/mnt/synology/dev/JETTYPLANNING

# Inbound DHM webhooks (this release)
DHM_WEBHOOK_ENABLED=true
DHM_WEBHOOK_SECRET=whsec_demo_secret
DHM_WEBHOOK_AUTO_APPLY=true
JPS_DATAHUB_WEBHOOK_CALLBACK_URL=http://172.28.92.57:3000/api/v1/datahub/webhook
```

Use the **exact** secret registered in the DHM staging app (replace `whsec_demo_secret` if rotated).

**Docker note:** `docker-compose.backend-api-only.yml` does **not** pass `DHM_*` into the container by default. Either:

- **Recommended:** enable webhooks + secret in **Admin → DataHub** after deploy, or  
- Add to compose `jps-api.environment` on the server:

```yaml
DHM_WEBHOOK_ENABLED: ${DHM_WEBHOOK_ENABLED:-}
DHM_WEBHOOK_SECRET: ${DHM_WEBHOOK_SECRET:-}
DHM_WEBHOOK_AUTO_APPLY: ${DHM_WEBHOOK_AUTO_APPLY:-}
JPS_DATAHUB_WEBHOOK_CALLBACK_URL: ${JPS_DATAHUB_WEBHOOK_CALLBACK_URL:-}
```

Then recreate `jps-api`.

If **`DB_HOST`** already points at **ApsaraDB RDS** after cutover, keep that value ([APSARADB-STAGING-CUTOVER.md](./APSARADB-STAGING-CUTOVER.md)).

### 4.3 Build, migrate, restart

```bash
cd /opt/jetty-planning-system

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d jps-api

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate

curl -sS http://127.0.0.1:3000/api/v1/health
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml logs --tail=30 jps-api
```

### 4.4 Local smoke (HMAC)

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api \
  node scripts/simulate-dhm-webhook.mjs
```

Expect **200** with a `runId` (or duplicate on second run).

---

## 5. App server — `172.28.92.56`

Nginx upstream must be **`172.28.92.57:3000`** in `Frontend/nginx.alicloud-app.conf`.

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline

docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d

curl -sS http://127.0.0.1:3080/api/v1/health
```

Root `.env` (usually unchanged):

```bash
JPS_FE_PORT=3080
VITE_API_BASE_URL=/api/v1
```

---

## 6. DHM portal (staging app)

| Setting | Value |
| --- | --- |
| Webhook URL | `http://172.28.92.57:3000/api/v1/datahub/webhook` |
| Events | `record.updated`, `record.deleted` |
| Entity | `vessel`, `incoterm`, `commodity` (register each in DHM if you use that master) |
| HMAC secret | Same as `DHM_WEBHOOK_SECRET` or Admin → DataHub |

Requires **Option D** (HTTP allowlist for staging) if not using `127.0.0.1` loopback tests.

---

## 7. JPS Admin + E2E (UI controls policy)

Use **Admin → DataHub** (not `.env`) to turn inbound webhooks and **auto-apply** on or off, then **Save settings**.

| Auto-apply checkbox | DHM update behaviour |
| --- | --- |
| **Off** (default) | Staged run → **Master → Vessel / Term / Commodity** → **Resume review** → Apply |
| **On** | Hub change writes to the matching master immediately |

After deploy on API **`.57`**, run migrations **123** and **124** (`entity_type` on sync runs; hub columns on SI masters).

Manual pull (no webhook): **Master – Term** or **Master – Commodity** → **Sync from DataHub** → review → apply.

1. Open **`http://172.28.92.56:3080`** → **Admin → DataHub**.
2. Enable inbound webhooks, set secret, choose auto-apply, **Save settings**.
3. Edit a vessel, incoterm, or commodity in DHM → **Deliveries** **2xx** → confirm grid or review flow matches the checkbox.

---

## 8. Rollback

```bash
cd /opt/jetty-planning-system
git checkout "$(cat /root/jps-staging-rollback-sha.txt)"
# Rebuild API and/or App as in §4.3 / §5
```

Migration **120** is forward-only; disable webhooks in Admin or DHM to stop traffic.

---

## 9. After staging passes

Deploy the same **`staging`** branch to production servers per [DATAHUB-WEBHOOK-PRODUCTION-DEPLOY.md](./DATAHUB-WEBHOOK-PRODUCTION-DEPLOY.md) (different IPs, HTTPS callback, production DHM app).
