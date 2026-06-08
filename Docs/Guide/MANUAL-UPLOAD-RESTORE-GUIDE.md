# Manual upload and restore guide (operation documents)

Use this guide when uploaded files are **missing from disk** but the **database still has metadata** (filename visible in the UI, preview/download returns 404), or when you need to **restore files on the server** without using the JPS web UI.

**Typical scenario:** After a container recreate before the persistent `jps_uploads` volume was configured, berthing photos and other operation documents were lost from `/tmp` while Postgres rows remained.

**Run shell commands on the backend server** (e.g. `172.28.92.57`). Replace placeholders (`<BACKEND_IP>`, vessel names, paths) with your environment values.

**Related:** [ALICLOUD-DEPLOYMENT-GUIDE §5.2A](./ALICLOUD-DEPLOYMENT-GUIDE.md) (persistent uploads volume and migration).

---

## Choose an approach

| Approach | When to use |
| -------- | ----------- |
| **A. Re-upload in the app** | Normal case. User has the file and can open Allocation / Loading / SI in the browser. Handles DB, disk, and MIME validation automatically. |
| **B. Restore file to existing DB row** | UI shows filename but image/PDF is broken. SQL returns a `document_id` and `stored_path`, but the file is missing on disk. **No SQL change** if you restore to the exact `stored_path`. |
| **C. Insert new DB row + file** | No active row in the database for that upload. Requires `INSERT` and placing a new file under `operations/{id}/berthing/...`. |

For **berthing vessel photos**, the app stores metadata in **`operation_documents`** with **`kind = 'BERTHING'`**. The Allocation vessel detail modal loads them via `GET /api/v1/operation-documents/operations/{operationId}/BERTHING` and serves preview through `GET /api/v1/operation-documents/{id}/view`. Public `/uploads/` URLs are **not** served; access requires an authenticated session (and port scope where applicable).

---

## Prerequisites

- SSH access to the **backend** host (`/opt/jetty-planning-system`).
- Docker stack running: `jps-api`, `jps-db`.
- Persistent uploads volume deployed (`UPLOAD_DIR=/var/jps/uploads`). Confirm:

```bash
docker exec jps-api printenv UPLOAD_DIR
# Expected: /var/jps/uploads
```

---

## Step 1 — Find the document in the database

On the backend server:

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \
  psql -U jps_user -d jps_db
```

Adjust `jps_user` / `jps_db` if your `Backend/.env` differs.

### Berthing photos for a specific vessel / SI

```sql
SELECT
  o.id                    AS operation_id,
  o.jetty_operation_code,
  sp.vessel_name,
  si.reference_number     AS si_no,
  od.id                   AS document_id,
  od.original_name,
  od.stored_name,
  od.stored_path,
  od.mime_type,
  od.size_bytes,
  od.created_at
FROM operations o
JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
LEFT JOIN operation_documents od
  ON od.operation_id = o.id
 AND od.kind = 'BERTHING'
 AND od.deleted_at IS NULL
WHERE sp.vessel_name ILIKE '%<VESSEL_NAME>%'
   OR si.reference_number ILIKE '%<SI_FRAGMENT>%'
ORDER BY od.created_at DESC NULLS LAST, o.id;
```

Example: vessel `BG. MULIA VII`, SI containing `022%EUP%KALTIM`.

### All active operation documents (any kind)

```sql
SELECT
  od.id AS document_id,
  od.operation_id,
  od.kind,
  od.original_name,
  od.stored_path,
  od.size_bytes,
  od.created_at,
  sp.vessel_name,
  si.reference_number AS si_no
FROM operation_documents od
JOIN operations o ON o.id = od.operation_id
JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
WHERE od.deleted_at IS NULL
ORDER BY od.created_at DESC;
```

Write down for each file you will restore:

- `operation_id`
- `document_id`
- `stored_path` (e.g. `operations/1/berthing/1779519534193-66f38c8385ef12ce368bdd70.jpeg`)
- `stored_name` (last segment of `stored_path`)

**Important:** The on-disk filename is **`stored_name`**, not **`original_name`**. The UI shows `original_name` (e.g. `WhatsApp Image 2026-05-23 at 14.51.18.jpeg`).

---

## Step 2 — Copy image from your PC to the backend server

From **Windows PowerShell** (one file at a time, or use distinct host filenames):

```powershell
scp "D:\path\to\photo.jpeg" root@<BACKEND_IP>:/opt/jetty-planning-system/restore-<label>.jpeg
```

Example:

```powershell
scp "D:\photos\berthing-op2.jpeg" root@172.28.92.57:/opt/jetty-planning-system/restore-op2.jpeg
scp "D:\photos\berthing-op3.jpeg" root@172.28.92.57:/opt/jetty-planning-system/restore-op3.jpeg
```

On the server, verify each file:

```bash
ls -la /opt/jetty-planning-system/restore-*.jpeg
```

Optional (host has `file` command):

```bash
file /opt/jetty-planning-system/restore-op2.jpeg
```

Expect `JPEG image data` and note byte size for optional DB update.

---

## Step 3 — Restore file inside the container (Option B)

For **each** document row from Step 1, copy the host file to the **exact** path under `UPLOAD_DIR`:

```bash
cd /opt/jetty-planning-system

UPLOAD_ROOT=/var/jps/uploads
OPERATION_ID=1
STORED_NAME=1779519534193-66f38c8385ef12ce368bdd70.jpeg
HOST_FILE=./restore-op1.jpeg

docker exec jps-api mkdir -p "${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing"

docker cp "${HOST_FILE}" \
  "jps-api:${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing/${STORED_NAME}"

docker exec jps-api ls -la "${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing/"
docker exec jps-api test -f "${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing/${STORED_NAME}" && echo OK
```

Repeat with different `OPERATION_ID`, `STORED_NAME`, and `HOST_FILE` for each of your two (or more) images.

### Worked example — BG. MULIA VII (operation 1)

SQL result:

| Field | Value |
| ----- | ----- |
| operation_id | `1` |
| document_id | `1` |
| stored_path | `operations/1/berthing/1779519534193-66f38c8385ef12ce368bdd70.jpeg` |
| size_bytes | `62631` |

Commands:

```bash
docker exec jps-api mkdir -p /var/jps/uploads/operations/1/berthing

docker cp ./mulia-vii-berthing.jpeg \
  jps-api:/var/jps/uploads/operations/1/berthing/1779519534193-66f38c8385ef12ce368bdd70.jpeg

docker exec jps-api ls -la /var/jps/uploads/operations/1/berthing/
```

No SQL update needed when restored file size matches `size_bytes` in the database.

---

## Step 4 — (Optional) Update metadata in the database

Only if the restored file size differs from `size_bytes`:

```sql
UPDATE operation_documents
SET size_bytes = <actual_byte_size>, updated_at = NOW()
WHERE id = <document_id> AND deleted_at IS NULL;
```

Get size on the host:

```bash
stat -c%s /opt/jetty-planning-system/restore-op2.jpeg
```

---

## Step 5 — Verify in the application

1. Hard refresh the JPS app (Ctrl+F5) or sign out and back in.
2. Open **Allocation** → vessel row → vessel detail modal.
3. Section **Berthing details (vessel photo)** should show thumbnails.
4. Click a photo → preview modal should open.

### API check

In browser DevTools → **Network**, confirm:

```text
GET /api/v1/operation-documents/<document_id>/view  →  200
```

404 **`Document file not found`** means the file path or `UPLOAD_DIR` still does not match the DB row.

### List files on disk (all restored uploads)

```bash
docker exec jps-api find /var/jps/uploads -type f
```

---

## Option A — Re-upload via the app (recommended when possible)

1. **Allocation** → open the vessel → click **Edit** (pencil).
2. **Berthing details (vessel photo)** → **Add vessel photos** → choose file(s).
3. Save.

The API validates JPEG/PNG/PDF magic bytes, writes under `operations/{operationId}/berthing/`, and inserts or replaces metadata automatically.

Use Option B (manual restore) when operators cannot use the UI or you must preserve the existing `document_id` / `stored_path` row.

---

## Option C — New document (no existing DB row)

If Step 1 returns **no** `document_id` for that operation, create a new stored filename and insert a row.

```bash
OPERATION_ID=2
STORED_NAME="$(date +%s%3N)-$(openssl rand -hex 12).jpeg"
UPLOAD_ROOT=/var/jps/uploads

docker exec jps-api mkdir -p "${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing"
docker cp ./restore-op2.jpeg \
  "jps-api:${UPLOAD_ROOT}/operations/${OPERATION_ID}/berthing/${STORED_NAME}"

stat -c%s ./restore-op2.jpeg
```

```sql
INSERT INTO operation_documents (
  operation_id, kind, original_name, stored_name, stored_path, mime_type, size_bytes
) VALUES (
  2,
  'BERTHING',
  'Berthing photo restored 2026-05-25.jpeg',
  '<STORED_NAME>',
  'operations/2/berthing/<STORED_NAME>',
  'image/jpeg',
  <size_bytes>
)
RETURNING id;
```

Replace `<STORED_NAME>` and `<size_bytes>` with actual values.

---

## Other document types (reference)

| UI area | Table | kind / notes | Disk pattern |
| ------- | ----- | ------------ | ------------ |
| Allocation — NOR | `operation_documents` | `NOR` | `operations/{id}/nor/...` |
| Allocation — berthing photo | `operation_documents` | `BERTHING` | `operations/{id}/berthing/...` |
| Loading / sub-process docs | `operation_sub_process_documents` | — | `operations/{id}/sub-processes/{key}/...` |
| Shipping Instruction upload | `shipping_instruction_documents` | — | `si/plans/{planId}/...` |

Manual restore for those tables follows the same pattern: match **`stored_path`** in the DB to the file under **`/var/jps/uploads/`**, then use the corresponding API `.../view` route (`operation-documents`, sub-process routes, or `si-documents`).

---

## Checklist — restore two more berthing images

Use this short checklist per image:

- [ ] Run SQL for vessel/SI → record `operation_id`, `document_id`, `stored_path`, `stored_name`
- [ ] `scp` JPEG from PC to `/opt/jetty-planning-system/restore-<label>.jpeg`
- [ ] `ls -la` on host — valid size and JPEG
- [ ] `docker exec jps-api mkdir -p /var/jps/uploads/operations/<op_id>/berthing`
- [ ] `docker cp` to `/var/jps/uploads/<stored_path>`
- [ ] `docker exec jps-api test -f /var/jps/uploads/<stored_path> && echo OK`
- [ ] Hard refresh app → thumbnail + preview work
- [ ] (Optional) `UPDATE size_bytes` if size changed

---

## Common mistakes

| Mistake | Symptom |
| ------- | ------- |
| File saved with `original_name` on disk instead of `stored_name` | 404 on preview |
| Wrong `operation_id` in path | File exists but wrong vessel |
| File only on host, not copied into container | 404 on preview |
| File under `/tmp/jps-uploads` but `UPLOAD_DIR=/var/jps/uploads` | 404 on preview |
| Restored row is soft-deleted (`deleted_at` not null) | UI does not list document |

---

## See also

- [ALICLOUD-DEPLOYMENT-GUIDE §5.2A](./ALICLOUD-DEPLOYMENT-GUIDE.md) — persistent `jps_uploads` volume, migration from `/tmp`, backups
- [TECH-SPEC §3.10A](../TECH-SPEC-Jetty-Planning-System.md) — upload root and Docker volume specification
