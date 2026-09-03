# ApsaraDB RDS — local developer access (JPS staging)

Connect from your workstation to the IT-provisioned JPS database on ApsaraDB RDS.

**Do not commit credentials to git.** Store connection details in a password manager or local `Backend/.env` (gitignored).

---

## Connection details

| Setting | Value |
|---------|-------|
| Host | `pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com` |
| Port | `5432` |
| Database | `jps_db` |
| User | `postgres` |
| Region | `ap-southeast-5` (Jakarta) |

IT must whitelist your **office/VPN public IP** on the RDS security group (port 5432).

---

## psql (Docker — recommended)

```powershell
docker run --rm -it -e PGPASSWORD='<password>' postgres:18 `
  psql -h pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com `
  -p 5432 -U postgres -d jps_db
```

Readiness check:

```powershell
docker run --rm -e PGPASSWORD='<password>' postgres:18 `
  pg_isready -h pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com `
  -p 5432 -U postgres -d jps_db
```

---

## pgAdmin

1. Register → Server → Connection  
2. Host: endpoint above, Port: `5432`, Database: `jps_db`, Username: `postgres`  
3. If password contains `#`, enter it in the pgAdmin password field (not in a URL).

---

## Local JPS API against RDS (rehearsal)

[Backend/docker-compose.yml](../Backend/docker-compose.yml) hardcodes `DATABASE_URL` to `jps-db:5432`. To test the API against RDS without changing compose:

```powershell
$RDS_URL = "postgresql://postgres:Postgres%23123@pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com:5432/jps_db"
cd Backend
docker compose run --rm --no-deps -e DATABASE_URL=$RDS_URL jps-api npm run migrate
docker stop jps-api; docker rm jps-api
docker compose run -d --no-deps --name jps-api --service-ports -e DATABASE_URL=$RDS_URL jps-api npm run start
```

**Rollback to local Docker DB:**

```powershell
cd "d:\Cursor\Jetty Planning System"
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --no-deps --force-recreate jps-api
```

Verify:

```powershell
docker inspect jps-api --format "{{range .Config.Env}}{{println .}}{{end}}" | findstr DATABASE_URL
curl.exe -s http://localhost:3000/health
```

---

## Password `#` in connection URLs

In a PostgreSQL URL, `#` starts the fragment and breaks the password. Encode as **`%23`** in `DATABASE_URL`, or use `PGPASSWORD` with `psql`/`pg_dump` instead of embedding in the URL.

---

## Dump / restore (local rehearsal)

See [PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx](./PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx) and staging script [Backend/scripts/apsaradb-staging-cutover.sh](../../Backend/scripts/apsaradb-staging-cutover.sh).

Local dump (avoid binary redirect on Windows — use container path + `docker cp`):

```powershell
docker exec jps-db pg_dump -U jps_user -d jps_db -Fc --no-owner --no-privileges -f /tmp/local-to-rds.dump
docker cp jps-db:/tmp/local-to-rds.dump Backend/backups/local-to-rds.dump
```

---

## Notes from local rehearsal (2026-09-03)

- Local PG **16** → RDS PG **18.4**: restore succeeded; row counts matched (65 tables, 29 users, 67 operations, 112 migrations, 1.5M tank_gauging_samples).
- RDS default timezone was **UTC** (not `Asia/Jakarta`) — ask IT to set parameter group before production cutover.
- Restore of ~155 MB dump over WAN took ~50 minutes (large `tank_gauging_samples` table).

---

## Related

- [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md)
- [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md)
