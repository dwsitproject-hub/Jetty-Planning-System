# Jetty Planning System — Documentation

This folder contains product, feature, and technical documentation for the **Jetty Planning & Monitoring System (JPS)**.

---

## 1. Product overview

**Vision / Goal**  
To digitize and streamline end-to-end jetty operations by providing real-time visibility, automated SLA calculations, and standardized workflows for vessel loading and unloading.

**Target users**  
Jetty Operators, Logistics & EXIM teams, Quality Control (QC), Tank Farm teams, and PPIC for monitoring.

**Problem addressed**  
Jetty operations today lack a centralized system for tracking vessel progress, leading to manual SLA calculations, fragmented communication between departments (QC, Tank Farm, Jetty), and potential demurrage costs due to inefficient planning.

**Success metrics**  
- **SLA accuracy**: Variance between system-calculated Estimated Completion and actual completion time.  
- **Demurrage reduction**: Decrease in vessel wait times and idle jetty occupancy.  
- **Operational visibility**: 100% of vessel movements and QC/Quantity checks logged digitally.

---

## 2. Current state

| Aspect | Description |
|--------|-------------|
| **Application** | Web-based JPS for CPO Downstream Jetty Operations: planning, allocation, at-berth execution, clearance, and reporting. |
| **Implementation** | **SPA + Node/PostgreSQL backend** for allocation and related APIs; local dev may use Docker (`Backend/docker-compose.yml`) or run services manually. Older mockup-only flows may still exist where not yet wired. |
| **Tech stack** | React 18, Vite 5, React Router 6. CSS with design tokens (KPN Downstream); no UI component library. |

**Run locally**  
- **Frontend (preferred)**: from `Frontend/` run `npm install` → `npm run dev` → **http://localhost:5173/**  
- **Frontend (root compatibility)**: from repo root run `npm run dev` (delegates to `Frontend/`)  
- **Frontend (Docker)**: from repo root `docker compose up --build` → **http://localhost:3001/** (build context is `Frontend/`)  
- **Backend (Docker-only)**: from `Backend/` run `docker compose up -d --build` → API **http://localhost:3000**, PostgreSQL on host port **5433** (see `Backend/docker-compose.yml`, `LOCAL-DEV.md`).

**Primary branch**  
- `sit` (all current work). `main` is older; used for initial mockup and README.

---

## 3. Scope

**In scope**  
Shipping Instruction visibility, vessel allocation/berthing management, Loading/Unloading flow automation with SLA formulas, QC/Quantity check logging, exception approval workflows, jetty downtime management, and Master Data (Port/Jetty/SLA).

**Out of scope**  
Direct integration with vessel AIS (vessel position is manual update); automated weather hardware (uses Google Weather API instead).

---

## 4. Main flows

The system follows two primary paths: **Unloading (Purchasing)** and **Loading (Sales)**.

**End-to-end pipeline**  
Shipping Instruction → Allocation & Berthing → At-Berth → Loading/Unloading (Pre-Checking → Operational → Post-Checking) → Clearance & Sign-off → Reporting.

**SLA formula** (configurable in the system)  
\[
\text{SLA} = Q_1 + Q_2 + C + \sum \frac{V_n}{\text{StandardRate} \times \text{Buffer}} + ((n-1) \times S)
\]  
- \(Q_1, Q_2\): Quality & Quantity checking times  
- \(C\): Clearance  
- \(V_n\): Volumes per material; Standard Rate & Buffer per material  
- \(n\): Number of material types  
- \(S\): Fixed penalty (e.g. 1 hour) for cleaning/flushing between materials  

---

## 5. Documentation index

**How we update docs (when you ask to “update documentation”):**

| Layer | Document | What to put there |
|-------|----------|-------------------|
| **Functional** | **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** | What users see and do: behaviours, rules, field meanings in plain language (no SQL). |
| **Technical** | **TECH-SPEC-Jetty-Planning-System.md** | APIs, DB columns, parameters, shared code modules, query rules. |
| **High level** | **README.md** (this file) | Short, readable summary for anyone new to the repo. |

| Document | Purpose |
|----------|---------|
| **Jetty PRD vRian - 1.0.pdf** | Lean PRD: vision, problem, success metrics, scope, user stories, acceptance criteria, master data, risks. |
| **Feature-Module-Summary.md** | Feature-by-feature summary of the current SPA: routes, contexts, data layer, and what’s needed for production. |
| **TECH-SPEC-Jetty-Planning-System.md** | Technical specification: domains, workflows, API design, data model, RBAC, NFRs, implementation backlog, allocation overview & at-berth API details, shared datetime util. |
| **technical-architecture.md** | Technical architecture: stack, environments, data model, APIs, security, deployment. |
| **Dev-Notes.md** | Dev handover: branch status, local run, staging deployment, docs reference, next steps. |
| **ALICLOUD-DEPLOYMENT-GUIDE.md** | Deployment on Alicloud Ubuntu: security group, Docker, optional PostgreSQL, migrations, troubleshooting. |
| **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** | **Functional spec:** Jetty schedule Gantt, arrival/berthing modals, **At-Berth Executions** list behaviour, **date/time display** rules (no “LT”), and related user-visible logic. |
| **UAT-PRE-TRAINING-Scripts.md** | **Pre-UAT training:** facilitator scripts module-by-module (starts with **Shipping Instruction**); Pass/Fail tables and links to functional/technical specs. |
| **Plan/UAT-COMMODITY-PRECHECK-OPERATIONAL-PLAN.md** | **UAT rollout:** commodity type, pre-check subprocess merges (`inspection`, `initial_cargo_checking`), operational **OPENING** / start-only rules, cargo handling method on Opening (server-derived), migrations `051`–`055`, short test matrix. |
| **Plan/CARGO-OPERATIONS-QTY-BALANCE-REQUIREMENTS.md** | **DRAFT (req gathering):** Cargo Operations qty / COB–QWB / balance / flow, chaining across rows, metric from SI breakdown, informative ETA (display-only). |
| **Plan/SI-VESSEL-OVERRIDE-UPDATE-PLAN.md** | **Plan (admin exception flow):** controlled Shipping Instruction vessel/ETA override for special cases (including SAILED), strict RBAC, required reason, and full audit trail. |
| **Plan/ETA-DATETIME-ONLY-IMPACT-ASSESSMENT.md** | **Assessment:** impact of moving from `eta_from`/`eta_to` + `eta` to a single SI `eta` datetime field, including API/UI/query migration risks and phased rollout guidance. |
| **Plan/I18N-EN-ID-LANGUAGE-PLAN.md** | **UI language (EN/ID):** i18next, `jps_locale`, header language switch, locale JSON + `terms` glossary, phased string migration, QA. |

For full context when starting backend or architecture work, use **TECH-SPEC-Jetty-Planning-System.md**, **Feature-Module-Summary.md**, and **technical-architecture.md** together with the PRD.

---

## 6. Recent features (high-level summary)

Details: **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** (what it does for users) · **TECH-SPEC-Jetty-Planning-System.md** (APIs, DB, code modules).

### 6.1 Jetty schedule & arrival

| Topic | In short |
|-------|-----------|
| **Gantt** | Planned vs actual lanes; **Reset** = today → +1 month; confusing **ETA→ETB** planned sliver **removed**. |
| **Bar lengths** | End dates follow **estimated vs actual completion** rules (plus defaults); **alongside** actual bar only after **TB**; **TA-only** transit uses the same completion matrix. |
| **Estimated completion** | In **Log arrival update** and **Confirm Berthing**; saved to the operation via **`PUT /allocation/arrival`**. |
| **Berthing** | **POB / TB / SOB** and **vessel photos** (like NOR uploads) persist through the same flow. |

### 6.2 Allocation & berth picture

| Topic | In short |
|-------|-----------|
| **Incoming vs berthed** | Table can filter **Incoming** / **Berthed**; jetty schematic shows **current** and **incoming** vessel names in **tooltips**. |
| **Jetty validation** | Log arrival update can block saving if the jetty is occupied, unless the incoming time is **on/after** the occupant’s **estimated or actual completion**. |
| **Tabs** | **Jetty Schematic** first, **Jetty Schedule** second; “Upcoming Schedule” tab removed. |
| **Active vessel** | Modal uses live times, phase stepper from data, **Shipping Instruction** opens in an **embedded** full SI view; **Allocation & Berthing events** section removed. |

### 6.3 At-Berth Executions

| Topic | In short |
|-------|-----------|
| **Data** | Same **`/allocation/overview`** queue as “Incoming vessel & berthing plan”, filtered to **berthed** vessels. |
| **Table** | Columns: Vessel, SI, Commodity, Purpose, Jetty, TA, TB, Phase, Status; **expand** for **Full details** (aligned with Allocation); **Open** goes to the **operation** screen. |
| **Page** | Intro and **Refresh** removed; summary cards layout fixed so Loading/Unloading groups don’t overlap. |

### 6.4 Shipping Instruction & time display

| Topic | In short |
|-------|-----------|
| **Approval ID** | Stored on the SI (**approval_id**); **Approved** SIs show the green approval id on the view page. |
| **Date/time labels** | No more **“ LT”** suffix on formatted times; shared helper **`formatDateTimeDisplay`** (see **Dev-Notes.md** and **TECH-SPEC §3.9**). |

### 6.5 Pre-Checking persistence (hybrid, in rollout)

| Topic | In short |
|-------|-----------|
| **Goal** | Make Pre-Checking saves durable in backend (instead of local in-memory state only). |
| **Model** | Hybrid approach: keep NOR milestone timestamps on **`operations`**, add dedicated NOR details, and add generalized **sub-process** storage for tabs like Key Meeting, inspections, sampling, sounding, draft survey. |
| **Editor actions** | Pre-Checking editor supports **Save Draft** (`In Progress`), **Save** (`Done`), and **Save & Next** for linear workflow. |
| **UX pattern** | Section page uses a process rail + checklist-style Pre-Checking navigator with status chips and direct Open action per step. |
| **Compatibility** | Existing `qc_surveys` / `quantity_checks` remain during migration to avoid breaking Clearance/reporting while new routes are introduced. |
| **Primary docs** | Functional behavior plan in **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §12** and technical migration/API detail in **TECH-SPEC-Jetty-Planning-System.md §3.4A / §8.2A**. |

### 6.6 NOR, uploads, activity log, shell, and local ops (2026-03)

| Topic | In short |
|-------|-----------|
| **NOR in two places** | NOR may be captured in **Allocation (Log arrival update)** before berth; NOR Accepted tab shows **the same NOR files** from `operation_documents` (`kind=NOR`) together with tab uploads. **Last Updated Via** uses NOR detail metadata when set. |
| **Uploads & `/uploads`** | API serves files from a resolved **`UPLOAD_ROOT`** (see **TECH-SPEC §3.10A**). SPA uses **`resolveUploadUrl`** and multipart helpers with timeouts. On Windows Docker, avoid fragile host bind mounts for upload dirs where possible. |
| **Activity log** | Backend writes structured **`changes`** (before/after) for allocation, operations, operation documents, sub-processes, and NOR details — see **TECH-SPEC §3.8A**. |
| **Initial Sounding / Draft Survey** | UI label **Remark**; text stored on sub-process **`remark`** (legacy payload fallback for old rows). |
| **Layout** | Sidebar navigation refresh; **Logout** in the **top bar** next to the user greeting. |
| **Empty DB after Docker fix** | New Postgres volume = empty **business** data — run **`docker exec … npm run migrate`**. Optional dev seeds: migrations **`023_seed_dev_operational_data.sql`**, **`024_seed_dev_prechecking_data.sql`**. |
| **Admin “no pages”** | **`/rbac/me/page-permissions`** needs **`user_roles`** + **`role_permissions`**; assign a role with full page access to **`admin`** on a fresh DB. |

### 6.7 Operations, clearance, and planning updates (2026-04)

| Topic | In short |
|-------|-----------|
| **Operation Detail modal** | SI detail modal is now **Operation Detail** with a compact process summary (**Pre-Checking / Operational / Post-Checking**) and **Clearance** status. Phase numbers in the modal use the same hydration + counting pipeline as the Loading hub to avoid drift. |
| **Clearance status in modal** | Modal clearance row maps operation status to user-facing labels (Pending allocation, At berth, Pending sign-off, Ready to Sail, Sailed) and shows **CAST off** / **Sailed at** when available. |
| **Shift-out / re-dock** | At-berth operations can be shifted out (required remark) to temporarily free occupancy, then re-docked from Allocation; includes toasts and activity log coverage. |
| **Operation sign-off flow** | Sign-off is split into **request** (hub edit users) and **approve** (clearance approvers), with a Pending sign-off path before Ready to Sail. |
| **Jetty Operation ID** | Operations receive an external id (`LD/UN-YY-MM-####`) and display it in Allocation, At-Berth, and Clearance before SI. |
| **Demurrage Risk Calculator** | Port-scoped voyage candidates (Incoming/Berthed), SLA scenario controls (including throughput buffer / advanced rate override), estimate preview, and save-as estimated completion for operations. |
| **Out-of-service guardrails** | OOS jetty status is enforced in master/allocation flows and reflected in schedule/schematic/dashboard cues. |
| **Dashboard additions** | Port Activity chart, Jetty status, SLA-at-risk details, and Performance KPIs (24h/7d) are documented and aligned with allocation overview rules. |
| **Multi-port shell** | Dedicated **Choose port** flow (`/select-port`) with session-scoped active port and header-based Change port behavior. |
| **At-berth and SI detail alignment** | At-berth full-details timing order is standardized; SI hyperlink opens shared modal across Shipping Instruction, Allocation, and At-Berth pages. |

---

## 7. Next steps (full application)

To turn the mockup into a full application:

1. **Backend & database** – REST API and PostgreSQL for all entities (see TECH-SPEC and technical-architecture).
2. **Authentication** – Login/session; JWT; optional SSO.
3. **Data layer** – Replace in-memory data with API calls; keep UI and context shapes where possible.
4. **RBAC enforcement** – Enforce roles/permissions on backend and frontend (route and field level).
5. **File storage** – Upload and store documents/photos; store URLs in operations, SI, clearance.
6. **Reporting** – Server-side report logic and Excel generation; optional job queue for large reports.
7. **Activity log** – Persist in DB; restrict by role/tenant if required.

Detailed implementation order is in **TECH-SPEC-Jetty-Planning-System.md** (§8 Implementation Backlog).

---

## Document history (this README)

| Change | Notes |
|--------|--------|
| 2026-04-23 | Added **§6.7** summarizing latest delivered features from the functional spec: Operation Detail modal with hub-matching phase counts + clearance mapping, shift-out/re-dock, operation sign-off flow, Jetty Operation ID rollout, demurrage calculator behavior, OOS guardrails, dashboard additions, multi-port selection, and SI detail alignment. |
| 2026-03-25 | Added **§6.6** (NOR merge, uploads/static files, activity log contract pointer, remark field, layout/logout, fresh DB + seed migrations, RBAC bootstrap). |
| 2026-03-24 | Updated §6.5 with checklist/process-rail UX and Save & Next behavior. |
| 2026-03-24 | Updated §6.5 from planned to in-rollout; added Save Draft vs Save behavior note. |
| 2026-03-24 | Added planned Pre-Checking hybrid persistence summary (§6.5) and cross-links to functional/technical migration sections. |
| 2026-03-24 | §5: **how to update docs** (functional / TECH-SPEC / README roles). §6: expanded subsections (Allocation, At-Berth, SI, datetime). §7: former “Next steps” (renumbered). |
| §5 index + §6 “Recent features” | Added **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** and a short summary of Gantt + estimated completion work. |
| §2 “Current state” | Updated to reflect backend/DB usage for allocation (no longer “frontend-only only”). |
