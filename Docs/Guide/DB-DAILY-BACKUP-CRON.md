# Daily production DB backup (Linux cron)

After the **ApsaraDB** cutover, live Postgres is RDS (not DB ECS `.59`). This job dumps **RDS** from the **API host** and copies new files to Synology **without touching** existing `jps_db_YYYYMMDD.dump` files (pre-cutover ECS dumps).

| Item | Value |
|------|--------|
| Script | Live crontab: `/opt/jetty-planning-system/backups/jps-backup-db-daily.sh` (copy from `Backend/scripts/jps-backup-db-daily.sh`) |
| Runs on | Production **API** `172.28.80.51` (hostname ECS-DB) |
| Source | ApsaraDB `pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com` |
| Cadence | Daily **02:00** server local time |
| New dumps | `jps_db_rds_YYYYMMDD.dump` |
| Local copy | `/opt/jetty-planning-system/backups/daily/` — **3 days** of `jps_db_rds_*` only |
| Synology | `/mnt/synology/JETTYPLANNING/db-backups/` — **14 days** of `jps_db_rds_*` only |
| Untouched | Existing `jps_db_YYYYMMDD.dump` on NAS (never overwritten or purged by this job) |

Also keep **Alicloud RDS automated snapshots** enabled.

This is **Postgres only**. Uploads already live on Synology.

**Disable** the old crontab on **`172.28.92.59`**. That job dumps `jps-db` (stale) and would overwrite `jps_db_YYYYMMDD.dump` on NAS.

---

## Install (API host `.51`)

```bash
cd /opt/jetty-planning-system
git pull   # pick up backup-db-daily.sh RDS mode
chmod +x Backend/scripts/backup-db-daily.sh
sudo mkdir -p /var/log /opt/jetty-planning-system/backups/daily
sudo touch /var/log/jps-db-backup.log
```

`Backend/.env` must have `DB_HOST` = prod RDS hostname and `POSTGRES_PASSWORD` = RDS password (already true after cutover). The script sources `.env`.

**Smoke test** (writes `jps_db_rds_YYYYMMDD.dump` only):

```bash
/opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh
ls -lh /opt/jetty-planning-system/backups/daily/jps_db_rds_*.dump
ls -lh /mnt/synology/JETTYPLANNING/db-backups/jps_db_rds_*.dump
ls /mnt/synology/JETTYPLANNING/db-backups/jps_db_*.dump | head   # old files still present
tail -n 30 /var/log/jps-db-backup.log
```

Expect a large dump (~GB), log `mode=rds` / `dump ok` / `backup complete`.

**Crontab on `.51`:**

```bash
crontab -e
```

```cron
# Daily dump of production ApsaraDB RDS → Synology (jps_db_rds_*.dump only)
0 2 * * * /opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh >> /var/log/jps-db-backup.log 2>&1
```

On `.59`, remove or comment the old `backup-db-daily.sh` line.

---

## What the script does (RDS mode)

1. Detects RDS from `DB_HOST` (`*.rds.aliyuncs.com`) or `JPS_BACKUP_MODE=rds`.
2. `pg_dump -Fc` via `docker run --network host postgres:18` to RDS (user `postgres` by default).
3. Verifies `TABLE DATA` in the dump TOC.
4. Copies to `/mnt/synology/JETTYPLANNING/db-backups/jps_db_rds_YYYYMMDD.dump`.
5. Purges only `jps_db_rds_*.dump` older than 3 days (local) / 14 days (NAS).

---

## Restore into RDS (maintenance window)

```bash
DUMP=/mnt/synology/JETTYPLANNING/db-backups/jps_db_rds_YYYYMMDD.dump
# load PGPASSWORD from Backend/.env
docker run --rm --network host -e PGPASSWORD \
  -v "$(dirname "$DUMP"):/b" postgres:18 \
  pg_restore -h pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com \
  -U postgres -d jps_db --no-owner --no-acl --clean --if-exists \
  "/b/$(basename "$DUMP")"
```

`--clean` replaces objects on **live RDS**. Plan a window. Do not restore into `jps-db` on `.59` if the API points at RDS.

---

## Failure signs

| Symptom | Likely cause |
|---------|----------------|
| `requires JPS_BACKUP_RDS_HOST or DB_HOST` | `.env` not sourced / `DB_HOST` missing |
| `set PGPASSWORD or POSTGRES_PASSWORD` | RDS password not in `.env` |
| `pg_dump` timeout / no response | Use `--network host` (script does); check RDS SG for `.51` |
| `dump TOC has no TABLE DATA` | Corrupt or empty dump |
| NAS copy fails | `/mnt/synology/JETTYPLANNING` unmounted or writing to local disk — see [SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md](./SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md) |
| `another backup-db-daily.sh is already running` | Previous run still in progress |

## Legacy container mode

`JPS_BACKUP_MODE=container` still dumps `jps-db`. Do **not** enable that on `.59` with the default NAS remote — it uses `jps_db_YYYYMMDD.dump` and would change old Synology files.
