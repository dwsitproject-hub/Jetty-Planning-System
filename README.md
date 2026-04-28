# Jetty Planning & Monitoring System (JPS)

Web application for CPO downstream jetty planning and execution.  
This repository is an active full-stack implementation (not an in-memory mockup only).

## What JPS covers

- **Dashboard**: vessel pipeline, slot occupancy, port activity, weather/ops visibility.
- **Allocation & Berthing**: incoming queue, jetty schedule (Gantt), confirm berthing, shift-out/re-dock.
- **At-Berth Executions**: pre-checking, operational activities, post-checking, timeline/detail views.
- **Clearance**: pending sign-off, ready-to-sail and sailed flows.
- **Shipping Instructions**: SI create/update/approve flows with shared SI detail modal links.
- **Master & Admin**: ports, jetties, SI lookups, users, roles/permissions (RBAC).
- **Demurrage Risk Calculator**: scenario-based ETA completion estimation from operation context.

## Architecture (high level)

- **Frontend**: React + Vite (`Frontend/`)
- **Backend API**: Node.js + Express (`Backend/`)
- **Database**: PostgreSQL (migrations under `Backend/migrations/`)
- **Container runtime**: Docker Compose for backend/db

## Local development quick start

### 1) Start backend (API + DB)

From repo root:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d
```

API should be available at:

- `http://localhost:3000/health`
- `http://localhost:3000/api/v1/health`

### 2) Start frontend (Vite dev server)

From repo root:

```bash
npm run dev
```

or directly:

```bash
cd Frontend
npm install
npm run dev
```

Open: [http://localhost:5173](http://localhost:5173)

## Common local issue after reboot

If Docker is running but `localhost:5173` is down, backend is up but frontend dev server is not started yet.  
Run `npm run dev` in `Frontend/`.

See troubleshooting docs:

- `Docs/Troubleshoot/LOCAL-FRONTEND-BACKEND-STARTUP.md`
- `Docs/Troubleshoot/REBUILD-RESTART-CONTAINERS.md`

## Documentation

- Functional behavior and user flows:  
  `Docs/FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md`
- Technical architecture, API/data contracts, addendums:  
  `Docs/TECH-SPEC-Jetty-Planning-System.md`
- Deployment guides:  
  `Docs/Guide/`

## Repo layout

- `Frontend/` - web app (React, Vite)
- `Backend/` - API, middleware, routes, migrations
- `Docs/` - specs, guides, troubleshooting, plans
- `Assets/` - design/supporting assets
