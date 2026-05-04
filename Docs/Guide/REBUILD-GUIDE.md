# Rebuild guide — frontend and backend

When you change code, you often need to **rebuild** so the running process picks up the update. This project splits work between:

| Layer | Typical runtime (local) | What “rebuild” means |
| ----- | ------------------------ | --------------------- |
| **Backend (API)** | Docker container `jps-api` + Postgres `jps-db` | Rebuild the API **image** and recreate the container. |
| **Frontend (React + Vite)** | **Host** Node.js: dev server (`npm run dev`) or static `dist/` for production | Reinstall deps and/or run **`vite build`** on the host (not inside Docker for local dev). |

For architecture and URLs, see [LOCAL-DEV-STARTUP-GUIDE.md](./LOCAL-DEV-STARTUP-GUIDE.md). For container-only troubleshooting, see [../Troubleshoot/REBUILD-RESTART-CONTAINERS.md](../Troubleshoot/REBUILD-RESTART-CONTAINERS.md).

---

## Prerequisites

- **Docker Desktop** running (for backend rebuild and API runtime).
- **Node.js 18+** on the host (for frontend scripts and Vite).
- From **repository root** for the commands below unless noted.

---

## Copy-paste terminal scripts

Use these from **any** directory. **Edit the path** in the first line if your clone lives somewhere else.

### Windows PowerShell

**Full stack (backend Docker + frontend install + build):**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; npm run rebuild
```

**Backend (API container) only:**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; npm run rebuild:backend
```

**Frontend (install + `vite build`) only:**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; npm run rebuild:frontend
```

**Frontend — dependencies only (no production build):**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; node Frontend/scripts/rebuild.mjs --skip-build
```

**After a rebuild — start Vite dev server (hot reload):**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; npm run dev
```

**Health check (API):**

```powershell
Set-Location "D:\Cursor\Jetty Planning System"; Invoke-RestMethod http://127.0.0.1:3000/health
```

### Git Bash / WSL / macOS / Linux

Same operations; adjust the path to your clone.

**Full stack:**

```bash
cd "D:/Cursor/Jetty Planning System" && npm run rebuild
```

**Backend only:**

```bash
cd "D:/Cursor/Jetty Planning System" && npm run rebuild:backend
```

**Frontend only:**

```bash
cd "D:/Cursor/Jetty Planning System" && npm run rebuild:frontend
```

**Vite dev server:**

```bash
cd "D:/Cursor/Jetty Planning System" && npm run dev
```

---

## Quick reference (repo root)

| Goal | Command |
| ---- | ------- |
| Rebuild **API container** then **frontend** (install + production build) | `npm run rebuild` |
| Backend only | `npm run rebuild:backend` |
| Frontend only | `npm run rebuild:frontend` |

After a frontend rebuild, **local development** still uses the Vite dev server for day-to-day work: `npm run dev` (does not serve `Frontend/dist/`).

---

## Backend (Docker — `jps-api`)

### What the helper does

The script [`Backend/scripts/rebuild-docker.mjs`](../../Backend/scripts/rebuild-docker.mjs) runs:

```text
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api
```

- **Context:** rebuilds the image from [`Backend/Dockerfile`](../../Backend/Dockerfile).
- **Env:** loads variables from [`Backend/.env`](../../Backend/.env) (required for compose substitution and container config).

### How to run it

**From repository root:**

```powershell
npm run rebuild:backend
```

or:

```powershell
node Backend/scripts/rebuild-docker.mjs
```

**From `Backend/` folder:**

```powershell
npm run rebuild:docker
```

### When to use it

- After changing **backend source** under `Backend/src/`, `Backend/package.json`, migrations wiring, or anything baked into the image.
- When the API behaves like an **old build** (routes missing, wrong behavior) — same idea as “rebuild the container.”

### Verify

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Expect JSON with `"status": "ok"` (or equivalent).

**Note:** If you use SSO/OIDC, ensure `Backend/.env` (and Hub redirect URIs) stay aligned; see [../Security/OIDC-INTEGRATION-RUNBOOK-FOR-AGENTS.md](../Security/OIDC-INTEGRATION-RUNBOOK-FOR-AGENTS.md).

---

## Frontend (Vite — `Frontend/`)

### What the helper does

The script [`Frontend/scripts/rebuild.mjs`](../../Frontend/scripts/rebuild.mjs) runs:

1. `npm install` in `Frontend/`
2. Unless `--skip-build` is passed: `npm run build` → **Vite production build** → output under `Frontend/dist/`

### How to run it

**From repository root:**

```powershell
npm run rebuild:frontend
```

or:

```powershell
node Frontend/scripts/rebuild.mjs
```

**From `Frontend/` folder:**

```powershell
npm run rebuild
```

**Dependencies only (no production bundle):**

```powershell
node Frontend/scripts/rebuild.mjs --skip-build
```

### When to use it

- After pulling changes that touch **`Frontend/package.json`** / lockfile — refresh dependencies.
- To confirm the app **compiles** for production (`vite build`).
- **Daily UI development** usually does **not** need `vite build`; use `npm run dev` from repo root for hot reload.

### Local dev vs production build

| Mode | Command | Output |
| ---- | ------- | ------ |
| Development | `npm run dev` (repo root) | Vite dev server, e.g. port **5173** |
| Production bundle (local check) | `npm run rebuild:frontend` or `node Frontend/scripts/rebuild.mjs` | `Frontend/dist/` |

Serving `dist/` in production is typically done by **nginx** or your cloud stack (see [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md)), not by this repo’s Docker Compose file for local dev.

---

## Full stack (backend + frontend)

From repository root:

```powershell
npm run rebuild
```

Runs **backend Docker rebuild** first, then **frontend install + build**.

Then start the UI for development if needed:

```powershell
npm run dev
```

---

## Manual equivalent (without helpers)

If you prefer raw Docker Compose for the API:

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api
```

For the frontend, from `Frontend/`:

```powershell
npm install
npm run build
```

---

## Related documents

- [LOCAL-DEV-STARTUP-GUIDE.md](./LOCAL-DEV-STARTUP-GUIDE.md) — start API + Vite after reboot.
- [../Troubleshoot/REBUILD-RESTART-CONTAINERS.md](../Troubleshoot/REBUILD-RESTART-CONTAINERS.md) — Docker rebuild and sanity checks.
- [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) — production deployment.
