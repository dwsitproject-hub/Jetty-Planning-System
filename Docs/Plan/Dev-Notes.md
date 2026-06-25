## Jetty Planning System – Dev Notes (Handover)

**Last updated:** 2026-06-24  
**Primary branch in use:** `sit`

---

### 1. Current code status

- **Active branch:** `sit` (tracking `dwsit/sit` on GitHub)
- **Latest commit on `sit`:** see `git log -1` on branch `sit` (aligned with former `sit-post-bontang-visit` as of 2026-06-24)
- **Production branch:** `main` on `dwsitproject-hub/Jetty-Planning-System`

To sync any machine with the current work:

```bash
git clone https://github.com/riandharmawan/Jetty-Planning-System.git
cd Jetty-Planning-System
git checkout sit
git pull
```

---

### 2. Local development

- **Tech stack:** React + Vite SPA, design tokens from `Assets/design-tokens.json`.
- **Run locally (no Docker):**

```bash
cd Frontend
npm install
npm run dev
```

- **Local Docker preview (if Docker + Compose v2 available):**

```bash
docker compose up --build
```

The `docker-compose.yml` in the repo builds from `Frontend/Dockerfile` and serves the Vite build through nginx on port `3001`.

**Date/time display (no ` LT` suffix):** Use the shared helper so formatting and legacy string cleanup stay consistent:

```js
import { formatDateDisplay, formatDateTimeDisplay, stripLegacyDatetimeLt } from '../utils/formatDateTimeDisplay'
```

- `formatDateTimeDisplay(value)` — ISO / timestamps → `DD/MMM/YYYY HH:mm` (24-hour, browser local). If the value is an unparseable string (e.g. old API text), a trailing ` LT` is stripped.
- `formatDateDisplay(value)` — date-only values → `DD/MMM/YYYY` (locale-aware via `jps_locale`).
- `stripLegacyDatetimeLt(value)` — only removes trailing ` LT` when you must show a string as-is.

---

### 3. Staging deployment (SIT)

- **Staging branch:** `sit` (pull `origin sit` or `dwsit sit` on staging servers).
- **Deployment model:** nginx container serving static build from Vite.
- **Key files:**
  - `Frontend/Dockerfile` – builds production bundle and nginx image.
  - `docker-compose.yml` – for local parity; on server, either `docker compose` or an equivalent `docker build` + `docker run` is used.
  - `Frontend/nginx.conf` – serves from `/usr/share/nginx/html` with SPA routing.

**Typical server update flow (manual):**

```bash
cd /opt/jetty-planning-system/Jetty-Planning-System
git checkout sit
git pull

# Option A – Docker Compose v2
docker compose down
docker compose up --build -d

# Option B – No Compose: build + run manually (example)
docker build -t jps-web:latest ./Frontend
docker stop jps-web || true
docker rm jps-web || true
docker run -d --name jps-web -p 3001:80 jps-web:latest
```

If the UI on staging looks older than local, the usual cause is that the container was not rebuilt from the latest `sit` code; running one of the sequences above fixes it.

---

### 4. Documentation & product context

**Documentation updates:** When asked to “update documentation” for a feature set, use three layers (see **`README.md` §5**): **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** (user-visible behaviour), **TECH-SPEC-Jetty-Planning-System.md** (API/DB/code), **README.md** (short executive summary).

Key documents under `Docs` that describe features, flows, and requirements:

- `TECH-SPEC-Jetty-Planning-System.md` – technical design, modules, data flows.
- `FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md` – functional behaviour: Gantt, arrival/berthing, At-Berth list, datetime display rules.
- `ALICLOUD-DEPLOYMENT-GUIDE.md` – environment and deployment notes for Alicloud.
- `Feature-Module-Summary.md` – functional summary per feature/module.
- `Jetty PRD vRian - 0.1 - extracted.txt` – earlier PRD text used to refine requirements.
- `PRD ...` files – updated PRD versions based on the latest features.

When starting a new AI-assisted session, point the assistant explicitly to these files for full context.

---

### 5. Features snapshot (as of `3fc16c3`)

High-level modules implemented in the SPA:

- **Dashboard / Command Center**
- **Shipping Instruction**
- **Allocation & Berthing / At-Berth Executions**
- **Loading / Operations**
- **Clearance**
- **Reporting**
- **Master data**
- **Admin:** Users, Roles, Departments
- **Activity Log**

Details for each live in `Docs/Feature-Module-Summary.md` and the tech spec.

---

### 6. Next suggested steps

- Harden deployment flow:
  - Standardize on `docker compose` (v2) or a small deployment script to avoid forgetting the rebuild step.
  - Optionally add a simple CI workflow to build and push images on `sit` updates.
- Continue evolving the PRD and tech spec in `Docs` in parallel with UI changes.

