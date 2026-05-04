## Troubleshooting: Rebuild + restart containers (Backend API / App container) + quick sanity checks

This repo can run in **two common modes**:

- **Local dev (Vite)**: frontend via `npm run dev` on **`http://localhost:5173`** and backend API via Docker compose on **`http://localhost:3000`**.
- **Containerized app (Nginx + built frontend)**: app container serves UI on **`http://localhost:3001`** (or a configured port), proxies `/api/v1` to the backend.

Use the section that matches how you’re running the stack.

---

### A) Backend API container (`docker-compose.backend.yml`)

**When to use**

- You changed backend code (routes, middleware, logic) and the running `jps-api` container is still old.
- You see frontend errors like **“Not Found”** (route missing) after implementing a new endpoint.

**Rebuild + restart backend API (keep DB as-is)**

From repo root (PowerShell):

```powershell
cd "d:\Cursor\Jetty Planning System"
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api
```

**Restart backend API without rebuild (faster)**

```powershell
cd "d:\Cursor\Jetty Planning System"
docker compose --env-file Backend/.env -f docker-compose.backend.yml restart jps-api
```

**Quick sanity checks**

```powershell
# API origin (no /api/v1)
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json -Compress

# API prefix health (what the SPA calls)
Invoke-RestMethod http://localhost:3000/api/v1/health | ConvertTo-Json -Compress

# Container status
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps
```

Expected:

- Health calls return JSON with `"status":"ok"`.

**SSO / OIDC (iframe and Chrome errors)**

If SSO fails with Chrome blocking `localhost:3000/auth/oidc/callback` from `chrome-error://chromewebdata/` or when Jetty is opened inside Hub in an iframe, see **Downstream Hub SSO** troubleshooting in [SSO-INTEGRATION-GUIDE.md](../Security/SSO-INTEGRATION-GUIDE.md) (section 8). Confirm `/health` above before retesting in a fresh tab.

For **`ERR_CONNECTION_RESET`** on the callback (with or without the `chrome-error` console line), use the step-by-step guide: [OIDC-CALLBACK-ERR-CONNECTION-RESET.md](./OIDC-CALLBACK-ERR-CONNECTION-RESET.md) (includes `curl` to `/auth/oidc/ready` and `127.0.0.1` vs `localhost` on Windows Docker).
- `ps` shows `jps-api` and `jps-db` **Up**.

---

### B) Frontend dev server (Vite) — `npm run dev` (not a container)

**When to use**

- Browser shows `ERR_CONNECTION_REFUSED` on `http://localhost:5173/`.
- You changed frontend JS/JSX and want hot reload.

**Start / restart Vite**

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

Expected output includes:

- `Local: http://localhost:5173/`

**Quick sanity check**

```powershell
netstat -ano | findstr ":5173"
```

Expected:

- A `LISTENING` line for port **5173**.

---

### C) App container (built frontend + Nginx) — `docker-compose.yml` or `docker-compose.app.yml`

**When to use**

- You are running the UI from **`http://localhost:3001/`** (or `${JPS_FE_PORT}`) and want the rebuilt static UI to include your latest changes.

#### C1) Local preview app container (`docker-compose.yml`)

Rebuild + restart:

```powershell
cd "d:\Cursor\Jetty Planning System"
docker compose -f docker-compose.yml up -d --build
```

Quick sanity check:

```powershell
docker compose -f docker-compose.yml ps
```

Expected:

- App reachable at `http://localhost:3001/`

#### C2) App server container (`docker-compose.app.yml`) (same machine, different port)

Rebuild + restart:

```powershell
cd "d:\Cursor\Jetty Planning System"
docker compose -f docker-compose.app.yml up -d --build
```

Quick sanity check:

```powershell
docker compose -f docker-compose.app.yml ps
```

Expected:

- UI reachable at `http://localhost:${JPS_FE_PORT:-3001}/`

---

### D) Quick “what’s down?” port checklist

```powershell
netstat -ano | findstr ":5173"  # Vite dev server
netstat -ano | findstr ":3000"  # Backend API
netstat -ano | findstr ":3001"  # App container UI (nginx)
netstat -ano | findstr ":5436"  # Postgres (docker published)
```

