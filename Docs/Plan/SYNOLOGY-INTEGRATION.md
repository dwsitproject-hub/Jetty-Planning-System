# Synology integration (JPS)

This guide is for **integrating Jetty Planning System (JPS) with the shared Synology NAS**. The NAS, SMB share, and server mount are configured by IT/infra — you set **`UPLOAD_HOST_PATH`** in `Backend/.env` so uploads land in the correct folder.

**What you get**

- Uploaded files (operation docs, SI PDFs, berthing photos) are stored on the Synology share; PostgreSQL keeps metadata only (`stored_path` and related fields).
- The API reads/writes under **`UPLOAD_DIR`** inside the container (default `/var/jps/uploads`). Compose bind-mounts the NAS host path into that location.

For general JPS setup (Node, DB, migrations, Alicloud deploy), see [ALICLOUD-DEPLOYMENT-GUIDE -2SERVERS.md](../Guide/ALICLOUD-DEPLOYMENT-GUIDE%20-2SERVERS.md).

---

## 1. Before you start — infra checklist

Confirm with IT/infra **before** changing compose on staging or production API servers:

| What to confirm | Staging | Production |
|-----------------|---------|------------|
| File Station path | `172.30.1.94/dev/JETTYPLANNING` | `172.30.1.94/JETTYPLANNING` |
| Host mount path on API ECS | `/mnt/synology/dev/JETTYPLANNING` | `/mnt/synology/JETTYPLANNING` |
| Write permissions | Docker (root in container) can create files | Same |
| Mount survives reboot | `/etc/fstab` or systemd mount unit | Same |
| Network | API server can reach `172.30.1.94` (SMB) | Same |

Host mount root is **`/mnt/synology`**. File Station paths (`172.30.1.94/...`) map to that mount on the API server.

If any value is wrong, uploads may succeed in the container but files will not appear where the team expects on the NAS.

---

## 2. How paths are resolved

JPS uses a single upload root, resolved in [`Backend/src/paths.js`](../../Backend/src/paths.js):

1. **`UPLOAD_DIR`** — if set, used as the upload root inside the process (container path when running in Docker).
2. **Default** — `Backend/uploads` when running `npm` locally without `UPLOAD_DIR`.

**Docker compose** bind-mounts storage into the container:

```text
Host (NAS mount):  ${UPLOAD_HOST_PATH}  →  Container: /var/jps/uploads  (= UPLOAD_DIR)
```

- **Localhost / local Docker:** omit `UPLOAD_HOST_PATH` → compose uses named volume **`jps_uploads`** (unchanged dev behavior).
- **Staging / production:** set `UPLOAD_HOST_PATH` to the full NAS folder on the **host**.

On-disk layout under the upload root (created by the app):

```text
operations/{operationId}/{kind}/          — NOR, berthing, clearance, vessel photos
operations/{operationId}/sub-processes/  — loading pre/post-checking docs
si/plans/{shipmentPlanId}/                — SI documents linked to a plan
si/drafts/{draftKey}/                     — SI documents before plan save
```

---

## 3. Configure `Backend/.env`

Copy from **`Backend/.env.example`** if you do not have a local file yet.

### Local development without NAS

On a laptop without the Synology mount, **do not** set `UPLOAD_HOST_PATH`:

```env
# npm run dev: files go to Backend/uploads (default)
# Local Docker: jps_uploads named volume at /var/jps/uploads
```

Documents stay on your machine; they are not synced to the NAS.

### Staging (Synology)

```env
UPLOAD_HOST_PATH=/mnt/synology/dev/JETTYPLANNING
# UPLOAD_DIR=/var/jps/uploads   # optional; this is the default inside the container
```

File Station equivalent: **`172.30.1.94/dev/JETTYPLANNING`**

### Production (Synology)

```env
UPLOAD_HOST_PATH=/mnt/synology/JETTYPLANNING
```

File Station equivalent: **`172.30.1.94/JETTYPLANNING`**

Production uses **`JETTYPLANNING`** at the share root (no `dev/` prefix). Staging and production need **different** `UPLOAD_HOST_PATH` values on their respective API hosts.

---

## 4. Docker (staging / production)

Compose files that support NAS bind mounts:

- [`docker-compose.backend.yml`](../../docker-compose.backend.yml) — API + Postgres (two-server)
- [`docker-compose.backend-api-only.yml`](../../docker-compose.backend-api-only.yml) — API only (three-server)

Relevant volume stanza in `jps-api`:

```yaml
volumes:
  - ${UPLOAD_HOST_PATH:-jps_uploads}:/var/jps/uploads
```

When `UPLOAD_HOST_PATH` is set, compose bind-mounts the NAS path. When unset, the named volume `jps_uploads` is used.

After changing storage env vars or bind mounts, recreate the API container:

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --force-recreate jps-api
```

Three-server layout:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
```

### Quick check inside the container

```bash
docker exec jps-api printenv UPLOAD_DIR
docker exec jps-api ls -la /var/jps/uploads
docker logs jps-api 2>&1 | grep "Upload directory"
```

Expected startup log:

```text
Upload directory: /var/jps/uploads (writable)
```

You should see the same content on the host at `$UPLOAD_HOST_PATH`. If the container directory is empty but uploads “work”, the bind mount or `UPLOAD_HOST_PATH` likely does not match — compare with the compose `volumes` section.

---

## 5. Migrate existing files from `jps_uploads` to NAS

Use this when staging or production already has files in the Docker volume **`jps_uploads`** and you need to move them to the NAS without changing database rows.

### 5.1 Pre-migration backup

On the API host:

```bash
cd /opt/jetty-planning-system
docker run --rm -v jps_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/jps-uploads-pre-nas-$(date +%F).tar.gz -C /data .
```

### 5.2 Staging cutover

1. **Stop API** (keep DB running if on same host):

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml stop jps-api
```

2. **Copy files to NAS** (replace `NAS_PATH` with confirmed host mount):

```bash
NAS_PATH=/mnt/synology/dev/JETTYPLANNING
sudo mkdir -p "$NAS_PATH"
docker run --rm -v jps_uploads:/src -v "$NAS_PATH":/dest alpine \
  sh -c "cp -a /src/. /dest/"
find "$NAS_PATH" -type f | wc -l
```

3. **Set `UPLOAD_HOST_PATH`** in `Backend/.env` (see section 3).

4. **Deploy updated compose and recreate API:**

```bash
git pull   # includes UPLOAD_HOST_PATH compose support
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --force-recreate jps-api
```

5. **Verify:** existing document view/download + new upload (section 6).

6. **Optional rollback window:** keep the `jps_uploads` volume for 1–2 weeks before removing.

### 5.3 Production cutover

Repeat section 5.2 on the **production API host** with:

```bash
NAS_PATH=/mnt/synology/JETTYPLANNING
```

and `UPLOAD_HOST_PATH` set to that path in production `Backend/.env`.

Validate on staging first before production cutover.

### 5.4 Rollback

If the NAS mount fails:

1. Remove or comment out `UPLOAD_HOST_PATH` in `Backend/.env`.
2. Recreate `jps-api` (reverts to `jps_uploads` named volume).
3. Restore from the pre-migration tar if needed:

```bash
docker run --rm -v jps_uploads:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/jps-uploads-pre-nas-YYYY-MM-DD.tar.gz -C /data"
```

---

## 6. Verify your integration

| Step | Pass criteria |
|------|---------------|
| API startup | Log shows `Upload directory: /var/jps/uploads (writable)` |
| File count | `find` on host `$UPLOAD_HOST_PATH` matches pre-migration count (after migration) |
| Existing doc | View/download an old berthing photo or SI PDF |
| New upload | File appears under `operations/` or `si/` on the NAS |
| File Station | File visible under `dev/JETTYPLANNING` (staging) or `JETTYPLANNING` (production) |
| Security | Public `/uploads` returns 404; authenticated API routes only |

---

## 7. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Upload succeeds but File Station is empty | Wrong `UPLOAD_HOST_PATH`; typo in folder name (`JETTYPLANNING`). |
| Files in `docker exec` but not on NAS | Container writing to its own disk — bind mount missing or wrong; fix compose + recreate `jps-api`. |
| `FATAL: Upload directory not writable` | NAS mount down, permissions, or path does not exist on host. |
| Works on server, not on laptop | Expected if NAS is not mounted locally; omit `UPLOAD_HOST_PATH` for local dev. |
| 404 on existing documents after cutover | Files not copied to NAS, or `UPLOAD_HOST_PATH` points to wrong folder. |

Server-side mount, firewall, or DSM issues are handled by IT/infra — escalate with the host path and File Station path you were given.

---

## 8. Related files

| File | Purpose |
|------|---------|
| `Backend/.env.example` | `UPLOAD_HOST_PATH`, `UPLOAD_DIR` |
| `docker-compose.backend.yml` | Two-server API + NAS bind |
| `docker-compose.backend-api-only.yml` | Three-server API + NAS bind |
| `Backend/src/paths.js` | Resolves `UPLOAD_ROOT` from `UPLOAD_DIR` |
| [ALICLOUD-DEPLOYMENT-GUIDE §5.2A](../Guide/ALICLOUD-DEPLOYMENT-GUIDE%20-2SERVERS.md) | Deploy context and backups |
| [MANUAL-UPLOAD-RESTORE-GUIDE.md](../Guide/MANUAL-UPLOAD-RESTORE-GUIDE.md) | Restore files when DB has metadata but disk is missing |
