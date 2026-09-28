# DataHub inbound webhooks — production deploy (3-server layout)

Deploy the inbound DHM webhook feature to **production** on the same **three-server** model as the rest of JPS. This release includes migration **`120_datahub_webhook.sql`**, API changes, and Admin / Master Vessel UI updates.

**Prerequisites**

- Staging E2E complete ([DATAHUB-WEBHOOK-STAGING-TEST.md](./DATAHUB-WEBHOOK-STAGING-TEST.md)).
- **Source branch:** **`staging`** on `https://github.com/dwsitproject-hub/Jetty-Planning-System` — production App and API hosts deploy from **`staging`**, not **`main`**, for this release.
- A short **maintenance window** (~5–15 minutes): API restart + optional app rebuild.

**Related runbooks**

| Doc | Use for |
| --- | --- |
| [PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md](./PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md) | Production IPs, compose files, security groups |
| [HOTFIX-DEPLOY-RUNBOOK.md](./HOTFIX-DEPLOY-RUNBOOK.md) | Rollback SHA, rebuild pattern |
| [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) | Staging **environment** (`.56` / `.57` / `.60`); same **`staging`** branch, different servers |
| [DATAHUB-WEBHOOK-IMPLEMENTATION-PLAN.md](./DATAHUB-WEBHOOK-IMPLEMENTATION-PLAN.md) | Behaviour, security, callback rules |
| [SUBDOMAIN-HTTPS-GUIDE.md](./SUBDOMAIN-HTTPS-GUIDE.md) | If production users hit **`https://…`** (no `:3080`) |

---

## 1. Production topology (3 servers)

| # | Role | Private IP (reference) | Compose | Notes |
| --- | --- | --- | --- | --- |
| **1 — App** | nginx + React SPA (+ Jetty Live) | **`172.28.80.50`** | `docker-compose.app.yml` | Users reach **`http(s)://<public>:3080`** or HTTPS subdomain |
| **2 — API** | Node `jps-api` | **`172.28.80.51`** | `docker-compose.backend-api-only.yml` | Port **3000** — inbound from **App only** (`172.28.80.50/32`) |
| **3 — DB** | PostgreSQL | **`172.28.92.59`** | `Backend/infra/docker-compose.db.yml` | Port **5432** — inbound from **API only** (`172.28.80.51/32`) |

**Traffic path:** Browser → App **3080** → nginx **`/api/`** → API **`172.28.80.51:3000`**.

If you already cut over DB to **ApsaraDB RDS**, keep using your current **`DB_HOST`** on the API server (see [APSARADB-PRODUCTION-CUTOVER.md](./APSARADB-PRODUCTION-CUTOVER.md)); only the **API `.env`** changes — Server 3 steps below may not apply.

**Staging reference (do not copy URLs to prod DHM):**

| Role | Staging IP |
| --- | --- |
| App | `172.28.92.56` |
| API | `172.28.92.57` |
| DB | `172.28.92.60` |

---

## 2. Before you deploy

### 2.1 Confirm `staging` on GitHub

On your workstation (or CI):

```bash
cd /path/to/Jetty-Planning-System
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline
ls Backend/migrations/120_datahub_webhook.sql
```

Push any local commits before production deploy:

```bash
git push origin staging
```

On **production** App and API servers, the clone should track **`origin/staging`** (one-time setup if they currently checkout `main`):

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout staging
git branch -u origin/staging staging
```

### 2.2 Choose production webhook callback URL (DHM portal)

DHM **production** must use **HTTPS** (no staging “Option D” HTTP on LAN).

| Scenario | Register in DHM production app | Network |
| --- | --- | --- |
| **A — Recommended** | `https://<PROD_PUBLIC_HOST>/api/v1/datahub/webhook` | Same URL users use for JPS (host nginx or TLS subdomain proxies `/api/` to API) |
| **B — DHM co-located on API host** | Agree with DHM integrator: e.g. `http://172.28.80.51:3000/api/v1/datahub/webhook` only if DHM dispatcher runs on **`172.28.80.51`** and integrator allows **HTTP to private API** (staging-like; confirm in writing) |

Replace `<PROD_PUBLIC_HOST>` with your real hostname, e.g. `203.0.113.x:3080` or `jps.energi-up.com` — **must match exactly** what DHM will POST to.

**Do not** register `http://172.28.80.50:3080/...` unless TLS terminates elsewhere and DHM still sees **https** in the registered URL.

### 2.3 Save rollback points

On **API** (`172.28.80.51`) and **App** (`172.28.80.50`):

```bash
cd /opt/jetty-planning-system
git fetch origin
git rev-parse HEAD | tee /root/jps-prod-rollback-sha.txt
git log -1 --oneline | tee -a /root/jps-prod-rollback-log.txt
```

---

## 3. Server 3 — DB (`172.28.92.59`)

**No `.env` changes** are required for webhooks on the DB host.

Optional: take a backup before migration on API (see [NAS-DB-BACKUP-MANUAL-RETENTION.md](./NAS-DB-BACKUP-MANUAL-RETENTION.md)).

Migration **`120`** runs from the **API** container (next section), not on the DB host directly.

---

## 4. Server 2 — API (`172.28.80.51`)

### 4.1 Pull code

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline
```

### 4.2 Update `Backend/.env` (edit in place)

Open the existing file — **do not replace** the whole file; add or adjust only what you need.

```bash
nano /opt/jetty-planning-system/Backend/.env
```

#### Always verify (unchanged unless you fix a prod issue)

These should already be set for production; confirm they are still correct:

```bash
NODE_ENV=production
PORT=3000

DB_HOST=172.28.92.59
DB_PORT=5432
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<same as DB server>
POSTGRES_DB=jps_db

JWT_SECRET=<existing prod secret>
JWT_EXPIRES_IN=8h

# Every browser origin users actually use (comma-separated):
CORS_ORIGIN=https://<PROD_PUBLIC_HOST>,http://172.28.80.50:3080
# If still plain HTTP on :3080 only:
# CORS_ORIGIN=http://<PROD_EIP>:3080,http://172.28.80.50:3080

COOKIE_SECURE=true
# Use false only if the SPA is still plain http://...:3080 with no HTTPS

JPS_PUBLIC_ORIGIN=https://<PROD_PUBLIC_HOST>
APP_PUBLIC_URL=https://<PROD_PUBLIC_HOST>

UPLOAD_HOST_PATH=/mnt/synology/JETTYPLANNING

TRUST_PROXY=1
```

#### DataHub API client (if not already in Admin → DataHub)

If outbound sync credentials live only in the DB via Admin UI, **skip** these. If you use env fallback:

```bash
DHM_BASE_URL=https://<dhm-api-host>
DHM_PUBLIC_KEY=dhm_pk_...
DHM_PRIVATE_KEY=dhm_sk_...
```

#### Inbound webhooks (this release)

**Preferred on Docker production:** configure in **Admin → DataHub** after deploy (secret stored encrypted in DB). You do **not** have to put the webhook secret in `.env`.

Optional env fallback (only if you add the variables to `docker-compose.backend-api-only.yml` `environment:` block — see §4.2.1):

```bash
# DHM_WEBHOOK_ENABLED=true
# DHM_WEBHOOK_SECRET=whsec_<production_secret_from_dhm_portal>
```

**Callback URL shown in Admin** (must match DHM registration):

```bash
JPS_DATAHUB_WEBHOOK_CALLBACK_URL=https://<PROD_PUBLIC_HOST>/api/v1/datahub/webhook
```

If this line is omitted, the UI defaults to the **staging** URL — misleading for operators; set it on production.

#### 4.2.1 Docker note — env vars inside `jps-api`

`docker-compose.backend-api-only.yml` passes **`JWT_SECRET`**, **`CORS_ORIGIN`**, etc., but **not** `DHM_*` or `JPS_DATAHUB_WEBHOOK_CALLBACK_URL` by default.

| Setting | Works without compose change? |
| --- | --- |
| Webhook **enable + secret** | **Yes** — use **Admin → DataHub** (database) |
| Webhook **secret via `.env` only** | **No** — unless you add `DHM_WEBHOOK_*` to compose `environment:` and recreate container |
| **`JPS_DATAHUB_WEBHOOK_CALLBACK_URL`** in Admin display | **No** — add to compose or rely on DHM portal docs |

To pass callback URL into the container (optional one-line compose addition on the server):

```yaml
# under jps-api.environment:
JPS_DATAHUB_WEBHOOK_CALLBACK_URL: ${JPS_DATAHUB_WEBHOOK_CALLBACK_URL:-}
```

Then `docker compose ... up -d` again.

### 4.3 Build, migrate, restart API

```bash
cd /opt/jetty-planning-system

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d jps-api

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml logs --tail=40 jps-api
curl -sS http://127.0.0.1:3000/api/v1/health
```

Confirm migration applied:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api \
  node -e "console.log('ok')"
# Or on DB host:
# docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT name FROM schema_migrations WHERE name LIKE '%120%';"
```

### 4.4 Configure webhooks in JPS (after API is up)

1. Log in to production JPS as admin.
2. **Admin → DataHub**
   - Enable **DataHub integration** if vessel pull is used (base URL, API keys).
   - Enable **Inbound webhooks**.
   - Paste **webhook HMAC secret** from DHM production portal (not the staging `whsec_demo_secret`).
   - Confirm **Callback URL** matches DHM (fix `JPS_DATAHUB_WEBHOOK_CALLBACK_URL` + compose if the UI still shows staging).
   - Leave **Auto-apply** off unless product approves (**review first** is default).
3. **Master → Vessel** — confirm sync run list can show **Webhook** badge after a test event.

---

## 5. Server 1 — App (`172.28.80.50`)

Webhook POSTs hit **`/api/v1/datahub/webhook`** through the same nginx **`/api/`** proxy as the rest of the API. No nginx change is required unless upstream IP is wrong.

### 5.1 Verify nginx upstream

`Frontend/nginx.alicloud-app.conf` must point to production API:

```nginx
upstream jps_backend {
    server 172.28.80.51:3000;
    keepalive 8;
}
```

### 5.2 Pull and rebuild (UI + Admin DataHub panel)

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout staging
git pull origin staging
git log -1 --oneline

docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/
curl -sS http://127.0.0.1:3080/api/v1/health
```

Root **`.env`** on the app server (unchanged for webhooks unless you change public URL):

```bash
JPS_FE_PORT=3080
VITE_API_BASE_URL=/api/v1
```

If you use **host-level HTTPS** ([SUBDOMAIN-HTTPS-GUIDE.md](./SUBDOMAIN-HTTPS-GUIDE.md)), ensure **`X-Forwarded-Proto`** reaches the API and **`COOKIE_SECURE=true`** on the API `.env`.

---

## 6. DHM production portal

1. Open the **production** JPS app in DHM (not staging).
2. **Webhook URL:** `https://<PROD_PUBLIC_HOST>/api/v1/datahub/webhook` (or agreed variant from §2.2).
3. **Events:** `record.updated`, `record.deleted` (add `record.created` only if product wants it).
4. **Entity:** `vessel` (only entity supported in v1).
5. Copy the new **webhook secret** into JPS Admin (§4.4) — rotate if it was ever exposed in staging docs.

---

## 7. Production smoke test

| Step | Action | Expected |
| --- | --- | --- |
| 1 | `curl -sS https://<PROD_PUBLIC_HOST>/api/v1/health` (or via `:3080`) | `status` ok |
| 2 | Log in, open **Admin → DataHub** | Webhook enabled, secret configured, callback URL correct |
| 3 | Edit a vessel in **DHM production** | DHM **Deliveries** → **2xx** |
| 4 | JPS **Master → Vessel** | New sync run, source **Webhook**, items **pending** |
| 5 | Approve + **Apply** | Master vessel updated |
| 6 | Replay same delivery in DHM | **200 duplicate**, no second run |

Optional on API host (uses secret from env or simulate with known secret):

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api \
  node scripts/simulate-dhm-webhook.mjs
```

---

## 8. Rollback

Follow [HOTFIX-DEPLOY-RUNBOOK.md §8](./HOTFIX-DEPLOY-RUNBOOK.md):

```bash
cd /opt/jetty-planning-system
git checkout "$(cat /root/jps-prod-rollback-sha.txt)"
# Rebuild API and/or App as in §4.3 / §5.2
```

**Migration 120 is forward-only** — rolling back code does not drop webhook tables. That is safe; old code simply ignores them. Disable webhooks in Admin or DHM if you need to stop inbound traffic without redeploying.

---

## 9. `.env` cheat sheet (this release only)

| Variable | Server | Required for webhooks? | Notes |
| --- | --- | --- | --- |
| `DB_HOST`, `POSTGRES_*`, `JWT_SECRET`, `CORS_ORIGIN` | API | Yes (existing) | Unchanged |
| `JPS_PUBLIC_ORIGIN`, `COOKIE_SECURE`, `TRUST_PROXY` | API | Recommended | Match HTTPS / proxy layout |
| `JPS_DATAHUB_WEBHOOK_CALLBACK_URL` | API (+ compose pass-through) | Strongly recommended | Must match DHM URL |
| `DHM_WEBHOOK_SECRET`, `DHM_WEBHOOK_ENABLED` | API | Optional | Prefer **Admin → DataHub** on Docker |
| `DHM_BASE_URL`, `DHM_PUBLIC_KEY`, `DHM_PRIVATE_KEY` | API | If using env for outbound sync | Or Admin UI only |
| `VITE_*`, `JPS_FE_PORT` | App root `.env` | No change for webhooks | Rebuild app for UI labels |

**Never commit** `Backend/.env` or production secrets to git.

---

*Document version: 2026-09 — production 3-server (`172.28.80.50` / `.51` / `172.28.92.59`), deploy branch **`staging`**, inbound DataHub webhooks migration 120.*
