# Daily production DB backup (Linux cron)

Full `pg_dump` of production Postgres on the **DB host**, copied to **Synology** via the API host, with rolling retention.

| Item | Value |
|------|--------|
| Script | `Backend/scripts/backup-db-daily.sh` |
| Runs on | Production DB host `172.28.92.59` |
| Cadence | Daily **02:00** server local time |
| Local copy | `/opt/jetty-planning-system/backups/daily/jps_db_YYYYMMDD.dump` — **3 days** |
| Synology copy | `/mnt/synology/JETTYPLANNING/db-backups/` on API host `172.28.80.51` — **14 days** |

This is **Postgres only**. Upload files already live on Synology; they are not part of this job.

**Do not** use `docker exec -t` on `pg_dump` (TTY corrupts custom-format dumps). The script writes the dump inside the container and uses `docker cp`.

## Prerequisites

1. `jps-db` is running on the DB host (`Backend/infra/docker-compose.db.yml`).
2. Passwordless SSH from the DB host to the API host (the cron user, usually `root`).
3. Synology share mounted on the API host at `/mnt/synology/JETTYPLANNING` (same mount as uploads).
4. `rsync` and `flock` installed on the DB host (standard on Ubuntu).

One-time SSH check (from `172.28.92.59`):

```bash
ssh -o BatchMode=yes root@172.28.80.51 'mkdir -p /mnt/synology/JETTYPLANNING/db-backups && echo writable-ok'
```

If this fails, install an SSH key for the cron user before enabling crontab.

## Install crontab (DB host)

```bash
chmod +x /opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh

sudo mkdir -p /var/log /opt/jetty-planning-system/backups/daily
sudo touch /var/log/jps-db-backup.log
# ensure the cron user can append the log and write the backup dir
```

```bash
crontab -e
```

Add:

```cron
# Daily Postgres dump — 02:00 server local time (DB host only)
0 2 * * * /opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh >> /var/log/jps-db-backup.log 2>&1
```

Optional overrides in the crontab line (defaults match production):

```cron
0 2 * * * JPS_BACKUP_REMOTE=root@172.28.80.51:/mnt/synology/JETTYPLANNING/db-backups JPS_BACKUP_LOCAL_DAYS=3 JPS_BACKUP_NAS_DAYS=14 /opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh >> /var/log/jps-db-backup.log 2>&1
```

Set `JPS_BACKUP_REMOTE=` (empty) to dump locally only. If IT mounts Synology on the DB host, set `JPS_BACKUP_REMOTE` to that local path instead of `user@host:path`.

## First-run smoke test

On `172.28.92.59`:

```bash
/opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh
ls -lh /opt/jetty-planning-system/backups/daily/
ssh root@172.28.80.51 'ls -lh /mnt/synology/JETTYPLANNING/db-backups/'
tail -n 20 /var/log/jps-db-backup.log
```

Expect a non-zero `jps_db_YYYYMMDD.dump`, log lines `dump ok` and `backup complete`, and the same file on Synology.

## What the script does

1. `pg_dump -Fc --no-owner --no-acl` inside `jps-db` (no TTY).
2. `pg_restore -l` must list at least one `TABLE DATA` entry.
3. `docker cp` to the local daily directory; `chmod 600`.
4. `rsync` to Synology via the API host.
5. Delete `jps_db_YYYYMMDD.dump` files whose **filename date** is older than 3 days (local) or 14 days (NAS).

Purge runs only after a verified dump. If the dump or NAS copy fails, old files are left in place.

## Restore (maintenance window)

`--clean` replaces existing objects. Take a fresh dump first if the current database still has value.

```bash
DUMP=/opt/jetty-planning-system/backups/daily/jps_db_YYYYMMDD.dump
# or: /mnt/synology/JETTYPLANNING/db-backups/jps_db_YYYYMMDD.dump copied to the DB host

docker cp "$DUMP" jps-db:/tmp/restore.dump
docker exec jps-db pg_restore -U jps_user -d jps_db --no-owner --no-acl --clean --if-exists /tmp/restore.dump
docker exec jps-db rm -f /tmp/restore.dump
```

Do **not** pipe a custom-format dump into `pg_restore` on stdin. Use `docker cp` and a file path.

## Failure signs

| Symptom | Likely cause |
|---------|----------------|
| `container jps-db is not running` | Compose down on the DB host |
| `dump TOC has no TABLE DATA` | Corrupt or empty dump |
| `Permission denied (publickey)` | SSH key missing for DB → API |
| NAS copy fails; local dump exists | Synology unmounted or `db-backups` not writable |
| `another backup-db-daily.sh is already running` | Previous run still in progress (lock file) |
