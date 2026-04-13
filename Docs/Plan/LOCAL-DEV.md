# Local development (frontend + API)

## Option A — API in Docker (recommended)

No need to run `npm install` in **Backend** on your PC; dependencies install inside the container.

1. **Terminal 1 — Backend folder**

   ```powershell
   cd "d:\Cursor\Jetty Planning System\Backend"
   docker compose up -d --build
   docker compose logs -f
   ```

   Use **`-d` (detached)**. On many Windows setups, **`docker compose up` without `-d`** stops after *Attaching to jps-api, jps-db* and **never starts** the containers — then `docker ps -a` shows **Created** (not **Up**) and **logs are empty**.

   - API: **http://localhost:3000**
   - Postgres: **localhost:5433**

   If containers are stuck **Created**, run: `docker compose up -d` then `docker ps` — both should be **Up**.

2. **CORS** — In `Backend\.env` (used by Docker if you pass `env_file` or set vars), ensure the frontend origin is allowed, e.g.:

   `CORS_ORIGIN=http://localhost:5173`

   (Match the compose file / Dockerfile if they load `.env`.)

3. **Terminal 2 — Frontend folder (preferred)**

   ```powershell
   cd "d:\Cursor\Jetty Planning System\Frontend"
   npm install
   npm run dev
   ```

   Compatibility command from repo root also works: `npm run dev` (delegates to `Frontend`).

4. Open **http://localhost:5173** (`Frontend/.env` should have `VITE_API_BASE_URL=http://localhost:3000/api/v1`).

---

## Option B — API on Node (no Docker for API)

1. **Install deps only in Backend:**

   ```powershell
   cd "d:\Cursor\Jetty Planning System\Backend"
   npm install
   npm run dev
   ```

   If you see **Cannot find package 'dotenv'**, `node_modules` is missing → run `npm install` in **this Backend folder** (not the repo root).

2. Postgres must be running and `DATABASE_URL` in `Backend\.env` must match.

3. Frontend: same as step 3–4 in Option A (`Frontend` folder `npm install` + `npm run dev`).

---

## Two `package.json` projects

| Directory | Command | Purpose |
|-----------|---------|---------|
| `d:\Cursor\Jetty Planning System\Frontend\` | `npm run dev` | **Frontend** (Vite, preferred) |
| `d:\Cursor\Jetty Planning System\` | `npm run dev` | **Frontend** (compatibility wrapper) |
| `d:\Cursor\Jetty Planning System\Backend\` | `npm run dev` | **API** (only if Option B) |

Root `npm install` does **not** install Backend packages.

---

### If `jps-db` / `jps-api` show **Created** (not running)

```powershell
cd "d:\Cursor\Jetty Planning System\Backend"
docker compose up -d
docker ps
```

Manual start (if needed):

```powershell
docker start jps-db
timeout /t 15
docker start jps-api
```

---

## First-time DB (Docker API)

After DB is up, from **Backend** (host or container per your README):

- Run migrations / seed admin as documented in project (e.g. `npm run migrate`, `npm run seed:admin` inside the API container or locally with `DATABASE_URL` pointing at `localhost:5433`).

- **008** — SI lookup tables + SI FKs; **`GET /api/v1/si-lookups`**.
- **009** — Global **`metric`** table (KL, MT), **`shipping_instruction_breakdown`** (commodity + qty + metric per contract line); header commodity cleared; one breakdown row per existing SI (migrated).
