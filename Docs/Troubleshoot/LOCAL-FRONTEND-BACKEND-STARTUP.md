## Troubleshooting: Local app not accessible (localhost:5173 / localhost:3000)

### Symptom A — Browser shows “This site can’t be reached” on `http://localhost:5173/`

**Typical error**

- `ERR_CONNECTION_REFUSED`

**Cause**

- The **frontend dev server (Vite)** is not running, so nothing is listening on port **5173**.

**Fix (start frontend)**

From `Frontend` (preferred) or repo root (compatibility wrapper):

```powershell
cd "d:\Cursor\Jetty Planning System\Frontend"
npm install
npm run dev
```

Compatibility command from repo root:

```powershell
cd "d:\Cursor\Jetty Planning System"
npm run dev
```

Expected output includes a line like:

- `Local: http://localhost:5173/`

Then open:

- `http://localhost:5173/`

---

### Symptom B — Frontend loads, but API calls fail / pages show “Failed to load …”

**Common cause**

- The **backend API** is not running or the frontend is pointing to the wrong API base URL.

**Fix (check backend health)**

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json -Compress
Invoke-RestMethod http://localhost:3000/api/v1/health | ConvertTo-Json -Compress
```

Expected:

- JSON with `"status":"ok"`.

**Fix (start backend via Docker compose)**

From repo root (PowerShell):

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d
```

Then verify again with the health commands above.

---

### Quick check: which ports are listening?

PowerShell:

```powershell
netstat -ano | findstr ":5173"
netstat -ano | findstr ":3000"
netstat -ano | findstr ":5436"
```

Expected for local dev:

- **5173**: frontend (Vite)
- **3000**: backend API
- **5436**: Postgres (Docker-published host port; maps to container 5432)

### Symptom C — API returns 404 for new routes (e.g. SI document OCR) but Docker was “restarted”

**Cause**

- Only one process should listen on **port 3000**. A stray local `node.exe` (old API without new routes) can answer before the Docker `jps-api` container.
- Docker **restart** reuses the old image; **`docker compose ... up --build -d jps-api`** is required after backend code changes.

**Fix**

```powershell
# See what owns :3000 (optional)
netstat -ano | findstr ":3000"

# Rebuild and start API only (from repo root)
docker compose --env-file Backend/.env -f docker-compose.backend.yml up --build -d jps-api

# Run migration 076 if not applied yet
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec jps-api npm run migrate
```

If a local Node API is running on 3000, stop that process so Docker receives browser traffic.

