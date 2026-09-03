# ApsaraDB RDS — staging cutover runbook

After **local rehearsal** passes ([Backend/backups/apsaradb-local-rehearsal-report.md](../../Backend/backups/apsaradb-local-rehearsal-report.md)), run this on **staging API server** (`172.28.92.57`).

**Target RDS (IT provisioned):**

| Setting | Value |
|---------|-------|
| Host | `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com` |
| Port | `5432` |
| Database | `jps_db` |
| User | `postgres` |

**Source:** DB ECS `172.28.92.60` (`jps-db` via `Backend/infra/docker-compose.db.yml`).

**App server (`172.28.92.56`):** no change.

---

## Prerequisites

- [ ] Local rehearsal report reviewed (dump/restore/counts OK)
- [ ] IT whitelisted **API ECS** `172.28.92.57/32` on RDS port **5432**
- [ ] RDS parameter `timezone = Asia/Jakarta` (local rehearsal showed **UTC** — fix before cutover)
- [ ] `Backend/scripts/apsaradb-staging-cutover.sh` on server (`git pull origin sit`)
- [ ] Maintenance window agreed; tank gauging cron disabled on API host during dump
- [ ] **Do not** stop DB ECS until soak completes (rollback)

---

## Automated script (recommended)

On API server:

```bash
cd /opt/jetty-planning-system
git pull origin sit
chmod +x Backend/scripts/apsaradb-staging-cutover.sh

export RDS_HOST='pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com'
export RDS_PW='<from password manager>'
export SRC_HOST='172.28.92.60'
export SRC_PW='<jps_user password from Backend/.env>'

./Backend/scripts/apsaradb-staging-cutover.sh preflight
./Backend/scripts/apsaradb-staging-cutover.sh dump-restore
./Backend/scripts/apsaradb-staging-cutover.sh cutover-api
```

Smoke test: login via staging app URL, list operations/SI.

**Documentation index:** [APSARADB-DOCUMENTATION-INDEX.md](./APSARADB-DOCUMENTATION-INDEX.md)

**Rollback:**

```bash
./Backend/scripts/apsaradb-staging-cutover.sh rollback
```

---

## Staging cutover record (2026-09-03)

Completed cutover baseline and outcome: [Backend/backups/apsaradb-staging-cutover-report.md](../../Backend/backups/apsaradb-staging-cutover-report.md).

| Metric | Source `.60` | RDS after restore |
|--------|--------------|-------------------|
| DB size | 2126 MB | — |
| users | 20 | 20 |
| operations | 78 | 78 |
| schema_migrations | 113 | 113 |

---

## Post-cutover verification checklist

- [ ] `docker inspect jps-api` shows `DATABASE_URL` with **encoded** password (`%23` not raw `#`)
- [ ] API logs: `Database connection OK` (no `Invalid URL` on migrate)
- [ ] `npm run migrate` exit 0 (no pending migrations)
- [ ] Login via staging app (`172.28.92.56`)
- [ ] List operations, open one SI, allocation overview loads
- [ ] Tank gauging cron re-enabled on API host (if disabled for cutover)
- [ ] DB ECS `.60` still running (rollback available)
- [ ] RDS TimeZone = `Asia/Jakarta` (request IT if still UTC)

---

## Lessons learned (live cutover)

### 1. `#` in RDS password breaks `DATABASE_URL`

`docker-compose.backend-api-only.yml` builds:

```yaml
DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_HOST}:...
```

If `POSTGRES_PASSWORD` contains `#` (e.g. `Postgres#123`), Node treats everything after `#` as a URL fragment → **`Migration failed: Invalid URL`**.

**Workarounds (pick one):**

1. **Override at container start** (recommended until compose is fixed):

```bash
export DATABASE_URL='postgresql://postgres:Postgres%23123@pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com:5432/jps_db'
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml stop jps-api || true
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml rm -f jps-api || true
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml run -d \
  --no-deps --name jps-api --service-ports \
  -e DATABASE_URL="$DATABASE_URL" \
  jps-api npm run start
```

2. Store URL-encoded password in `.env`: `POSTGRES_PASSWORD=Postgres%23123` (only if all tooling accepts it).

3. Ask IT for an RDS password **without** URL-reserved characters.

**Do not** run `docker compose up --force-recreate jps-api` without the `DATABASE_URL` override after cutover — it will rebuild a broken URL.

See also [APSARADB-LOCAL-ACCESS.md](./APSARADB-LOCAL-ACCESS.md).

### 2. `pg_restore` FK error on `notifications`

During parallel restore (`-j 4`), `pg_restore` may report:

```
ERROR: insert or update on table "notifications" violates foreign key constraint "notifications_user_id_fkey"
DETAIL: Key (user_id)=(25) is not present in table "users".
```

Row counts still matched (20 users, 78 ops). Likely **orphan notification rows** on source or ordering under parallel restore.

**Check on source or RDS:**

```sql
SELECT n.id, n.user_id FROM notifications n
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id);
```

**Mitigation options:** delete orphans before dump, or restore with `-j 1` if FK errors persist. Non-blocking if notifications are disposable on staging.

---

## Post-cutover (after 1+ business day soak)

On DB ECS `172.28.92.60`:

```bash
docker compose --env-file Backend/.env -f Backend/infra/docker-compose.db.yml stop jps-db
# Keep /data/jps-postgres/ ~30 days before releasing ECS
```

Remove DB ECS SG rule `5432 ← API` only after soak. Staging layout becomes **App + API + ApsaraDB RDS** (two ECS + managed DB).

---

## Production (later)

Repeat with **separate** RDS instance — never share staging RDS.

| Role | Production IP |
|------|---------------|
| App | `172.28.80.50` |
| API | `172.28.80.51` |
| DB ECS (source) | `172.28.92.59` |

Use HA RDS edition if required. See [PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md](./PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md).

---

## Related

- [APSARADB-DOCUMENTATION-INDEX.md](./APSARADB-DOCUMENTATION-INDEX.md)
- [APSARADB-LOCAL-ACCESS.md](./APSARADB-LOCAL-ACCESS.md)
- [PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx](./PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx)
- [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md)
