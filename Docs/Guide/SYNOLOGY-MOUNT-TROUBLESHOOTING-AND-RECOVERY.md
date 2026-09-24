# Synology mount troubleshooting and recovery (JPS)

Runbook for when **upload previews fail** (e.g. “Could not load preview. Try downloading the file instead.”) or **document download returns 404**, but the **filename still appears in the UI**. PostgreSQL has metadata; files on disk are missing or on the wrong storage.

**Typical cause (production, Sep 2026):** The CIFS mount for JPS dropped. Linux kept an **empty local directory** at `/mnt/synology/JETTYPLANNING`. Docker still bind-mounted that path, so new uploads went to **local disk** while older files remained on the NAS.

**Run commands on the production API host** unless noted otherwise.

| Item | Production value |
|------|------------------|
| API host | `172.28.80.51` (hostname **ECS-DB**) |
| Deploy path | `/opt/jetty-planning-system` |
| NAS IP | `172.30.1.94` |
| File Station path | `172.30.1.94/APPs/JETTYPLANNING` |
| JPS host mount | `/mnt/synology/JETTYPLANNING` |
| Parent APPs mount (same share tree) | `/mnt/synology-apps` → `//172.30.1.94/APPs` |
| Container upload root | `/var/jps/uploads` (bind from `UPLOAD_HOST_PATH`) |
| `.env` | `UPLOAD_HOST_PATH=/mnt/synology/JETTYPLANNING` |

**Related:** [SYNOLOGY-INTEGRATION-QUICKGUIDE.md](./SYNOLOGY-INTEGRATION-QUICKGUIDE.md), [SYNOLOGY-INTEGRATION.md](../Plan/SYNOLOGY-INTEGRATION.md), [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md), [DB-DAILY-BACKUP-CRON.md](./DB-DAILY-BACKUP-CRON.md).

---

## 1. Symptoms

| What users see | What it usually means |
|----------------|----------------------|
| Vessel photo / PDF preview: “Could not load preview…” | API `GET .../view` cannot read the file (404 or failed fetch) |
| Filename visible in Allocation / Verification | DB row exists (`stored_path` in `operation_documents` or similar) |
| **New** uploads may work; **old** photos fail | API writing to a **different disk** than where old files live |
| Daily DB backup cron may log NAS copy failures | `/mnt/synology/JETTYPLANNING` unmounted or not CIFS — see [DB-DAILY-BACKUP-CRON.md](./DB-DAILY-BACKUP-CRON.md) |

Preview is served only through authenticated API routes (`/api/v1/operation-documents/{id}/view`, etc.), not public `/uploads/`.

---

## 2. Root cause (production incident pattern)

1. CIFS share disconnects (NAS reboot, network blip, 180s timeout — check `dmesg | grep -i cifs`).
2. JPS had **no** persistent systemd/fstab entry for `/mnt/synology/JETTYPLANNING` (unlike PM, EXIM, SUSTAINABILITY-PORTAL on the same host).
3. The mountpoint path remained as a **local directory** (`root:root`, `4096`-byte dir entries).
4. Docker bind mount still pointed at that path → uploads and backups wrote to **local disk**.
5. Historical files stayed on Synology under `/mnt/synology-apps/JETTYPLANNING/`.

**Important:** `UPLOAD_HOST_PATH` and Docker bind can look correct even when the host path is **not** CIFS.

---

## 3. Reboot vs Docker deploy (FAQ)

Plain-language summary of when the Synology mount is lost vs when a normal JPS deploy is safe.

### What “reboot” means here

**Reboot = restart the whole API server (ECS-DB)**, not the JPS app inside Docker.

Examples:

- Server patch / maintenance restart
- Power cycle
- Cloud console “restart instance”
- Crash and automatic restart

After a full server reboot, Linux starts fresh. The Sep 2026 **`mount --bind`** fix was run manually and is **not saved** in fstab/systemd, so it **does not come back by itself**. Someone must run the remount steps again (see **§7**).

### Does Docker restart / deployment lose the mount?

**Usually no.** These actions do **not** unmount Synology on the host:

| Action | Loses Synology mount? |
|--------|------------------------|
| `docker stop` / `docker start` `jps-api` | **No** |
| Hotfix deploy — rebuild + `docker compose up -d --force-recreate jps-api` | **No** |
| Normal JPS deployment on ECS-DB | **No** |

Docker only reconnects the container to **`/mnt/synology/JETTYPLANNING` on the host**. It does not tear down the host’s NAS connection.

### What *does* lose the mount?

| Event | Effect |
|--------|--------|
| **Whole server reboot** | Manual bind is gone until someone remounts |
| **NAS / network blip** (Sep 2026 incident) | CIFS can drop; the path may become an empty **local** folder |
| IT unmounts or changes mounts | Same problem |

The Sep 2026 outage was **not** caused by a Docker deploy — the NAS connection dropped and JPS had no automatic remount.

### Mental model

```text
Synology (files)  ←→  Host mount (/mnt/synology/JETTYPLANNING)  ←→  Docker (jps-api)
     ↑                           ↑                                      ↑
  Always there            Can break on server reboot              Deploy only reconnects
                          or NAS timeout                          to the host path
```

- **Deploy** = reconnect Docker to the host path — **OK** if the host mount is still there.
- **Server reboot** or **NAS disconnect** = host path can disappear — **needs remount** (or IT persistent mount in **§8**).

**Bottom line:** You do **not** need to remount after every JPS deployment. You **do** need a remount (or IT fix) after a **server reboot**, or if previews break again (possible NAS disconnect).

---

## 4. Diagnosis — local disk vs Synology

Run in order. Stop at the first clear failure.

### 4.1 NAS reachable?

```bash
ping -c 3 -W 2 172.30.1.94
nc -vz -w 3 172.30.1.94 445
```

### 4.2 Is JPS path actually CIFS?

```bash
findmnt -T /mnt/synology/JETTYPLANNING
findmnt /mnt/synology-apps
mount | grep -i synology
```

**Healthy:** `FSTYPE` is `cifs`, source `//172.30.1.94/APPs[/JETTYPLANNING]`.

**Broken:** `findmnt` prints nothing for `/mnt/synology/JETTYPLANNING` → path is **local disk**.

### 4.3 Local disk vs NAS — ownership heuristic

```bash
ls -ld /mnt/synology/JETTYPLANNING
ls -ld /mnt/synology/JETTYPLANNING/operations /mnt/synology/JETTYPLANNING/si
timeout 10 ls /mnt/synology/JETTYPLANNING/operations | wc -l
```

| Observation | Meaning |
|-------------|---------|
| Owner **`root:root`**, few operation folders (~10) | Writing to **local rescue disk** |
| Owner **`1001:1001`**, many operation folders (e.g. 100+) | On **Synology** (CIFS uid) |
| `timeout` / hang on `ls` | Stale CIFS mount — remount needed (IT) |

Compare with the parent share (always CIFS when up):

```bash
timeout 10 ls /mnt/synology-apps/JETTYPLANNING/operations | wc -l
```

If NAS count is **much larger** than `/mnt/synology/JETTYPLANNING`, JPS is on the wrong storage.

### 4.4 Docker bind

```bash
grep UPLOAD_HOST_PATH /opt/jetty-planning-system/Backend/.env
docker inspect jps-api --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
docker logs jps-api 2>&1 | grep "Upload directory"
```

Expect: `bind /mnt/synology/JETTYPLANNING -> /var/jps/uploads` and `Upload directory: /var/jps/uploads (writable)`.

**Note:** Docker Compose v5 does not interpolate `UPLOAD_HOST_PATH` from `--env-file` alone. After compose changes, source env first:

```bash
cd /opt/jetty-planning-system
set -a && source Backend/.env && set +a
docker compose -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
```

To stop the API without compose env interpolation:

```bash
docker stop jps-api
```

### 4.5 API /view vs missing file

Browser DevTools → Network → click preview → check `/api/v1/operation-documents/{id}/view`:

| HTTP status | Likely cause |
|-------------|--------------|
| **404** `Document file not found` | File not on disk at `stored_path` (wrong mount) |
| **403** | Port scope / auth — not NAS |
| **200** but modal errors | Rare (MIME/blob); try Download |

Spot-check recent DB rows vs disk:

```bash
docker exec -i jps-api node -e '
import pg from "pg"; import fs from "node:fs"; import path from "node:path";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await p.query(`SELECT stored_path FROM operation_documents WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 10`);
let m = 0; for (const row of r.rows) if (!fs.existsSync(path.join("/var/jps/uploads", row.stored_path))) m++;
console.log("recent docs missing:", m); await p.end();
'
```

Expect: `recent docs missing: 0`.

---

## 5. Recovery procedure

**Do not remount over `/mnt/synology/JETTYPLANNING` until local-only files are copied to the NAS** (otherwise you hide data that only exists on local disk).

### 5.1 Stop API

```bash
docker stop jps-api
```

### 5.2 Copy local files to NAS (merge, never `--delete`)

Copy user uploads first (small, restores previews quickly):

```bash
rsync -av --progress \
  /mnt/synology/JETTYPLANNING/operations/ \
  /mnt/synology-apps/JETTYPLANNING/operations/

rsync -av --progress \
  /mnt/synology/JETTYPLANNING/si/ \
  /mnt/synology-apps/JETTYPLANNING/si/
```

Copy DB dumps separately (large, slow over CIFS — allow 1–2+ hours):

```bash
rsync -av --progress \
  /mnt/synology/JETTYPLANNING/db-backups/ \
  /mnt/synology-apps/JETTYPLANNING/db-backups/
```

If interrupted, re-run the same `rsync`; it resumes.

### 5.3 Preserve local copy, remount NAS path

```bash
mv /mnt/synology/JETTYPLANNING /mnt/synology/JETTYPLANNING.local-rescue-$(date +%F)
mkdir -p /mnt/synology/JETTYPLANNING
mount --bind /mnt/synology-apps/JETTYPLANNING /mnt/synology/JETTYPLANNING
findmnt /mnt/synology/JETTYPLANNING
timeout 8 ls /mnt/synology/JETTYPLANNING/operations | head
```

Alternative if IT provides a dedicated CIFS subshare (after `mv` above):

```bash
mount -t cifs //172.30.1.94/APPs/JETTYPLANNING /mnt/synology/JETTYPLANNING \
  -o credentials=/etc/smb.creds,uid=1001,gid=1001,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,soft,nounix,noserverino,nofail,_netdev
```

### 5.4 Recreate API

```bash
cd /opt/jetty-planning-system
set -a && source Backend/.env && set +a
docker compose -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
docker inspect jps-api --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
docker logs jps-api 2>&1 | grep "Upload directory"
```

### 5.5 Verify preview in UI

Hard-refresh the browser and open a previously broken vessel photo.

### 5.6 Remove rescue folder (after verification)

Compare sizes, then delete:

```bash
RESCUE=$(ls -d /mnt/synology/JETTYPLANNING.local-rescue-* 2>/dev/null | tail -1)
ls -lh "$RESCUE/db-backups/"
ls -lh /mnt/synology-apps/JETTYPLANNING/db-backups/jps_db*.dump
rm -rf "$RESCUE"
```

**Shell gotcha:** use `ls -lh "$RESCUE/db-backups/"` — do not quote the glob (`"jps_db*.dump"` does not expand inside double quotes).

---

## 6. Post-recovery verification checklist

Run after recovery (or periodically).

```bash
echo "=== 1 Rescue gone ==="
ls -ld /mnt/synology/JETTYPLANNING.local-rescue-* 2>/dev/null || echo "OK: no rescue folder"

echo "=== 2 CIFS mount ==="
findmnt -T /mnt/synology/JETTYPLANNING

echo "=== 3 Not local disk ==="
ls -ld /mnt/synology/JETTYPLANNING/operations

echo "=== 4 Docker bind ==="
docker inspect jps-api --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'

echo "=== 5 NAS tree ==="
timeout 10 ls /mnt/synology-apps/JETTYPLANNING/operations | wc -l
timeout 10 ls /mnt/synology/JETTYPLANNING/operations | wc -l
timeout 10 ls -lh /mnt/synology/JETTYPLANNING/db-backups/jps_db_rds_*.dump | tail -1

echo "=== 6 Write test ==="
TEST=/mnt/synology/JETTYPLANNING/.jps-bind-verify-$(date +%s)
touch "$TEST" && ls -l "/mnt/synology-apps/JETTYPLANNING/$(basename "$TEST")" && rm -f "$TEST" "/mnt/synology-apps/JETTYPLANNING/$(basename "$TEST")" && echo WRITE_TEST_OK

echo "=== 7 DB vs disk ==="
docker exec -i jps-api node -e '
import pg from "pg"; import fs from "node:fs"; import path from "node:path";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await p.query(`SELECT stored_path FROM operation_documents WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 10`);
let m = 0; for (const row of r.rows) if (!fs.existsSync(path.join("/var/jps/uploads", row.stored_path))) m++;
console.log("recent docs missing:", m); await p.end();
'
```

**Pass criteria:**

| Check | Expected |
|-------|----------|
| No rescue folder | `OK: no rescue folder` |
| Mount | `cifs` → `//172.30.1.94/APPs` |
| Owner | `1001:1001` on `operations/` |
| Operation folder count | Large (e.g. 100+), **equal** on both paths |
| Docker | `bind .../JETTYPLANNING -> /var/jps/uploads` |
| Write test | `WRITE_TEST_OK` |
| DB spot-check | `recent docs missing: 0` |

**Avoid on CIFS:** recursive `find ... | wc -l` over the whole tree — it often hangs; use shallow `ls` and `timeout` instead.

---

## 7. After host reboot (temporary fix until IT adds persistent mount)

The Sep 2026 `mount --bind` fix is **not persistent**. After a **whole-server reboot** (see **§3**), run:

```bash
mkdir -p /mnt/synology/JETTYPLANNING
mount --bind /mnt/synology-apps/JETTYPLANNING /mnt/synology/JETTYPLANNING
findmnt /mnt/synology/JETTYPLANNING

cd /opt/jetty-planning-system
set -a && source Backend/.env && set +a
docker compose -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
```

Then run **§6** verification.

**Note:** A normal **`docker compose up --force-recreate jps-api`** deploy does **not** require these steps — only a host reboot (or a broken mount).

---

## 8. Request for IT — persistent mount

JPS on ECS-DB had `/mnt/synology-apps` (fstab + systemd) but **no** unit for `/mnt/synology/JETTYPLANNING`. Other apps on the same host use units such as `mnt-synology-PM.mount`.

Ask IT to add a persistent mount, same pattern as PM:

| Field | Value |
|-------|-------|
| Share | `//172.30.1.94/APPs/JETTYPLANNING` (or bind from `/mnt/synology-apps/JETTYPLANNING`) |
| Mount point | `/mnt/synology/JETTYPLANNING` |
| Credentials | `/etc/smb.creds` (user `app-prj`) |
| Options | `uid=1001,gid=1001,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,soft,nounix,noserverino,nofail,_netdev` |
| Unit name (example) | `mnt-synology-JETTYPLANNING.mount` |

Until this exists, any CIFS drop or reboot can repeat the local-disk fallback.

---

## 9. Incident timeline reference (production, 2026-09-23 / 24)

| When | What happened |
|------|----------------|
| ~2026-09-23 10:41 | Local directory at `/mnt/synology/JETTYPLANNING` became the write target |
| 2026-09-23 – 24 | New uploads + nightly `jps_db_rds_*.dump` written to **local disk** (~20 user files + ~3.7 GB dumps) |
| 2026-09-24 | Recovery: rsync to NAS, `mount --bind`, recreate `jps-api`, verify preview + DB spot-check |
| Follow-up | IT persistent mount still required |

---

## 10. Proactive detection (before users notice)

The Sep 2026 incident could have been caught **hours earlier** with a small host check. Recommended layers (cheapest first):

| Layer | How often | Catches | Limitation |
|-------|-----------|---------|------------|
| **A. Mount check cron** | Every 15 min | Local disk fallback, stale CIFS, bind split | Needs cron + log review or mail |
| **B. Backup preflight** | Daily 02:00 | NAS copy path dead | Up to ~24h delay |
| **C. IT persistent mount + systemd** | On boot | Reboot without remount | Does not catch mid-day NAS blip alone |
| **D. API `/health` extension** | Every LB probe | Only if API checks storage | Today `/health` does not inspect uploads |

**Note:** Restarting **`jps-api` alone does not break the mount** (see **§3**). Monitoring must run on the **host**, not only inside Docker.

### A. Recommended — cron mount check script

Script: [`Backend/scripts/check-synology-mount.sh`](../../Backend/scripts/check-synology-mount.sh)

The script writes **`.jps-mount-health.json`** under the upload root on each run. The **Admin → Operations Dashboard** (`GET /api/v1/admin-ops/status`) reads that heartbeat for the Synology card.

It verifies:

1. `/mnt/synology/JETTYPLANNING` is **`cifs`**, not local disk  
2. `operations/` is **not** `root:root`  
3. Operation folder count is above a minimum (default **30**; production had **104**)  
4. Count matches `/mnt/synology-apps/JETTYPLANNING` within reason  
5. A **write probe** on the JPS path is visible on the parent NAS path  

**Install on ECS-DB:**

```bash
chmod +x /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh
sudo touch /var/log/jps-synology-mount.log

crontab -e
```

```cron
# JPS Synology mount — alert via non-zero exit + log
*/15 * * * * /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh >> /var/log/jps-synology-mount.log 2>&1
```

**Smoke test:**

```bash
/opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh
echo exit=$?
tail -5 /var/log/jps-synology-mount.log
```

Expect: `OK: cifs mount healthy; operations=...` and `exit=0`.

**Alerting:** pipe failures to email or your ops channel, for example:

```cron
*/15 * * * * /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh >> /var/log/jps-synology-mount.log 2>&1 || echo "JPS Synology mount check FAILED on $(hostname)" | mail -s "JPS NAS mount alert" ops@example.com
```

Replace `ops@example.com` with your team address (same SMTP stack as [SLA-EMAIL-NOTIFICATIONS-SETUP.md](./SLA-EMAIL-NOTIFICATIONS-SETUP.md) is optional for host mail).

### B. Backup job as a secondary signal

The daily RDS dump copies to `/mnt/synology/JETTYPLANNING/db-backups/`. If the mount is wrong, copy fails — see [DB-DAILY-BACKUP-CRON.md](./DB-DAILY-BACKUP-CRON.md) failure table.

Optionally run the mount check **before** the backup in crontab:

```cron
0 2 * * * /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh && /opt/jetty-planning-system/Backend/scripts/backup-db-daily.sh >> /var/log/jps-db-backup.log 2>&1
```

### C. IT / infra (best long-term fix)

Ask IT for **`mnt-synology-JETTYPLANNING.mount`** (see **§8**) so reboots auto-remount. Optionally:

- `OnFailure=` unit to notify when mount fails at boot  
- NAS / network monitoring on `172.30.1.94:445`  

### D. Optional — extend API health (future)

Today `GET /health` returns `{ status: 'ok' }` only. A future enhancement could add `upload_storage: { writable, onNas }` by checking a sentinel file or mount metadata — but **host cron (A)** is simpler and catches problems even when the API container is up but writing to the wrong disk.

### E. Admin Operations email alerts

The **Admin → Operations Dashboard** can email **`it-project@energi-up.com`** when any check **newly becomes unhealthy** (ATG sync, purge job, Synology mount, DataHub). Enable the checkbox on the dashboard (staging or production). If unticked, no emails are sent.

**Cron on API host, every 15 minutes:**

```cron
*/15 * * * * cd /opt/jetty-planning-system/Backend && npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
```

If Node runs only inside Docker, use `docker compose exec` (same pattern as SLA cron on that host):

```cron
*/15 * * * * cd /opt/jetty-planning-system && docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
```

**Smoke test (no send):**

```bash
cd Backend && npm run run:admin-ops-alerts -- --dry-run
```

Requires SMTP configured under **Admin → Notifications**. First cron run seeds state without emailing (avoids false alarms on deploy).

### What to do when the check fails

1. Run **§4** diagnosis (`findmnt`, owner, counts).  
2. If local disk fallback — **§5** recovery (rsync → remount → recreate `jps-api`).  
3. Do **not** wait for user reports — previews will break for older files first.

---

## 11. Related files

| File | Purpose |
|------|---------|
| [SYNOLOGY-INTEGRATION-QUICKGUIDE.md](./SYNOLOGY-INTEGRATION-QUICKGUIDE.md) | Initial NAS setup and migration |
| [SYNOLOGY-INTEGRATION.md](../Plan/SYNOLOGY-INTEGRATION.md) | Full integration and cutover |
| [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md) | Restore individual files when DB has metadata |
| [DB-DAILY-BACKUP-CRON.md](./DB-DAILY-BACKUP-CRON.md) | RDS dumps to `/mnt/synology/JETTYPLANNING/db-backups` |
| [HOTFIX-DEPLOY-RUNBOOK.md](./HOTFIX-DEPLOY-RUNBOOK.md) | API deploy on ECS-DB |
| [SLA-EMAIL-NOTIFICATIONS-SETUP.md](./SLA-EMAIL-NOTIFICATIONS-SETUP.md) | In-app email queue (optional alert destination) |
| `Backend/scripts/check-synology-mount.sh` | Proactive CIFS / bind health check (cron) |
| `Backend/scripts/run-admin-ops-alerts.js` | Operations Dashboard unhealthy email alerts (cron) |
| `docker-compose.backend-api-only.yml` | `${UPLOAD_HOST_PATH:-jps_uploads}:/var/jps/uploads` |
| `Backend/.env` | `UPLOAD_HOST_PATH=/mnt/synology/JETTYPLANNING` |
