# Synology Integration Quick Guide (JPS)

This guide covers how to integrate JPS file uploads with the Synology NAS, migrate existing files, and copy data from staging to production.

For full details see [SYNOLOGY-INTEGRATION.md](../Plan/SYNOLOGY-INTEGRATION.md).

---

## How It Works

No Synology API or SDK is used. The app writes files to `/var/jps/uploads` inside the Docker container. Docker bind-mounts that path to the Synology NAS share mounted on the host.

```
App upload → jps-api container (/var/jps/uploads)
                    ↕  Docker bind mount
             Host: /mnt/synology/[env]/JETTYPLANNING
                    ↕  SMB mount (done by IT)
             Synology NAS (172.30.1.94)
```

PostgreSQL stores only metadata (`stored_path`). The files live on the NAS.

---

## Prerequisites — IT Must Do First

Ask IT to mount the Synology share on the API server before you start.

| Environment | NAS share (File Station) | Host mount path on API server |
|---|---|---|
| Staging | `172.30.1.94/APPs/dev/JETTYPLANNING` | `/mnt/synology/dev/JETTYPLANNING` |
| Production | `172.30.1.94/APPs/JETTYPLANNING` | `/mnt/synology/JETTYPLANNING` |

Verify IT has mounted it correctly:

```bash
mount | grep synology
touch /mnt/synology/[env]/JETTYPLANNING/.write-test && echo "Writable OK"
```

---

## One-Time Setup Per Server

### Step 1 — Fix the Compose File

The repo default has the volume hardcoded. This must be fixed manually on every server.

```bash
nano /opt/jetty-planning-system/docker-compose.backend-api-only.yml
```

Find the volumes section and change:

```yaml
# FROM (hardcoded — wrong):
- jps_uploads:/var/jps/uploads

# TO (correct):
- ${UPLOAD_HOST_PATH:-jps_uploads}:/var/jps/uploads
```

### Step 2 — Set `UPLOAD_HOST_PATH` in `Backend/.env`

```bash
nano /opt/jetty-planning-system/Backend/.env
```

Add the correct line for your environment:

```env
# Staging:
UPLOAD_HOST_PATH=/mnt/synology/dev/JETTYPLANNING

# Production:
UPLOAD_HOST_PATH=/mnt/synology/JETTYPLANNING
```

> **Important:** If any password in `.env` contains special characters (`<`, `>`, `!`, `&`, etc.), wrap the value in double quotes:
> ```env
> POSTGRES_PASSWORD="your<password"
> ```
> Without quotes, bash treats `<` as a shell redirection operator when sourcing the file, silently corrupting the variable.

### Step 3 — Source Env and Recreate the Container

Docker Compose v5 `--env-file` does **not** interpolate `UPLOAD_HOST_PATH` into the volumes section. You must source the env file into the shell first.

```bash
cd /opt/jetty-planning-system
set -a && source Backend/.env && set +a
docker compose -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
```

### Step 4 — Verify the Bind Mount Is Active

```bash
docker inspect jps-api | grep -A 5 '"Mounts"'
```

Must show:

```json
"Type": "bind",
"Source": "/mnt/synology/[env]/JETTYPLANNING"
```

If it shows `"Type": "volume"`, the bind mount is not active — recheck steps 1–3.

### Step 5 — Verify the Upload Directory Is Writable

```bash
docker logs jps-api 2>&1 | grep "Upload directory"
```

Expected:

```
Upload directory: /var/jps/uploads (writable)
```

---

## Migrate Existing Files to NAS

Use this if files are currently stuck inside the container or Docker named volume.

```bash
# 1. Rescue files from container to host disk
mkdir -p /opt/jetty-planning-system/uploads-backup
docker cp jps-api:/var/jps/uploads/. /opt/jetty-planning-system/uploads-backup/
find /opt/jetty-planning-system/uploads-backup -type f | wc -l   # note the count

# 2. Stop the API
docker compose -f docker-compose.backend-api-only.yml stop jps-api

# 3. Copy files to NAS
cp -a /opt/jetty-planning-system/uploads-backup/. /mnt/synology/[env]/JETTYPLANNING/
find /mnt/synology/[env]/JETTYPLANNING -type f | wc -l   # must match step 1 count

# 4. Set UPLOAD_HOST_PATH and recreate (steps 2–5 above)
```

Keep the `uploads-backup` folder for 1–2 weeks before removing.

---

## Staging → Production Data Migration

### DB Dump and Restore

```bash
# 1. On staging DB server — dump WITHOUT -t flag (TTY corrupts binary files)
docker exec jps-db pg_dump -U jps_user -d jps_db -Fc > /opt/jetty-planning-system/jps_db_staging.dump
ls -lh /opt/jetty-planning-system/jps_db_staging.dump

# 2. Copy dump to production DB server
scp /opt/jetty-planning-system/jps_db_staging.dump root@<PROD_DB_IP>:/opt/jetty-planning-system/

# 3. On production DB server — drop and recreate target DB
docker exec jps-db psql -U jps_user -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='jps_db';
  DROP DATABASE IF EXISTS jps_db;
  CREATE DATABASE jps_db;"

# 4. Copy dump into container and restore (avoid -it flag with binary files)
docker cp /opt/jetty-planning-system/jps_db_staging.dump jps-db:/tmp/jps_db_staging.dump
docker exec jps-db pg_restore -U jps_user -d jps_db --clean --if-exists /tmp/jps_db_staging.dump

# 5. Spot check
docker exec jps-db psql -U jps_user -d jps_db -c "SELECT COUNT(*) FROM users;"
docker exec jps-db psql -U jps_user -d jps_db -c "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 5;"
```

### Copy Files: Staging NAS → Production NAS

If both NAS paths are on the same server (rsync locally):

```bash
rsync -a /mnt/synology/dev/JETTYPLANNING/ /mnt/synology/JETTYPLANNING/
```

If on different servers (run from production, pulling from staging):

```bash
rsync -a root@<STAGING_API_IP>:/mnt/synology/dev/JETTYPLANNING/ /mnt/synology/JETTYPLANNING/
```

Verify:

```bash
find /mnt/synology/JETTYPLANNING -type f | wc -l   # must match staging count
```

---

## Quick Verification After Any Deploy

```bash
# Bind mount is active
docker inspect jps-api | grep -A 5 '"Mounts"'

# API started correctly
docker logs jps-api 2>&1 | grep "Upload directory"

# File count on NAS
find /mnt/synology/[env]/JETTYPLANNING -type f | wc -l
```

---

## Common Gotchas

| Problem | Cause | Fix |
|---|---|---|
| Files go to Docker volume, not NAS | Compose file has hardcoded `jps_uploads` | Fix compose file volume line (Step 1) |
| `UPLOAD_HOST_PATH` ignored by compose | Docker Compose v5 `--env-file` does not interpolate volumes | Use `set -a && source Backend/.env && set +a` before compose |
| Password auth fails after sourcing `.env` | Password contains `<` — shell treats it as input redirection | Quote the password in `.env`: `POSTGRES_PASSWORD="val<ue"` |
| Truncated password in `DATABASE_URL` | `cut -d= -f2` stops at `=` in password | Use `cut -d= -f2-` or quote value in `.env` |
| `pg_dump` produces corrupt/unreadable file | Used `docker exec -t` — TTY injects `\r` into binary output | Use `docker exec` without `-t` flag |
| `pg_restore` fails with "end of file" | Used `docker exec -it` with stdin redirect, or `-t` flag | Copy file into container with `docker cp` first, then restore |
| DB password auth fails on production | Password reset was done with truncated value | Use `ALTER USER jps_user WITH PASSWORD '...'` with full password |

---

## Related Files

| File | Purpose |
|---|---|
| `Backend/.env` | `UPLOAD_HOST_PATH`, `UPLOAD_DIR`, `POSTGRES_PASSWORD` |
| `docker-compose.backend-api-only.yml` | API-only compose (three-server); volume must use `${UPLOAD_HOST_PATH:-jps_uploads}` |
| `docker-compose.backend.yml` | Two-server compose; same volume fix applies |
| `Docs/Plan/SYNOLOGY-INTEGRATION.md` | Full integration guide with infra checklist |
| `Docs/Guide/ALICLOUD-DEPLOYMENT-GUIDE.md` | §5.2A — NAS storage, Docker Compose v5 note |
| `Docs/Guide/PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md` | Full staging → production migration runbook |
