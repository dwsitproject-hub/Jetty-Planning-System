# Three-server DB cutover — operator runbook

Step-by-step checklist for the **production switchover** maintenance window: move live JPS traffic from PostgreSQL on the **API server** to the **dedicated DB server**.

| Document | Use when |
|----------|----------|
| **[THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md)** | Full project playbook (host audit, Docker, security, practice migration) |
| **This runbook** | After-hours **cutover only** — copy/paste commands in order |

**Target directory (all servers):** `/opt/jetty-planning-system`

---

## Environment (production example — confirm your IPs)

| Role | Private IP | Hostname (example) | Compose / notes |
|------|------------|--------------------|-----------------|
| **Server 1 — App** | `172.28.92.56` | App ECS | `docker-compose.app.yml` — **no change** at cutover |
| **Server 2 — API** | `172.28.92.57` | `iZk1a4m0oobaw170notm7pZ` | `jps-api` + local `jps-db` until cutover |
| **Server 3 — DB** | `172.28.92.60` | `iZk1ab5rh48e40enbqa7iiZ` | `Backend/infra/docker-compose.db.yml` |

**Security group (DB host):** inbound **TCP 5432** from **`172.28.92.57/32` only**.

---

## What this runbook is / is not

| Action | Cutover? |
|--------|----------|
| `pg_isready` / `psql` test from `.57` → `.60` | **No** — safe anytime after SG is open |
| Practice `pg_dump` + `scp` + `pg_restore` | **No** — rehearsal only |
| Steps in **§ Cutover** below | **Yes** — causes API downtime |

**Estimated downtime:** ~15–30 minutes for a small DB (~200 KB dump); longer for large databases or slow networks.

---

## Prerequisites (complete before the window)

Check each item **before** the maintenance window.

- [ ] **Server 3** Postgres running and healthy (`pg_isready` on `.60`)
- [ ] **Practice restore** succeeded; row counts on `.60` matched `.57`
- [ ] **SG rule** applied: TCP **5432** on DB ECS, source **`172.28.92.57/32`**
- [ ] **Connectivity test** from Server 2:
  ```bash
  docker run --rm postgres:16-alpine pg_isready -h 172.28.92.60 -p 5432 -U jps_user -d jps_db
  ```
- [ ] **`Backend/.env` on Server 3** — `POSTGRES_PASSWORD` matches Server 2
- [ ] **`pg_hba.conf` on Server 3** — `host jps_db jps_user 172.28.92.57/32`
- [ ] **Backups on Server 2:**
  ```bash
  cd /opt/jetty-planning-system
  cp docker-compose.backend.yml docker-compose.backend.yml.bak
  cp Backend/.env Backend/.env.bak
  ```
- [ ] **`docker-compose.backend-api-only.yml`** on Server 2 (from `git pull`)
- [ ] **`DB_HOST` / `DB_PORT`** in Server 2 `Backend/.env` (do not restart API until cutover)
- [ ] **Stakeholders notified**
- [ ] **Two SSH sessions:** Server 2 + Server 3

**Do not** run `docker compose down -v` on Server 2 (destroys rollback volume `jps_pgdata`).

---

## Pre-window: baseline counts (Server 2)

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "
    SELECT COUNT(*) AS users FROM users;
    SELECT COUNT(*) AS operations FROM operations;
    SELECT COUNT(*) AS migrations FROM schema_migrations;
    SELECT pg_size_pretty(pg_database_size('jps_db')) AS db_size;
  "
```

On **Server 3**, use `Backend/infra/docker-compose.db.yml` (not `docker-compose.backend.yml`):

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "SELECT COUNT(*) AS users FROM users;"
```

Write down the values.

---

## Cutover (run in order)

Use **Server 2** unless noted as **Server 3**.

### Step 1 — Stop API (freeze writes)

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml stop jps-api
```

**Leave local `jps-db` running** on Server 2 for the dump.

---

### Step 2 — Final dump (Server 2)

```bash
cd /opt/jetty-planning-system
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p backups

docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  pg_dump -U jps_user -d jps_db -Fc --no-owner --no-acl \
  > "backups/jps_db_final_${STAMP}.dump"

ls -lh "backups/jps_db_final_${STAMP}.dump"
echo "STAMP=$STAMP"
```

If **0 bytes**, stop and investigate.

---

### Step 3 — Copy dump to Server 3

**Server 2:**

```bash
ssh root@172.28.92.60 'mkdir -p /opt/jetty-planning-system/backups'
scp "backups/jps_db_final_${STAMP}.dump" \
  root@172.28.92.60:/opt/jetty-planning-system/backups/
```

**Server 3:**

```bash
ls -lh /opt/jetty-planning-system/backups/jps_db_final_*.dump
```

---

### Step 4 — Final restore (Server 3)

Replace `<STAMP>` with Step 2 value:

```bash
cd /opt/jetty-planning-system
DUMP="/opt/jetty-planning-system/backups/jps_db_final_<STAMP>.dump"

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d postgres -c "DROP DATABASE IF EXISTS jps_db WITH (FORCE);"

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d postgres -c "CREATE DATABASE jps_db OWNER jps_user;"

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  pg_restore -U jps_user -d jps_db --no-owner --no-acl < "$DUMP"
```

**Verify counts** (match Server 2 dump-time counts):

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "
    SELECT COUNT(*) AS users FROM users;
    SELECT COUNT(*) AS operations FROM operations;
    SELECT COUNT(*) AS migrations FROM schema_migrations;
  "
```

If counts differ, **do not** start API — rollback (below).

---

### Step 5 — Start API against Server 3 (Server 2)

`Backend/.env` must include:

```env
DB_HOST=172.28.92.60
DB_PORT=5432
```

```bash
cd /opt/jetty-planning-system

docker compose --env-file Backend/.env \
  -f docker-compose.backend-api-only.yml up -d --build jps-api
```

If container name conflict:

```bash
docker rm -f jps-api
docker compose --env-file Backend/.env \
  -f docker-compose.backend-api-only.yml up -d --build jps-api
```

**Logs:**

```bash
docker compose --env-file Backend/.env \
  -f docker-compose.backend-api-only.yml logs --tail 50 jps-api
```

**Migrations:**

```bash
docker compose --env-file Backend/.env \
  -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

---

### Step 6 — Smoke test (browser)

App URL unchanged (Server 1 → proxies to `.57:3000`):

- [ ] Login
- [ ] List operations / SI
- [ ] Open one record

---

### Step 7 — Stop local Postgres (after stable)

**Do not** use `down -v`. Keep `jps_pgdata` 48–72h.

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml stop jps-db
```

---

## Rollback (Server 2)

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml stop jps-api 2>/dev/null || true
docker rm -f jps-api 2>/dev/null || true

cp Backend/.env.bak Backend/.env
docker compose --env-file Backend/.env -f docker-compose.backend.yml.bak up -d jps-db
docker compose --env-file Backend/.env -f docker-compose.backend.yml.bak exec -T jps-db \
  pg_isready -U jps_user -d jps_db
docker compose --env-file Backend/.env -f docker-compose.backend.yml.bak up -d jps-api
```

---

## Post-cutover deploy (Server 2)

After code changes:

```bash
cd /opt/jetty-planning-system
git pull origin sit-post-bontang-visit
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d --build jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

**Do not** use `docker-compose.backend.yml` for routine deploys after cutover (that stack includes local `jps-db`).

---

## Related

- [THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md)
- [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md)
- [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md)
