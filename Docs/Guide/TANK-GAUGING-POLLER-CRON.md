# Tank gauging poller + sample purge (Linux cron)

Always-on ATG history for Log/reconcile and cargo-ops window rates. The Node scripts run **once per invocation**; **schedule is cron**, not in-app timers.

| Job | Script | Cadence | Writes |
|-----|--------|---------|--------|
| Poll | `Backend/scripts/run-tank-gauging-poll.sh` | Every **15 minutes** | `tank_gauging_latest`, `tank_gauging_samples` |
| Purge | `Backend/scripts/purge-tank-gauging-samples.sh` | Daily (e.g. 02:20) | Archives / deletes old samples; audit in `tank_gauging_purge_log` |

`tank_gauging_latest` is **never** archived or purged.

## Prerequisites

1. Migrations applied through `104_tank_gauging_sources.sql` (`npm run migrate` in `Backend`).
2. ATG sources configured per port (preferred): **Tank Farm → Configuration** (requires tank-farm edit permission), or legacy env fallback below.
3. Host can reach ATG VLAN (configured source base URLs).
4. `Backend/.env` has at least:

```env
DATABASE_URL=...
NOTIFICATION_ENCRYPTION_KEY=...   # or JWT_SECRET — encrypts ATG credentials in DB
# Legacy env fallback (only when tank_gauging_sources is empty):
# TANK_GAUGING_PORT_ID=1
# TANK_GAUGING_BASE_URLS=http://172.16.11.77,http://172.16.246.10
TANK_GAUGING_PARAMIDLIST=622|625|628|717|724|730
# optional retention overrides (defaults shown)
TANK_GAUGING_SAMPLE_ACTIVE_DAYS=30
TANK_GAUGING_SAMPLE_ARCHIVE_DAYS=7
```

### DB-backed source configuration (migration 104+)

- Table `tank_gauging_sources` stores per-port Tankvision hosts, auth (encrypted), enabled flag, and poll health (`last_poll_at`, `last_poll_ok`, `last_error`).
- Poller reads **all enabled sources** across ports (or `--portId=N` for one port). Env `TANK_GAUGING_*` URLs apply only when the table has **no rows**.
- UI: `/tank-farm` → select port → **Configuration** (visible when role has tank-farm **edit**).
- **Test connection** probes DATATYPE=23 only; scheduled ingest remains cron-driven.

### Staging rollout (after deploy)

1. Run migration 104 on staging DB (`npm run migrate` in `Backend`).
2. Deploy backend + frontend.
3. Admin → Roles: confirm ops roles have **Tank Farm edit**.
4. Tank Farm → Bontang → **Configuration**: verify seed sources (`.77`, `.10` enabled; `.11` disabled); add `.12` with Basic auth when ready.
5. Run manual poll (`./scripts/run-tank-gauging-poll.sh`); verify `/tank-farm` readings and cargo ops ATG.
6. Remove redundant `TANK_GAUGING_BASE_URLS` / credentials from `Backend/.env` once DB config is verified.

Adjust deploy path below (`/opt/jetty-planning-system/Backend`) to match the server.

## Retention model

1. **Active** — samples with `archived_at IS NULL` and `sampled_at` within the last `ACTIVE_DAYS` (default 30).
2. **Archive** — when `sampled_at` is older than `ACTIVE_DAYS`, purge sets `archived_at = NOW()` and logs `action='archive'`. Archived rows stay available for ATG rate lookups.
3. **Hard delete** — when `archived_at` is older than `ARCHIVE_DAYS` (default 7), row is `DELETE`d and logged as `action='delete'`.

## Install crontab

```bash
chmod +x /opt/jetty-planning-system/Backend/scripts/run-tank-gauging-poll.sh \
         /opt/jetty-planning-system/Backend/scripts/purge-tank-gauging-samples.sh

sudo mkdir -p /var/log
sudo touch /var/log/jps-tank-gauging-poll.log /var/log/jps-tank-gauging-purge.log
# ensure the cron user can append (e.g. chown to the deploy user)

crontab -e
```

Add:

```cron
# ATG poll — every 15 minutes (interval = cron only; script does one fetch)
*/15 * * * * cd /opt/jetty-planning-system/Backend && ./scripts/run-tank-gauging-poll.sh >> /var/log/jps-tank-gauging-poll.log 2>&1

# Staged sample purge — daily 02:20 server local time
20 2 * * * cd /opt/jetty-planning-system/Backend && ./scripts/purge-tank-gauging-samples.sh >> /var/log/jps-tank-gauging-purge.log 2>&1
```

Change poll cadence by editing crontab only, for example:

```cron
*/10 * * * *   # every 10 minutes
0 * * * *      # every hour
```

### Docker backend (host cron)

If Node runs inside the API container:

```cron
*/15 * * * * docker compose --env-file /opt/jetty-planning-system/Backend/.env -f /opt/jetty-planning-system/docker-compose.backend-api-only.yml exec -T jps-api node scripts/run-tank-gauging-poll.js >> /var/log/jps-tank-gauging-poll.log 2>&1

20 2 * * * docker compose --env-file /opt/jetty-planning-system/Backend/.env -f /opt/jetty-planning-system/docker-compose.backend-api-only.yml exec -T jps-api node scripts/purge-tank-gauging-samples.js >> /var/log/jps-tank-gauging-purge.log 2>&1
```

Use the compose file name that matches the host.

## Manual verification

```bash
cd /opt/jetty-planning-system/Backend

# One poll (JSON summary on stdout)
./scripts/run-tank-gauging-poll.sh

# Dry-run purge (counts only; no writes)
./scripts/purge-tank-gauging-samples.sh --dry-run

# Real purge
./scripts/purge-tank-gauging-samples.sh
```

SQL checks:

```sql
-- Recent samples
SELECT count(*) AS samples_24h
FROM tank_gauging_samples
WHERE sampled_at > NOW() - INTERVAL '24 hours';

SELECT tank_id, max(sampled_at) AS last_sample
FROM tank_gauging_samples
GROUP BY 1
ORDER BY 2 DESC;

-- Latest snapshot untouched by purge
SELECT count(*) FROM tank_gauging_latest;

-- Purge audit
SELECT * FROM tank_gauging_purge_log ORDER BY acted_at DESC LIMIT 100;

SELECT batch_id, action, count(*)
FROM tank_gauging_purge_log
GROUP BY 1, 2
ORDER BY min(acted_at) DESC;
```

Forced purge test (non-prod only):

```sql
-- Make one row eligible to archive
UPDATE tank_gauging_samples
SET sampled_at = NOW() - INTERVAL '40 days', archived_at = NULL
WHERE id = (
  SELECT id FROM tank_gauging_samples ORDER BY id DESC LIMIT 1
);
```

Then run purge once → expect `archived: 1` and a purge_log `archive` row. Set `archived_at` further back and run again to exercise delete.

## Windows (dev)

```bat
cd Backend
npm run run:tank-gauging-poll
npm run run:purge-tank-gauging-samples
npm run run:purge-tank-gauging-samples -- --dry-run
```

Or Task Scheduler calling `run-tank-gauging-poll.bat` / `purge-tank-gauging-samples.bat` with “Start in” = `Backend`.

## Ops notes

- Opening `/tank-farm` in the UI does **not** write samples; only the poller does.
- **Configuration** modal manages `tank_gauging_sources`; it does not run a full poll (use **Test** for connectivity only).
- Poller and purge each use a PostgreSQL advisory lock so overlapping cron ticks skip instead of double-running.
- Cron log lines are JSON summaries (`ok`, `batchId`, `archived`, `deleted`, …). Per-row detail is in `tank_gauging_purge_log`.
- Purging old purge_log rows (e.g. keep 90 days) is optional and not part of the daily job.
