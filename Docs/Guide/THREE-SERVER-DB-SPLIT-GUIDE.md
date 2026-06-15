# Three-server database split — migration playbook

This guide describes how to move JPS from a **two-server** layout (app + API/DB combined) to a **three-server** layout with PostgreSQL on a dedicated host, using Docker Compose and minimal downtime.

| Transition | Layout |
|------------|--------|
| **Current** | Server 1 (frontend) \| Server 2 (Node.js API + PostgreSQL) |
| **Target** | Server 1 (frontend) \| Server 2 (Node.js API only) \| Server 3 (PostgreSQL only) |

**Prerequisites:** JPS already deployed per [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) (two ECS instances, same VPC). Replace example private IPs throughout (`172.28.92.56` app, `172.28.92.57` API, `172.28.92.60` DB) with your values.

**Production cutover (maintenance window):** use the step-by-step **[THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md)** — prerequisites checklist, dump/restore, API switch, rollback.

**Related:**

- [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md) — after-hours switchover only
- [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) — initial two-server deploy, Docker install, security groups
- [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md) — uploads on Synology NAS (`UPLOAD_HOST_PATH`) or local `jps_uploads` volume
- [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md) — sizing and expanding the DB data disk
- [PGADMIN-STAGING-DB-TUNNEL-WINDOWS.md](./PGADMIN-STAGING-DB-TUNNEL-WINDOWS.md) — SSH tunnel pattern (adapt host/port after split)

**Target directory (all servers):** `/opt/jetty-planning-system`

---

## Architecture after split

```text
Browser → Server 1 (nginx :3080)
              → Server 2 (jps-api :3000)     [VPC private]
                    → Server 3 (jps-db :5432) [VPC private, TCP only]
```

- Users and the public internet **never** connect to PostgreSQL.
- Server 1 configuration is **unchanged** (nginx still proxies to Server 2 `:3000`).
- Upload files remain on Server 2 (Synology NAS via `UPLOAD_HOST_PATH`, or `jps_uploads` volume before NAS cutover); only the database moves.

---

## Phase 1 — Host server readiness (Server 3)

### 1.1 Baseline audit checklist

Run on the **new DB server** before installing Docker:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== OS ==="
cat /etc/os-release | head -5
uname -a

echo "=== CPU / RAM ==="
nproc
free -h

echo "=== Disk (root + data mount if any) ==="
df -hT /
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL

echo "=== IOPS smoke test (optional, on data path) ==="
TEST_DIR="${TEST_DIR:-/tmp/pg-iops-test}"
mkdir -p "$TEST_DIR"
fio --name=randwrite --directory="$TEST_DIR" --size=256M --bs=8k \
  --rw=randwrite --iodepth=32 --numjobs=1 --time_based --runtime=30 \
  --group_reporting 2>/dev/null || echo "Install fio: sudo apt install -y fio"

echo "=== Network ==="
ip -br addr
ip route
ping -c 2 172.28.92.57   # Server 2 private IP

echo "=== Time sync ==="
timedatectl status

echo "=== Port conflicts ==="
sudo ss -tuln | grep -E ':5432|:5436' || true
docker ps -a 2>/dev/null || echo "Docker not installed yet"
```

**Production sizing (guidance):**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 vCPU | 4+ vCPU |
| RAM | 4 GB | 8–16 GB |
| Disk | 50 GB free + 2× current DB size | SSD/NVMe data volume, 20%+ headroom |
| OS | Ubuntu 22.04 / 24.04 LTS | Same VPC as Server 2 |

Record current database size on Server 2 **before** cutover:

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "SELECT pg_size_pretty(pg_database_size('jps_db'));"
```

Adjust `jps_user` / `jps_db` if your `Backend/.env` differs.

### 1.2 Install Docker Engine and Compose

Use the same block as [ALICLOUD-DEPLOYMENT-GUIDE §3](./ALICLOUD-DEPLOYMENT-GUIDE.md):

```bash
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git nano
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker "$USER"
newgrp docker
docker --version && docker compose version
```

Clone the repo to `/opt/jetty-planning-system` (same as other servers).

### 1.3 Storage layout for PostgreSQL

Put Postgres data on a **dedicated fast disk**, not a small root volume.

```bash
# Example: attach Alicloud data disk, format once, mount
sudo mkfs.ext4 -F /dev/vdb          # ONLY on an empty disk
sudo mkdir -p /data/jps-postgres
echo '/dev/vdb /data/jps-postgres ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir -p /data/jps-postgres/docker-volumes/jps_pgdata
sudo chown -R 999:999 /data/jps-postgres/docker-volumes/jps_pgdata
```

In Compose, bind the named volume to that path (see Phase 2). See also [ECS-DISK-SPACE-CHECK-AND-EXPAND.md](./ECS-DISK-SPACE-CHECK-AND-EXPAND.md) if the disk fills later.

---

## Phase 2 — Docker and environment configuration

Today, `docker-compose.backend.yml` on Server 2 runs **`jps-api`** and **`jps-db`** together; the API uses Docker DNS `jps-db:5432`.

After the split you maintain **two compose files**:

| File | Host | Services |
|------|------|----------|
| `docker-compose.backend.yml` | Server 2 | `jps-api` only |
| `Backend/infra/docker-compose.db.yml` (add to repo) | Server 3 | `jps-db` only |

### 2.1 Before — combined API + DB (Server 2)

Current pattern in `docker-compose.backend.yml`:

```yaml
services:
  jps-db:
    image: postgres:16-alpine
    volumes:
      - jps_pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5436:5432"   # admin via SSH tunnel only
  jps-api:
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@jps-db:5432/${POSTGRES_DB}
    depends_on:
      jps-db:
        condition: service_healthy
```

### 2.2 After — Server 3 (`docker-compose.db.yml`)

Suggested path: `Backend/infra/docker-compose.db.yml`. Run from repo root:

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml up -d
```

Example file:

```yaml
# Server 3 — PostgreSQL only
services:
  jps-db:
    image: postgres:16-alpine
    container_name: jps-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-jps_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ${POSTGRES_DB:-jps_db}
    volumes:
      - jps_pgdata:/var/lib/postgresql/data
      - ./infra/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./infra/postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - hba_file=/etc/postgresql/pg_hba.conf
    ports:
      - "${DB_BIND_IP:-172.28.92.60}:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-jps_user} -d ${POSTGRES_DB:-jps_db}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  jps_pgdata:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/jps-postgres/docker-volumes/jps_pgdata
```

Create config files under `Backend/infra/postgres/` (Phase 3).

### 2.3 After — Server 2 (API only)

Remove the `jps-db` service and `depends_on`. Point `DATABASE_URL` at Server 3:

```yaml
services:
  jps-api:
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-jps_user}:${POSTGRES_PASSWORD}@${DB_HOST:?Set DB_HOST}:${DB_PORT:-5432}/${POSTGRES_DB:-jps_db}
    # no depends_on jps-db

volumes:
  jps_uploads:
```

### 2.4 Environment variables

**Server 3** — `Backend/.env` (secrets only; do not commit):

```env
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<same strong password as production>
POSTGRES_DB=jps_db
DB_BIND_IP=172.28.92.60
```

**Server 2** — add remote DB variables; keep password unchanged during migration:

```env
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=<unchanged>
POSTGRES_DB=jps_db
JWT_SECRET=<unchanged>
CORS_ORIGIN=http://<APP_PUBLIC_IP>:3080

DB_HOST=172.28.92.60
DB_PORT=5432
```

Effective connection string:

`postgresql://jps_user:<password>@172.28.92.60:5432/jps_db`

URL-encode special characters in the password (`@`, `#`, `%`, etc.) if they appear in `DATABASE_URL`.

**Pre-cutover test from Server 2** (while API still uses local `jps-db`):

```bash
docker run --rm postgres:16-alpine pg_isready -h 172.28.92.60 -p 5432 -U jps_user -d jps_db
```

---

## Phase 3 — Security and networking

### 3.1 Security groups (Alibaba Cloud)

**Server 3 — inbound:**

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Admin VPN / office | SSH |
| 5432 | TCP | **Server 2 private IP only** (`172.28.92.57/32`) | API → PostgreSQL |

Do **not** open 5432 to `0.0.0.0/0`.

**Server 2 — after migration:** keep **5432 closed** on the security group; stop local `jps-db` when stable.

**Server 1:** unchanged (users → `:3080`; outbound to Server 2 `:3000`).

### 3.2 UFW on Server 3 (if enabled)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_IP> to any port 22 proto tcp
sudo ufw allow from 172.28.92.57 to any port 5432 proto tcp
sudo ufw enable
sudo ufw status verbose
```

### 3.3 `postgresql.conf`

`Backend/infra/postgres/postgresql.conf`:

```ini
listen_addresses = '*'
port = 5432
max_connections = 100
# Example tuning for 8 GB RAM (adjust after measuring):
# shared_buffers = 2GB
# effective_cache_size = 6GB
# maintenance_work_mem = 512MB
ssl = off
```

Exposure is limited by **bind IP**, security group, and `pg_hba.conf` — not by listening on `*` inside the container alone.

### 3.4 `pg_hba.conf`

`Backend/infra/postgres/pg_hba.conf`:

```text
# TYPE  DATABASE  USER      ADDRESS                 METHOD
local   all       all                               trust
host    all       all       127.0.0.1/32            scram-sha-256
host    jps_db    jps_user  172.28.92.57/32         scram-sha-256
```

Reload:

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d jps_db -c "SELECT pg_reload_conf();"
```

### 3.5 Connectivity test from Server 2

```bash
cd /opt/jetty-planning-system
docker run --rm postgres:16-alpine \
  psql "postgresql://jps_user:<PASSWORD>@172.28.92.60:5432/jps_db" -c "SELECT 1 AS ok;"
```

---

## Phase 4 — Database migration and cutover

**Operator runbook:** [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md) contains the full maintenance-window checklist (prerequisites, numbered steps, smoke tests, rollback). The sections below are a summary; use the runbook on the day of cutover.

### 4.1 Pre-migration (days before — no downtime)

| Step | Action |
|------|--------|
| 1 | Provision Server 3; complete Phase 1 |
| 2 | Deploy empty `jps-db` on Server 3; verify `pg_isready` |
| 3 | Open SG: Server 2 → Server 3 TCP 5432 only |
| 4 | Optional: practice `pg_dump` + restore; compare row counts |
| 5 | **Do not** delete Server 2 volume `jps_pgdata` until stable 48–72h |

### 4.2 Cutover timeline

JPS has no built-in maintenance mode. Quiesce writes by stopping the API and optionally blocking users at nginx.

| Time | Step | Notes |
|------|------|-------|
| T0 | Announce window | Optional 503 on Server 1 nginx |
| T+2m | Stop API | `docker compose ... stop jps-api` on Server 2 |
| T+3m | Confirm low activity | Optional `pg_stat_activity` check on local `jps-db` |
| T+5m | Consistent dump | §4.3 |
| T+15m | Restore on Server 3 | §4.3 |
| T+25m | Verify counts / `schema_migrations` | §4.4 |
| T+30m | Start API with `DB_HOST` remote | §4.5 |
| T+35m | Smoke test via app URL | Login, list operations |
| T+60m | If stable, stop local `jps-db` | Keep volume for rollback |

### 4.3 `pg_dump` and `pg_restore`

**On Server 2** — custom format dump:

```bash
cd /opt/jetty-planning-system
# Load credentials (or export POSTGRES_* manually)
set -a && source Backend/.env && set +a

STAMP=$(date +%Y%m%d_%H%M%S)
DUMP=/opt/jetty-planning-system/backups/jps_db_${STAMP}.dump
mkdir -p backups

docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner --no-acl \
  > "${DUMP}"

ls -lh "${DUMP}"
```

Copy to Server 3 if needed:

```bash
scp "${DUMP}" user@172.28.92.60:/opt/jetty-planning-system/backups/
```

**On Server 3** — restore into empty database (first cutover only):

```bash
cd /opt/jetty-planning-system

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d postgres -c "DROP DATABASE IF EXISTS jps_db WITH (FORCE);"
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d postgres -c "CREATE DATABASE jps_db OWNER jps_user;"

docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  pg_restore -U jps_user -d jps_db --no-owner --no-acl --verbose \
  < /opt/jetty-planning-system/backups/jps_db_${STAMP}.dump
```

`pg_restore` may emit warnings on re-run; on a fresh database it should be clean.

### 4.4 Verification on Server 3

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  psql -U jps_user -d jps_db <<'SQL'
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS operations FROM operations;
SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
SELECT pg_size_pretty(pg_database_size('jps_db'));
SQL
```

Compare to counts captured on Server 2 **before** stopping `jps-api`.

### 4.5 Switch API to remote database

1. Deploy API-only `docker-compose.backend.yml` and `DB_HOST` in `Backend/.env`.
2. Start API:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d jps-api
docker compose --env-file Backend/.env -f docker-compose.backend.yml logs -f jps-api
```

3. Run migrations (usually no-op if dump included `schema_migrations`):

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
```

4. Re-enable app traffic on Server 1.

**Uploads:** Synology NAS bind on Server 2 (`UPLOAD_HOST_PATH`); see [SYNOLOGY-INTEGRATION.md](../Plan/SYNOLOGY-INTEGRATION.md). See [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md) if files are missing after container changes.

---

## Phase 5 — Rollback strategy

**Goal:** Point `jps-api` back to local `jps-db` on Server 2 within minutes if the remote database fails.

### 5.1 Before cutover

- Do **not** run `docker compose down -v` on Server 2.
- Do **not** delete volume `jps_pgdata` on Server 2 until 48–72h stable.
- Keep `backups/jps_db_<STAMP>.dump` and a copy of the old compose + `.env` (`@jps-db:5432`).

### 5.2 Fast rollback

| Step | Action |
|------|--------|
| 1 | `docker compose --env-file Backend/.env -f docker-compose.backend.yml stop jps-api` |
| 2 | Revert `Backend/.env`: remove `DB_HOST`; restore `DATABASE_URL` → `@jps-db:5432` |
| 3 | Restore combined compose ( `jps-db` + `depends_on` ) |
| 4 | `docker compose ... up -d jps-db` — wait healthy |
| 5 | `docker compose ... up -d jps-api` |
| 6 | Smoke test login / API |
| 7 | Optional: remove Server 3 SG rule from Server 2 |

Target: **under 5 minutes** if the old volume was preserved.

### 5.3 Rollback after writes on Server 3

If the API wrote to Server 3 before failure:

1. Emergency dump from Server 3 before reverting API:

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  pg_dump -U jps_user -d jps_db -Fc > /opt/jetty-planning-system/backups/emergency_server3.dump
```

2. Roll back API to local DB (§5.2). Users see data as of the last Server 2 dump unless you merge manually.

### 5.4 Decision matrix

| Symptom | Action |
|---------|--------|
| Connection refused / timeout to Server 3 | Fix SG, UFW, `pg_hba`, `DB_BIND_IP`; or rollback |
| Password authentication failed | Fix password / `pg_hba` for Server 2 IP |
| 500s / migration errors | Inspect `schema_migrations` and restore logs |
| Wrong row counts after restore | Rollback to local DB; re-run dump with API stopped |

---

## Post-migration

| Task | Detail |
|------|--------|
| Backups | Nightly `pg_dump` cron on Server 3; copy off-host |
| Monitoring | `pg_isready`, disk free on `/data/jps-postgres` |
| DBA access | SSH tunnel to `127.0.0.1:5436` on Server 3 (loopback bind) — do not open 5432 to the internet |
| Docs | Update security group diagrams in [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) when cutover is complete |

### Repo artifacts (in git)

| File | Purpose |
|------|---------|
| `Backend/infra/docker-compose.db.yml` | Postgres on Server 3 |
| `Backend/infra/docker-compose.backend-api-only.yml` | API on Server 2 after cutover |
| `docker-compose.backend-api-only.yml` | Root entrypoint (same as infra) |
| `Backend/infra/postgres/postgresql.conf`, `pg_hba.conf` | Remote access + low-RAM tuning |
| `Docs/Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md` | Maintenance-window steps |

---

## Security group summary (three servers)

| Port (TCP) | Server | Purpose | Source |
|------------|--------|---------|--------|
| 22 | App, API, DB | SSH | Admin IP only |
| 3080 | App | JPS UI + proxied `/api/` | Users (or restricted) |
| 3000 | API | Node API | App private IP only |
| 5432 | DB | PostgreSQL | **API private IP only** |

**Outbound:** App → API `:3000` over VPC. API → DB `:5432` over VPC.

---

## Related commands quick reference

```bash
# Server 2 — current stack status
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps

# Server 3 — DB health
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml exec -T jps-db \
  pg_isready -U jps_user -d jps_db
```
