# Jetty Planning System — Technical Architecture

**Version**: 1.1  
**Last Updated**: 2026-05-28  
**Sources**: TECH-SPEC-Jetty-Planning-System.md, Feature-Module-Summary.md, Dev-Notes.md, Jetty PRD vRian - 1.0

---

## 0. Latest Update Addendum (2026-03-27)

This addendum reflects implemented behavior that supersedes older sections in this document.

### 0.1 Port-scoped access model (implemented)

- Access scope is now **Port-based** with hierarchy **Port -> Jetty**.
- New mapping table: `user_ports` (active user-to-port assignment).
- Operational APIs are scoped by selected port via request header:
  - `X-Selected-Port-Id`
- Scope behavior:
  - User has **0 assigned ports** -> access blocked with:
    - `No port assigned, please contact Jetty Planning System Admin`
  - User has **1 assigned port** -> auto-selected.
  - User has **>1 assigned ports** -> user must select a port first.
- Frontend stores selected port in **session storage only** (not local storage), and supports **runtime port switch** from the header.
- Scope applies to operational modules globally (Shipping Instruction, Allocation/Berthing, At-Berth, Loading/Unloading, Verification/Clearance, related activity/doc APIs), while Admin/Master modules remain accessible for configuration.

### 0.2 New/updated APIs for port assignment

- `GET /users/me/ports` -> assigned ports for logged-in user.
- `GET /users/:id/ports` -> assigned ports for a specific user (Admin User Management).
- `PUT /users/:id/ports` -> replace assigned ports for a specific user.
- `GET /ports/:id/users` -> list users with assignment flag for a port.
- `PUT /ports/:id/users` -> replace assigned users for a port.

Current UI ownership:

- Port assignment is managed in **Admin -> User Management** (add/edit user).
- Master Port no longer provides assign-user UI; port-centric endpoints remain temporarily for compatibility/deprecation window.

### 0.3 Clearance contract update (implemented)

- Depart now requires **cast-off only**:
  - `POST /operations/:id/depart` body:
    - required: `cast_off_at`
    - optional: `clearance_document_url`, `vessel_photo_url`
- `hose_off_at` has been removed from active UI/API flow.
- Frontend Verification page now records CAST Off only and persists evidence links via operation documents.

### 0.4 Data model update

- Added table: `user_ports` (migration `033_user_ports.sql`).
- Removed `operations.hose_off_at` column from runtime model (migration `032_remove_hose_off_at.sql`).

### 0.5 Shipment Plan aggregate (2026-05-11, migration `059_shipment_plans.sql`)

- New table **`shipment_plans`**: vessel-call level aggregate (`port_id`, `vessel_name`, jetty, allocation/clearance timestamps, exception fields, etc.) intended to become the **source of truth** for shared scheduling and vessel-level clearance as the multi-SI model is completed.
- **`shipping_instructions.shipment_plan_id`** (required FK): each SI belongs to exactly one plan today (**1:1 backfill**); future work allows **multiple SIs per plan**.
- **`operations`**: still holds per-SI execution, sign-off, and Jetty Operation Id; legacy allocation/clearance columns remain populated for **rollback** alongside plan writes where migrations have not yet dropped mirrors.
- **Shipping Instruction create API**: creates a **shell `shipment_plans` row** in the same transaction as the SI.
- **Allocation overview API**: each queue row includes **`shipmentPlanId`** plus **denormalised plan timestamps** (flat-queue strategy).
- **`PUT /allocation/arrival`**: writes vessel-call fields to **`shipment_plans`** (then mirrors to the selected operation as needed).
- **`POST /shipment-plans/:id/depart`** (+ **`POST /operations/:id/depart`** with plan siblings): single clearance action sails **all** ready child operations and updates the plan row.
- **`GET /operations` / `:id`**: JSON merges **`shipment_plans`** timeline over **`operations`** when **`shipmentPlanId`** is present so hubs and calculators see one voyage clock.

### 0.6 Alicloud deployment topology (2026-05-28)

Production and SIT on Alicloud ECS use **Docker Compose** in the same VPC. Two layouts are supported:

| Layout | Servers | Compose (repo root unless noted) |
|--------|---------|----------------------------------|
| **Two-server** (default bootstrap) | App (nginx + SPA) \| API + PostgreSQL | `docker-compose.app.yml`, `docker-compose.backend.yml` |
| **Three-server** (recommended at scale) | App \| API only \| PostgreSQL only | `docker-compose.app.yml`, `docker-compose.backend-api-only.yml`, `Backend/infra/docker-compose.db.yml` |

**Three-server traffic path** (example private IPs):

```text
Browser → Server 1 (nginx :3080, public EIP or VPC)
              → Server 2 (jps-api :3000)          [VPC only]
                    → Server 3 (jps-db :5432)     [VPC only; SG: API host only]
```

- **Server 1 (app):** unchanged for users — nginx proxies `/api/` to Server 2 (uploads served only via authenticated API routes, not public `/uploads/`). See `Frontend/nginx.alicloud-app.conf`.
- **Server 2 (API):** `jps-api` + **Synology NAS** bind mount via `UPLOAD_HOST_PATH` (SI/operation documents); **`DATABASE_URL`** points at Server 3 via `DB_HOST` / `DB_PORT` in `Backend/.env`. Local dev falls back to **`jps_uploads`** volume.
- **Server 3 (DB):** `jps-db` only; **not** exposed to the internet. Inbound **5432** from Server 2 private IP only.

**Migration from two- to three-server:** [Guide/THREE-SERVER-DB-SPLIT-GUIDE.md](./Guide/THREE-SERVER-DB-SPLIT-GUIDE.md). **Production cutover:** [Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md). Initial install and security groups: [Guide/ALICLOUD-DEPLOYMENT-GUIDE.md](./Guide/ALICLOUD-DEPLOYMENT-GUIDE.md) (two-server baseline; links to split guides).

---

## 1. Overview

### 1.1 Vision

Digitize and streamline end-to-end jetty operations (loading and unloading) by providing:

- Real-time visibility of vessel and jetty status  
- Automated SLA calculations  
- Standardized workflows for QC, quantity checks, and clearance  

### 1.2 High-level architecture

**Logical view** (application layers):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                               │
│  React 18 + Vite 5 SPA  │  Design tokens  │  React Router 6             │
└─────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS (or HTTP on internal SIT)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     APP TIER (nginx + static SPA)                        │
│  Same-origin /api/v1 proxied to API tier (files via stored-files / docs) │
└─────────────────────────────────┬───────────────────────────────────────┘
                                   │ VPC private :3000
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API TIER (Node.js)                              │
│  REST /api/v1  │  JWT + cookies  │  RBAC  │  file uploads (NAS / local)│
└─────────────────────────────────┬───────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │ Synology NAS  │  │ External     │
│  (primary DB)│  │ (staging/prod)│  │ (Weather,    │
│  own ECS in  │  │ or jps_uploads│  │  SSO/OIDC)   │
│  3-server    │  │               │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Alicloud physical layout (three-server, typical SIT/production):**

| Server | Role | Example IP | Published ports (host) |
|--------|------|--------------|-------------------------|
| **1 — App** | nginx + built React SPA | `172.28.92.56` + EIP | **3080** → users; proxies to Server 2 |
| **2 — API** | `jps-api` only (after split) | `172.28.92.57` | **3000** → app SG only |
| **3 — DB** | `jps-db` only | `172.28.92.60` | **5432** → API SG only |

Two-server bootstrap colocates API + Postgres on Server 2 (`docker-compose.backend.yml`); cutover moves Postgres to Server 3 without changing the browser URL or nginx upstream (still Server 2 `:3000`). See **§0.6** and **§10**.

**Current state**: Full-stack React SPA + Node API + PostgreSQL; operational modules persist to the database (at-berth sub-processes, operational activities, shipment plans, SI documents, etc.).

---

## 2. Technology stack

The following stack is **confirmed** for the Jetty Planning System:

| Layer      | Technology   | Notes |
|-----------|---------------|-------|
| **Frontend**  | **React.js**  | React 18; Vite 5 for build and dev. |
| **Backend**   | **Node.js**   | REST API under `/api/v1`; JWT auth. |
| **Database**  | **PostgreSQL**| Primary data store for all entities. |

The sections below detail each layer.

### 2.1 Frontend (existing)

| Layer | Technology |
|-------|------------|
| Framework | React 18 |
| Build / dev server | Vite 5 |
| Routing | React Router 6 |
| Styling | CSS + design tokens (`Assets/design-tokens.json` → `design-tokens.css`) |
| UI library | None (custom components) |
| State | React Context (LoadingProvider, ClearanceProvider, ActivityLogProvider) |

### 2.2 Backend (target)

| Layer | Technology (recommended) |
|-------|---------------------------|
| Runtime | Node.js |
| API style | REST, base path `/api/v1` |
| Auth | JWT; optional SSO later |
| Database access | PostgreSQL client (e.g. `pg`, or ORM) |
| File storage | Local or cloud (e.g. Alicloud OSS) for documents and photos |

### 2.3 Data & infrastructure

| Component | Technology |
|-----------|------------|
| Database | PostgreSQL 16 (Docker `jps-db`) |
| Deployment | Docker Compose on Alicloud ECS (Ubuntu); optional local Compose for dev |
| Web server (frontend) | nginx (static Vite build in `jps-fe` container) |
| Upload storage | **Synology NAS** on staging/production (`UPLOAD_HOST_PATH` → `/var/jps/uploads` in container); local dev uses Docker volume **`jps_uploads`** or `Backend/uploads` |
| Environments | Dev (local), Testing / SIT (Alicloud), Production (Alicloud) |
| Topology | **Two-server** (app + API/DB) or **three-server** (app + API + dedicated DB) — **§0.6**, **§10** |

---

## 3. Environments

| Environment | Purpose | Frontend | API | Database |
|-------------|---------|----------|-----|----------|
| **Dev (local)** | Development | Vite dev server (e.g. :5173) | Docker: `docker-compose.backend.yml` (API + DB on one host) | Same compose as API |
| **Testing (Alicloud SIT)** | SIT / UAT | ECS app host; `docker-compose.app.yml` (:3080 typical) | ECS API host; `docker-compose.backend.yml` **or** `docker-compose.backend-api-only.yml` | Colocated on API host **or** dedicated DB ECS (`Backend/infra/docker-compose.db.yml`) |
| **Production (Alicloud)** | Live | Same as SIT pattern | Same as SIT pattern | Dedicated DB host recommended (**three-server**) |

Configuration per environment (e.g. `Backend/.env`, repo root `.env` for Vite build):

- **App:** `VITE_API_BASE_URL` (production: `/api/v1` on same host users open), `JPS_FE_PORT`
- **API:** `DATABASE_URL` or `DB_HOST` + `DB_PORT` + `POSTGRES_*`, `JWT_SECRET`, `CORS_ORIGIN`, `COOKIE_SECURE`, SSO/OIDC vars
- **DB server:** `POSTGRES_*`, `DB_BIND_IP` (VPC private IP of DB host for `:5432` publish)
- External: `EXIM_API_URL`, weather keys, Hub/OIDC secrets as applicable

---

## 4. Functional domains and roles

### 4.1 Domains

- Shipping Instructions (SI)  
- Vessel & Operations (Loading/Unloading)  
- Allocation & Berthing  
- QC / Survey  
- Quantity Check  
- Clearance & Exceptions  
- Dashboard & Reports  
- Master Data (Ports, Jetties, SLA & Rates)  
- RBAC & Audit  

### 4.2 Roles

- Jetty Operator  
- Logistics & EXIM  
- QC Team  
- Tank Farm Team  
- PPIC / Manager  
- Admin / IT  

RBAC is defined at **department**, **page**, and **field** level (View/Edit/Delete).

---

## 5. Data model (relational)

### 5.1 Core entities

| Area | Tables / entities |
|------|-------------------|
| **Identity & RBAC** | `users`, `roles`, `permissions`, `role_permissions`, `user_roles` |
| **Master** | `ports`, `jetties`, `jetty_status_history` |
| **Operations** | `shipping_instructions`, `operations`, `operation_materials`, `operation_activities` (optional) |
| **QC & quantity** | `qc_surveys`, `qc_documents`, `quantity_checks` |
| **SLA & rates** | `sla_config`, `standard_rates` |
| **Audit** | `audit_logs` |

### 5.2 Key relationships

- **operations** ↔ shipping_instructions (one operation per SI + jetty)  
- **operations** ↔ jetties, ports  
- **operations** ↔ qc_surveys, quantity_checks (per operation)  
- **operations** ↔ operation_materials (volumes, rates for SLA)  

### 5.3 Indexes (recommended)

- `operations (shipping_instruction_id, status)`  
- `operations (jetty_id, docking_start_time, status)`  
- `audit_logs (entity_type, entity_id, created_at)`  

---

## 6. API design (summary)

All endpoints under **`/api/v1`**.

### 6.1 Authentication & users

- `POST /auth/login` – login; returns user + JWT  
- `GET /users/me` – current user profile and effective permissions  
- `GET /users`, `POST /users`, `PUT /users/:id` – Admin user management  

### 6.2 Shipping instructions

- `GET /shipping-instructions`, `GET /shipping-instructions/:id`  
- `POST /shipping-instructions`, `PUT /shipping-instructions/:id`  

### 6.3 Operations & SLA

- `GET /operations`, `GET /operations/:id`, `POST /operations`, `PUT /operations/:id`  
- `POST /operations/:id/start-docking` – set docking time and compute SLA  
- `POST /operations/:id/recalculate-sla`  
- `POST /operations/:id/signoff`  
- `POST /operations/:id/request-exception`, `POST /operations/:id/approve-exception`  
- `GET /operations/at-berth` – list at-berth operations  

### 6.3.1 At-berth persistence (sub-processes, operational activities, timeline)

**Sub-processes** (Pre-Checking / Post-Checking / Operational “steps” recorded as discrete rows):

- `GET /operations/:operationId/sub-processes?phase=Pre-Checking|Operational|Post-Checking`
- `PUT /operations/:operationId/sub-processes/:subProcessKey` – upsert one step (JSON payload depends on step type)
- `DELETE /operations/:operationId/sub-processes/:subProcessKey?phase=Pre-Checking|Operational|Post-Checking` – soft-delete the step and its related documents

**Sub-process documents**:

- `GET /operations/:operationId/sub-processes/:subProcessKey/documents?phase=...`
- `POST /operations/:operationId/sub-processes/:subProcessKey/documents` (multipart) – upload
- `DELETE /operations/:operationId/sub-processes/:subProcessKey/documents/:documentId?phase=...` – soft-delete

**Operational activities (milestone activities + milestone N/A)**:

- `GET /operations/:operationId/operational-activities`
- `POST /operations/:operationId/operational-activities`
- `PUT /operations/:operationId/operational-activities/:entryId`
- `DELETE /operations/:operationId/operational-activities/:entryId`

**Unified activity timeline** (used by the **Detailed At-Berth Executions Log** on Loading/Unloading and related guards):

- `GET /operations/:operationId/activity-timeline` — merged Pre/Post sub-process rows and operational rows; sub-process events include a **`documents`** array (links resolve to `GET /api/v1/sub-process-documents/:id/download`).

### 6.3.2 Operational step redesign (latest)

Operational step order is standardized as:

1. `opening_h1_h2` (Opening H1 & H2)
2. `cargo_pre_conditioning` (Cargo Pre-Conditioning)
3. `cargo_operations` (Cargo Operations)
4. `other` (Other)

Cargo Operations keeps sub-step support and records `cargo_handling_method_id` per activity row.

### 6.3.3 Master data: cargo handling methods

New master endpoint:

- `GET /master/cargo-handling-methods`

Seeded active values:

- Hose
- Conveyor
- Grab Bucket
- Dump Truck
- Bucket Elevator

### 6.4 QC & quantity

- `GET /operations/:id/qc-surveys`, `POST /operations/:id/qc-surveys`, `PUT /qc-surveys/:id`  
- `GET /operations/:id/quantity-checks`, `POST /operations/:id/quantity-checks`, `PUT /quantity-checks/:id`  

### 6.5 Master & jetty

- `GET /ports`, `POST /ports`, `PUT /ports/:id`  
- `GET /jetties`, `POST /jetties`, `PUT /jetties/:id`  
- `PUT /jetties/:id/status` – Available / Out of Service  

### 6.6 SLA & rates

- `GET /sla-config`, `PUT /sla-config`  
- `GET /standard-rates`, `POST /standard-rates`, `PUT /standard-rates/:id`  

### 6.7 Dashboard & weather

- `GET /dashboard/summary` – pipeline counts, occupancy, SLA metrics  
- `GET /dashboard/weather?port_id=...` – proxy to Google Weather API  

### 6.8 Audit

- `GET /audit-log` – admin-only; filter by entity type, user, date  

---

## 7. SLA calculation

**Formula** (configurable via master data):

\[
\text{SLA} = Q_1 + Q_2 + C + \sum \frac{V_n}{\text{Rate}_n \times \text{Buffer}_n} + ((n-1) \times S)
\]

- **Q1, Q2**: Quality & quantity check durations  
- **C**: Clearance time  
- **V_n**: Volume per material; **Rate_n**: standard rate; **Buffer_n**: performance buffer  
- **n**: Number of material types  
- **S**: Fixed penalty (e.g. 1 hour) per material switch (cleaning/flushing)  

**Trigger**: `POST /operations/:id/start-docking` (and optionally `recalculate-sla` when volumes or config change). Result stored as `estimated_completion_time` on the operation.

---

## 8. Security and RBAC

### 8.1 Authentication

- Login returns JWT; API expects token in header (e.g. `Authorization: Bearer <token>`).  
- Passwords stored with strong hashing; no plain-text passwords.  

### 8.2 RBAC model

- **Department** – view / edit / delete per department  
- **Page** – view / edit / delete per application page  
- **Field** – view / edit per sensitive field (e.g. on Loading, Verification)  

**Backend**: Middleware resolves user → roles → permissions; returns 403 when view/edit/delete not allowed.  
**Frontend**: AuthContext with current user and effective permissions; hide/disable menus, actions, and fields accordingly.

### 8.3 Audit

- Full audit logging of field changes, status updates, and logins.  
- Stored in `audit_logs`; query via `GET /audit-log` (admin).  

---

## 9. Non-functional requirements

| Area | Target |
|------|--------|
| **API latency** | p95 &lt; 500 ms (standard queries); &lt; 2 s (dashboard aggregates) |
| **SLA computation** | &lt; 200 ms per operation |
| **Availability** | 99.5%+ in Production |
| **Transport** | HTTPS in Testing and Production |
| **Observability** | Structured logs with correlation IDs; Alicloud monitoring and alerting |

---

## 10. Deployment (summary)

### 10.1 Local development

- **Frontend:** `npm run dev` (Vite, e.g. :5173); `VITE_API_BASE_URL=http://localhost:3000/api/v1`
- **Backend + DB:** `docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d`
- **Migrations:** `docker compose ... exec -T jps-api npm run migrate`

### 10.2 Alicloud — two-server (bootstrap)

| Host | Compose | Notes |
|------|---------|--------|
| **App** | `docker-compose.app.yml` | Build with `VITE_API_BASE_URL=/api/v1`; nginx → API private IP :3000 |
| **API + DB** | `docker-compose.backend.yml` | `jps-api` + `jps-db`; Postgres on loopback **5436** optional for admin tools |

Step-by-step: [Guide/ALICLOUD-DEPLOYMENT-GUIDE.md](./Guide/ALICLOUD-DEPLOYMENT-GUIDE.md). Public URL / CORS / cookies: [Guide/Allowing-Public-Access.md](./Guide/Allowing-Public-Access.md).

### 10.3 Alicloud — three-server (API / DB split)

| Host | Compose | Notes |
|------|---------|--------|
| **App** | `docker-compose.app.yml` | **Unchanged** after DB split |
| **API only** | `docker-compose.backend-api-only.yml` | `DB_HOST` = Server 3 private IP; **NAS upload bind** via `UPLOAD_HOST_PATH` |
| **DB only** | `Backend/infra/docker-compose.db.yml` | Run on Server 3; SG allows **5432** from Server 2 only |

Playbook: [Guide/THREE-SERVER-DB-SPLIT-GUIDE.md](./Guide/THREE-SERVER-DB-SPLIT-GUIDE.md). Cutover: [Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md). Upload backup/restore: [Guide/MANUAL-UPLOAD-RESTORE-GUIDE.md](./Guide/MANUAL-UPLOAD-RESTORE-GUIDE.md).

### 10.4 Post-deploy (all layouts)

- **Migrations** run on the **API** container after each deploy that includes new SQL under `Backend/migrations/`.
- **Frontend** image must be **rebuilt** when `VITE_*` or UI code changes; API env changes alone do not update the SPA bundle.
- **Jetty Live / RTSP** (optional sidecar on app host): [Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md](./Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md).
- **Rebuild helpers:** [Guide/REBUILD-GUIDE.md](./Guide/REBUILD-GUIDE.md).

---

## 11. Frontend application structure (current)

- **Routes**: Dashboard, Shipping Instruction (list/approval/view), Allocation/Berthing, At-Berth, Loading/Unloading, Quality, Verification (Clearance), Reporting (Daily Activities, Vessel), Master (Port, Jetty, Jetty Layout), Admin (Users, Roles, Departments).  
- **Contexts**: LoadingProvider (steps, activities, pre/post checking), ClearanceProvider (clearance state per vessel), ActivityLogProvider (per-page activity log).  
- **Data layer (current)**: In-memory only (`mockData.js`, `masterData.js`, `departmentsData.js`, `rolesData.js`, `usersData.js`, report builders, Excel helpers).  

### 11.1 Activity log (timeline) actions and deep-link edit routing

The Loading/Unloading pages display a unified timeline card titled **“Activity log (Pre-Checking · Operational · Post-Checking)”**.

- **Edit button**:
  - Navigates to the correct sub-page and focuses the relevant editor using query parameters.
  - Pre-Checking / Post-Checking: `?focus=<tabId>&edit=1`
  - Operational: `?milestone=<milestoneKey>&edit=1`
- **Delete button**:
  - Sub-process rows: calls `DELETE /operations/:operationId/sub-processes/:subProcessKey?phase=...`
  - Operational rows (activity or N/A): calls `DELETE /operations/:operationId/operational-activities/:entryId`
- **Toasts**:
  - Save flows already show success toasts in the Loading UI.
  - Timeline edit/delete and operational save/N/A actions show success/error toasts using the shared `.toast` styles.

### 11.2 At-berth baseline form standards

Pre-Checking, Operational, and Post-Checking follow a shared baseline form contract:

- Status
- Start Time
- End Time
- Documents
- Remark

Additional rules:

- `Skipped` status is supported and requires a reason.
- `Skipped` counts as complete in stage completion logic.
- NOR section includes Start/End time fields in addition to NOR Tendered and NOR Accepted timestamps.

Replacing remaining in-memory modules with API calls and adding AuthContext + permission checks is part of the ongoing backend integration (see TECH-SPEC §8).

---

## 12. Reference documents

| Document | Use |
|----------|-----|
| **TECH-SPEC-Jetty-Planning-System.md** | Full API, workflows, acceptance criteria, implementation backlog |
| **Feature-Module-Summary.md** | Page-by-page feature and data summary |
| **Docs/README.md** | Documentation index and product overview |
| **Guide/ALICLOUD-DEPLOYMENT-GUIDE.md** | Two-server Alicloud install, security groups, Docker, `.env` |
| **Guide/THREE-SERVER-DB-SPLIT-GUIDE.md** | Three-server layout: DB host readiness, compose split, practice migration |
| **Guide/THREE-SERVER-DB-CUTOVER-RUNBOOK.md** | Production cutover from two- to three-server |
| **Guide/Allowing-Public-Access.md** | EIP, dual URL (private + public), CORS, cookies |
| **Guide/REBUILD-GUIDE.md** | Rebuild API and frontend after code changes |
| **Guide/MANUAL-UPLOAD-RESTORE-GUIDE.md** | Upload volume backup and restore (API server) |
| **Dev-Notes.md** | Branch, run instructions, staging flow |

This technical-architecture document is the single place for **stack, environments, data model, API summary, security, and deployment topology**; refer to the above for detailed behaviour, cutover steps, and implementation order.
