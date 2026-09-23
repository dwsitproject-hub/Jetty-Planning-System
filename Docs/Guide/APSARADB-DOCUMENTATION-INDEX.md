# Staging DB (.60) → ApsaraDB — documentation index

Map of all JPS documentation for migrating staging PostgreSQL from **DB ECS `172.28.92.60`** to **ApsaraDB RDS**.

---

## Start here (ApsaraDB-specific)

| Priority | Document | Purpose |
|----------|----------|---------|
| **1** | [APSARADB-STAGING-CUTOVER.md](./APSARADB-STAGING-CUTOVER.md) | **Main staging cutover runbook** — preflight, dump/restore, cutover, rollback, lessons learned |
| **2** | [PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx](./PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx) | Generic dump/restore bible (KLIP) — traps, verification, timezone, ANALYZE |
| **3** | [APSARADB-LOCAL-ACCESS.md](./APSARADB-LOCAL-ACCESS.md) | PC → RDS access; local API on RDS; password `#` encoding |
| **4** | [Backend/scripts/apsaradb-staging-cutover.sh](../../Backend/scripts/apsaradb-staging-cutover.sh) | Automated `preflight`, `dump-restore`, `cutover-api`, `rollback` |
| **5** | [Backend/backups/apsaradb-local-rehearsal-report.md](../../Backend/backups/apsaradb-local-rehearsal-report.md) | Local rehearsal verification (PG16→PG18) |
| **6** | [Backend/backups/apsaradb-staging-cutover-report.md](../../Backend/backups/apsaradb-staging-cutover-report.md) | Staging cutover record (2026-09-03) |

**Entry point:** [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) **§9**.

**Architecture:** [technical-architecture.md](../technical-architecture.md) §0.6 (optional RDS replacing Server 3).

---

## Related (three-server ECS — source `.60`, not RDS)

| Document | Relevance |
|----------|-----------|
| [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) | Staging topology: App `.56`, API `.57`, DB `.60` |
| [THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md) | Split API vs DB; practice migration to `.60` |
| [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md) | ECS-to-ECS cutover pattern (same dump/restore style) |
| [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) | Alicloud ECS baseline |
| [Backend/infra/docker-compose.db.yml](../../Backend/infra/docker-compose.db.yml) | DB ECS `.60` compose |
| [docker-compose.backend-api-only.yml](../../docker-compose.backend-api-only.yml) | API `.57` → remote DB (`DB_HOST`) |

---

## DB access / other staging DB ops

| Document | Purpose |
|----------|---------|
| [PGADMIN-STAGING-DB-TUNNEL-WINDOWS.md](./PGADMIN-STAGING-DB-TUNNEL-WINDOWS.md) | SSH tunnel to staging Postgres (verify live layout vs doc) |
| [PROD-TO-STAGING-NON-USER-DATA-COPY.md](./PROD-TO-STAGING-NON-USER-DATA-COPY.md) | Refresh staging `.60` from prod `.59` (separate from RDS) |

---

## Staging server mapping

| Role | IP | Notes |
|------|-----|-------|
| App | `172.28.92.56` | Unchanged at RDS cutover |
| API | `172.28.92.57` | `iZk1a4m0oobaw170notm7pZ` — run cutover here |
| DB ECS (rollback) | `172.28.92.60` | Dump source; keep during soak |
| ApsaraDB RDS | `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com` | Target (`jps_db`, user `postgres`) |

---

## Recommended reading order

1. Skim **Word runbook** (traps, ANALYZE, verification).
2. Read **APSARADB-STAGING-CUTOVER.md**.
3. Run **apsaradb-staging-cutover.sh** on API `.57` (or manual commands in runbook).
4. Keep **THREE-SERVER-DB-CUTOVER-RUNBOOK.md** in mind for rollback (leave `.60` running during soak).

---

## Server-only artifacts (not in git)

After cutover, on API host:

- `/opt/jetty-planning-system/backups/apsaradb_<STAMP>/cutover.dump`
- `/opt/jetty-planning-system/backups/apsaradb_<STAMP>/restore.log`
- `Backend/.env.bak.apsaradb.<STAMP>`
