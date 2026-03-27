# Jetty Planning System — Technical Architecture

**Version**: 1.0  
**Last Updated**: 2026-03-27  
**Sources**: TECH-SPEC-Jetty-Planning-System.md, Feature-Module-Summary.md, Dev-Notes.md, Jetty PRD vRian - 1.0

---

## 1. Overview

### 1.1 Vision

Digitize and streamline end-to-end jetty operations (loading and unloading) by providing:

- Real-time visibility of vessel and jetty status  
- Automated SLA calculations  
- Standardized workflows for QC, quantity checks, and clearance  

### 1.2 High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                               │
│  React 18 + Vite 5 SPA  │  Design tokens  │  React Router 6             │
└─────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                BACKEND                                   │
│  Node.js REST API /api/v1  │  optionalAuth  │  Activity log (audit-like) │
└─────────────────────────────────┬───────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │ File storage  │  │ External     │
│  (primary DB)│  │ (docs/photos)│  │ (Weather,    │
│              │  │              │  │  EXIM/API)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Current state**: React SPA + Node.js backend exist. Some at-berth flows now persist to PostgreSQL (sub-processes, operational activities, NOR details) and are surfaced in a unified Activity Log timeline on the Loading/Unloading pages.

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
| Database | PostgreSQL |
| Deployment | Docker / Docker Compose; Alicloud ECS (Ubuntu) |
| Web server (frontend) | nginx (static build) |
| Environments | Dev (local), Testing (Alicloud), Production (Alicloud) |

---

## 3. Environments

| Environment | Purpose | Frontend | Backend | Database |
|-------------|---------|----------|---------|----------|
| **Dev (local)** | Development | Vite dev server (e.g. :5173) | **Docker-only**: API + PostgreSQL in containers (`Backend/docker-compose up`) | PostgreSQL in same compose |
| **Testing (Alicloud)** | SIT / UAT | ECS/ACK; test build | Test API | Managed DB; `.env.testing` |
| **Production (Alicloud)** | Live | HA deployment | HA API | Managed DB; `.env.production` |

Configuration per environment (e.g. `.env` / `.env.*`):

- `APP_ENV`, `VITE_API_BASE_URL`  
- `DB_*` (host, port, user, password, database name)  
- `JWT_SECRET`  
- External: `EXIM_API_URL`, `GOOGLE_WEATHER_API_KEY`, etc.

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

**Unified activity timeline** (used by “Activity log (Pre-Checking · Operational · Post-Checking)”):

- `GET /operations/:operationId/activity-timeline`

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
- `PUT /jetties/:id/status` – Available / Maintenance / High-Priority / Out of Service  

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

- **Frontend**: Built with Vite (`npm run build`); served by nginx in Docker (e.g. port 3001 locally, configurable on server).  
- **Backend**: Node.js API in container; connects to PostgreSQL (same host or managed).  
- **Database**: PostgreSQL; migrations run after deploy (e.g. `docker compose exec jps-api npm run migrate` or equivalent).  
- **Alicloud**: See **ALICLOUD-DEPLOYMENT-GUIDE.md** for security group, Docker install, `.env`, and troubleshooting.

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
| **ALICLOUD-DEPLOYMENT-GUIDE.md** | Step-by-step deployment on Alicloud |
| **Dev-Notes.md** | Branch, run instructions, staging flow |

This technical-architecture document is the single place for **stack, environments, data model, API summary, security, and deployment**; refer to the above for detailed behaviour and implementation order.
