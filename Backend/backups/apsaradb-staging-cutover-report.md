# Staging cutover report — DB ECS .60 → ApsaraDB RDS (2026-09-03)

## Environment

| Role | IP / endpoint |
|------|----------------|
| API | `172.28.92.57` (`iZk1a4m0oobaw170notm7pZ`) |
| Source DB | `172.28.92.60` (PostgreSQL 16.14) |
| Target RDS | `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com` (PostgreSQL 18.4) |
| App | `172.28.92.56` (unchanged) |

## Pre-cutover baseline (source .60)

| Metric | Value |
|--------|-------|
| DB size | 2126 MB |
| users | 20 |
| operations | 78 |
| schema_migrations | 113 |

## Restore result

| Metric | RDS after restore |
|--------|-------------------|
| users | 20 |
| operations | 78 |
| schema_migrations | 113 |

Row counts **matched**.

### pg_restore warnings

- `notifications_user_id_fkey` failed to create: `user_id=25` not in `users` (2 errors ignored).
- Investigate orphan notifications on source if constraint needed:

```sql
SELECT COUNT(*) FROM notifications n
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id);
```

## API cutover issue (resolved)

`POSTGRES_PASSWORD` containing `#` produced invalid `DATABASE_URL` → `Migration failed: Invalid URL`.

**Fix:** start API with explicit encoded URL:

```bash
export DATABASE_URL='postgresql://postgres:Postgres%23123@pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com:5432/jps_db'
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml run -d \
  --no-deps --name jps-api --service-ports \
  -e DATABASE_URL="$DATABASE_URL" \
  jps-api npm run start
```

Result: `Database connection OK`.

## RDS notes

- TimeZone on RDS was **UTC** at cutover — request IT set **Asia/Jakarta** in parameter group.
- IT must whitelist **172.28.92.57/32** on RDS (confirmed working during preflight).

## Rollback

Keep DB ECS `.60` running until soak completes. Restore `Backend/.env.bak.apsaradb.*` and point `DB_HOST` back to `172.28.92.60`.

See [APSARADB-STAGING-CUTOVER.md](../../Docs/Guide/APSARADB-STAGING-CUTOVER.md).
