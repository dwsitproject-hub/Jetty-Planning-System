# Local → ApsaraDB RDS rehearsal verification (2026-09-03)

## Source
- Local Docker `jps-db` (PostgreSQL 16.13)
- Database size: 1353 MB
- Port: 127.0.0.1:5436 → container 5432

## Target
- `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com`
- PostgreSQL 18.4
- TimeZone: UTC (confirm Asia/Jakarta with IT before staging cutover)

## Dump
- File: `Backend/backups/local-to-rds.dump`
- Size: ~155 MB (custom format `-Fc`)
- TABLE DATA entries: 65

## Restore
- Exit code: 0
- Duration: ~51 minutes (large `tank_gauging_samples` over WAN)
- ANALYZE: completed

## Row count comparison

| Object | Local | RDS | Match |
|--------|-------|-----|-------|
| tables (public) | 65 | 65 | yes |
| users | 29 | 29 | yes |
| operations | 67 | 67 | yes |
| schema_migrations | 112 | 112 | yes |
| tank_gauging_samples | 1538940 | 1538940 | yes |
| indexes (public) | 171 | 171 | yes |
| assign_jetty_operation_code() | yes | yes | yes |

## API smoke test (RDS)
- Health: OK
- Migrations: 0 new (already in dump)
- Login: admin / admin123 → `/users/me` OK

## Rollback drill
- `docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --no-deps --force-recreate jps-api`
- DATABASE_URL → `jps-db:5432` restored
- Login: OK

## Staging next steps
Run on API server `172.28.92.57`:
```bash
export RDS_HOST='pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com'
export RDS_PW='...'
export SRC_PW='...'
chmod +x Backend/scripts/apsaradb-staging-cutover.sh
./Backend/scripts/apsaradb-staging-cutover.sh preflight
./Backend/scripts/apsaradb-staging-cutover.sh dump-restore
./Backend/scripts/apsaradb-staging-cutover.sh cutover-api
```

Ensure IT whitelists `172.28.92.57/32` on RDS.
