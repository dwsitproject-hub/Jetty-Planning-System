## Jetty Planning & Monitoring System – Technical Specification

**Version**: 1.5  
**Last Updated**: 2026-03-31  
**Author**: AI Engineering Manager (based on PRD by Rian Dharmawan)

---

## 0. Addendum (2026-03-31)

### 0.4 Dev reset + seed (transactional data only)

To support “start fresh” local testing without wiping master data, the repo includes a repeatable reset+seed script:

- **Script**: `Backend/scripts/reset-and-seed-dev.sql`
- **Run (PowerShell, from `Backend/`)**:
  - `Get-Content -Raw .\scripts\reset-and-seed-dev.sql | docker compose exec -T jps-db psql -U jps_user -d jps_db`

**Behaviour**

- **Cleans (TRUNCATE, restart identities, cascade)** transactional tables only:
  - `operations`
  - `operation_documents`
  - `operation_operational_activities`
  - `operation_sub_processes`
  - `operation_sub_process_documents`
  - `operation_nor_details`
  - `qc_documents`, `qc_surveys`
  - `quantity_checks`
  - `operation_materials`
  - `shipping_instruction_breakdown`, `shipping_instructions`
  - `activity_logs`
- **Seeds fresh demo data** using relative timestamps (`NOW() +/- ...`) so Allocation / Loading / Verification views look current immediately after reset.

**Explicitly not cleaned**

- Master/config tables (examples): `ports`, `jetties`, `metric`, `sla_config`, `standard_rates`, and SI lookup masters (`si_*`).
- RBAC/security tables: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_ports`.

## 0. Addendum (2026-03-27)

This addendum updates key requirements/implementation details.

### 0.1 Port-assignment scope (implemented target)

- Ports are not only master data; they define **user operational access scope**.
- Scope hierarchy: **Port -> Jetty**.
- Login/session behavior:
  - 0 assigned ports -> block operational access with message:
    - `No port assigned, please contact Jetty Planning System Admin`
  - 1 assigned port -> auto-enter with that port selected.
  - >1 assigned ports -> force port selection before entering operational modules.
- User can switch selected port later from header menu.
- Selected port persistence: **session only**.
- Scope enforcement applies in both frontend and backend for operational modules; Admin/Master remain configuration surfaces.

### 0.2 API additions for port assignment

- `GET /users/me/ports`
- `GET /users/:id/ports`
- `PUT /users/:id/ports`
- `GET /ports/:id/users`
- `PUT /ports/:id/users`

Operational ownership note:

- User-to-port assignment is managed from **Admin User Management**.
- `/ports/:id/users` endpoints are retained temporarily for backward compatibility and planned deprecation.

### 0.3 Clearance depart contract change

- `POST /operations/:id/depart` now requires only:
  - `cast_off_at` (required)
  - `clearance_document_url` (optional)
  - `vessel_photo_url` (optional)
- `hose_off_at` is removed from active contract and UI flow.

---

## 1. Overview

**Vision / Goal**: Digitize and streamline end-to-end jetty operations (loading and unloading) by providing:
- Real-time visibility of vessel and jetty status.
- Automated SLA calculations.
- Standardized workflows for QC, quantity checks, and clearance.

**Environments**:
- **Dev (Local)** – Vite React frontend + local API (or mocks), local DB.
- **Testing (Alicloud)** – Alicloud ECS/ACK + managed DB; test data; `.env.testing`.
- **Production (Alicloud)** – HA deployment, managed DB, monitoring; `.env.production`.

Each environment uses a separate `.env` (or `.env.*`) to configure:
- `APP_ENV`, `VITE_API_BASE_URL`, `DB_*`, `JWT_SECRET`.
- External integrations: `EXIM_API_URL`, `GOOGLE_WEATHER_API_KEY`, etc.

---

## 2. Functional Scope & Workflows

### 2.1 Main Domains & Roles

- **Domains**
  - Shipping Instructions (SI)
  - Vessel & Operations (Loading/Unloading)
  - Allocation & Berthing
  - QC / Survey
  - Quantity Check
  - Clearance & Exceptions
  - Dashboard & Reports
  - Master Data (Ports, Jetties, SLA & Rates)
  - RBAC & Audit

- **Roles**
  - Jetty Operator
  - Logistics & EXIM
  - QC Team
  - Tank Farm Team
  - PPIC / Manager
  - Admin / IT

RBAC is defined at **department**, **page**, and **field** level (see §6).

---

### 2.2 End-to-End Flows

#### 2.2.1 Shipping Instruction (SI)

**User Story**: As a Jetty Operator, I want to view incoming SIs so I can see vessel, material, and purpose details.

**Workflow (current frontend: `ShippingInstruction.jsx`, `SIApproval.jsx`, `SIView.jsx`)**:
1. SIs are listed with filters (purpose, status, search by SI, vessel, agent).
2. For each SI:
   - Show vessel, commodity, purpose (Loading/Unloading), ETA, status.
   - Expand row for full details (breakdown, documents; extended header fields as implemented).
3. Loading SIs: create/edit includes **destination**, **freight_terms**, **B/L & consignee** text fields, **voyage**, **document date**; modal shows **B/L split preview** from breakdown.
4. Internal approval (Loading + Unloading): **Submit for approval** persists **Submitted** via API; **Approve/Sign-off** requires RBAC **`can_approve`** on page `shipping-instruction` (see §6). On approve, API sets **`approved_by_user_id`**, **`approved_at`**, **snapshots**, **`approval_id`**; document view uses **reference_number** as **No.** when set.
5. Document view/approval templates:
   - **Loading** uses the full template (header + full field set).
   - **Unloading** uses a simplified template (label and layout differences).
6. UX details:
   - Mandatory fields are validated client-side and enforced server-side.
   - Action buttons are always visible but may be disabled with one-line “why disabled” tooltips.
   - Delete is supported for Draft and Submitted SIs with RBAC + status enforcement.

**Target implementation**:
- Source SIs from upstream EXIM/Logistics via `shipping_instructions` API.
- Provide a **link from SI to Operation**:
  - Action “Create Operation / Go to Allocation” should:
    - Create or open an `Operation` for this SI.
    - Navigate to Allocation view with context.

#### 2.2.1.1 SI master data (dropdown sources)

SI dropdown values are sourced from master tables and managed via Master Menu pages:

- Term
- Shipper
- Loading Port
- Surveyor
- Agent
- Commodity

Freight terms are currently fixed (frontend constant + backend validation), so the UI exposes them as a read-only master page.

#### 2.2.2 Allocation & Berthing

**User Story**: As a Jetty Operator, I update vessel positions and ETB/ETA so that berthing sequence is accurate.

**Workflow (current frontend: `Allocation.jsx`)**:
1. Allocation list shows vessels with SI, priority, purpose, ETA/ETB, jetty, remarks.
2. Operator can:
   - Log arrival updates: ETA, TA, ETB, NOR details, jetty.
   - Manage berthing sequence (up/down).
   - Confirm berthing:
     - Choose a jetty (with vacancy check).
     - Record POB/TB/SOB times.
     - Add vessel photos and remarks.
3. Visuals:
   - Jetty schematic (current occupancy).
   - 72-hour berth schedule (jetty vs time, with Expected/Berthing/Active pills).

**Target implementation**:
- Link allocation rows to backend `operations` and `jetties`.
- On berthing confirm:
  - Mark operation as `DOCKED`.
  - Set `docking_start_time` (used for SLA; see §3.3).

#### 2.2.3 At-Berth Executions

**User Story**: As Operator, I see all vessels currently at berth with their pipeline phase and can open their operational detail.

**Workflow (implemented: `AtBerthExecutions.jsx`)**:
1. Data: **`GET /allocation/overview`** → `queue` array, filtered client-side to **berthed** rows (same criteria as Allocation “Berthed” filter: TB present and/or statuses DOCKED, IN_PROGRESS, COMPLETED).
2. Summary cards: Loading / Unloading × phase counts; phase derived from **`operations.status`** (IN_PROGRESS → Operational, COMPLETED → Post-Checking, else Pre-Checking).
3. Table columns: Vessel, SI, Commodity, Purpose, Jetty, TA, TB, Phase, Status; **Action** first after expand column; expandable **Full details** aligned with Allocation row detail field order.
4. **Open** → `/{loading|unloading}/:vesselId` (purpose-based route; API rows may use `op-<operationId>` vessel id form).

**Target / follow-up**:
- Phase could later incorporate QC/quantity state from backend instead of status-only mapping.

#### 2.2.4 Loading / Unloading Operations

**User Story**: As Jetty / Tank Farm / QC, I want structured Pre-Checking, Operational, and Post-Checking flows with time, quality, and quantity information and documents.

**Workflow (current frontend: `Loading.jsx`, `Unloading.jsx`)**:

- **Entry**:
  - `/loading` or `/unloading` shows list of operations (via `getAtBerthOperations`).
  - Selecting a vessel opens hub page with:
    - Collapsible **Vessel Detail** card (operation-backed details).
    - Tabs: Pre-Checking, Operational, Post-Checking.

- **Pre-Checking**:
  - Checklist-style step navigator: Key Meeting, NOR Accepted, Tank Inspection, Hold Inspection, Sampling, Initial Sounding, Initial Draft Survey.
  - Each step displays status chip (`Not Started` / `In Progress` / `Done`) and **Open** action.
  - Each captures:
    - Date & time.
    - Document uploads.
    - Remarks.
  - Sampling also records per-palka FFA & Moisture (UI may show summary chips and formatted numeric columns; entry layout is subject to UX iteration).
  - **Initial Sounding** and **Initial Draft Survey** use the **Remark** field stored on the sub-process **`remark`** column (not `payload_json.result` for new saves).
  - Edit actions support:
    - **Save Draft** (persist as `In Progress`)
    - **Save** (persist as `Done`)
    - **Save & Next** (save current step, move to next checklist item)

- **Operational**:
  - `LoadingTabContent` logs detailed activities:
    - Category (Loading or Unloading specific).
    - Description.
    - Start & End time.
  - Activities accumulate into a table (per vessel).

- **Post-Checking**:
  - Final Tank Inspection, Final Hold Inspection, Final Sounding:
    - Result text.
    - Documents.
    - Date & time.
  - When Final Tank & Final Sounding are completed (C1/C2), UI allows “Proceed to Clearance”.

- **Unloading-specific offloading (`Unloading.jsx`)**:
  - 4 stages: Arrival & Connection, Active Discharge, Stripping & Cleaning, Line Clearance.
  - Each stage has:
    - Named milestones (e.g., Hose On, Commence, Temporary Stop, Resume).
    - “Log now” or “Log with time…” actions that create timesheet events (with optional tags for reason).
  - Stripping & Cleaning includes per-palka P/C/S status with timestamps and comments.

**Target implementation**:
- Map all these UI inputs to backend entities:
  - Pre-/Post-Checking → `qc_surveys`, `qc_documents`.
  - Sampling, sounding, draft survey, quantity results → `quantity_checks`.
  - Loading/Unloading detail activities and offloading timesheet → `operation_activities` (optional).
- Implement **loading/unloading progress vs SLA** using volumes and rates (see §3.3, §5.1).

#### 2.2.5 Clearance & Exceptions

**User Story**: As a Jetty Operator, I want to sign off a vessel only when completion is 100%; exceptions require justification & admin approval.

**Workflow (current frontend: `Verification.jsx`)**:
1. Summary cards: Ready to Sail count, Sailed count.
2. Table of vessels with purpose and clearance status.
3. “Open” shows clearance modal:
   - HOSE Off, CAST Off timestamps.
   - Document uploads & vessel photos.
   - On submit, marks vessel as `departed`.

**Target implementation**:
- Backend `operations` track `status` and `completion_percent`.
- Clearance conditions:
  - Allowed when:
    - `completion_percent == 100`.
    - Required QC and quantity checks are completed.
  - Otherwise:
    - Present **Exception** path:
      - UI collects “Justification” and documents.
      - `POST /operations/:id/request-exception`.
      - Manager/Admin approves via separate screen (`approve-exception`) before marking departed.

---

### 2.3 Dashboard & Reports

**User Story**: As a Manager, I want weekly trends (occupied jetties, demurrage, incidents) and weather.

**Workflow (current frontend: `Dashboard.jsx`)**:
- Weather widget (mock) simulating Google Weather integration.
- Top KPIs:
  - Vessels at berth.
  - Berth occupancy.
  - Average pumping rate.
  - Clearance Ready-to-Sail count.
- Pipeline view (Shipping Instruction → Allocation → At-Berth → Clearance).
- Upcoming queue and alerts (arrival-to-berth wait time, offloading SLA progress, tank levels).

**Target implementation**:
- Expose backend dashboard endpoints:
  - `GET /dashboard/summary`.
  - `GET /dashboard/weather`.
  - `GET /dashboard/demurrage`.
- Demurrage metric derived from operations whose `actual_completion_time > estimated_completion_time`.

---

## 3. API Design (Backend)

All endpoints under `/api/v1`.

### 3.1 Authentication & Users

- `POST /auth/login` – login, returns user + JWT.
- `GET /users/me` – current user profile and effective permissions.
- `GET /users`, `GET /users/:id`, `POST /users`, `PUT /users/:id`, `DELETE /users/:id` (soft) – JWT required; cannot delete self.
- **RBAC** (JWT): base path `/rbac` — `GET/POST /rbac/roles`, `GET/PUT/DELETE /rbac/roles/:id` (system roles not deletable); `GET/POST/DELETE /rbac/roles/:roleId/permissions[/:permissionId]`; `GET/POST/PUT/DELETE /rbac/permissions[/:id]`; `GET/POST/DELETE /rbac/users/:userId/roles[/:roleId]`.

### 3.2 Shipping Instructions

- `GET /shipping-instructions` – list SIs, with filters.
- `GET /shipping-instructions/:id`.
- `POST /shipping-instructions` – create (for manual entry).
- `PUT /shipping-instructions/:id` — body may include **`approval_id`** / persisted **`approvalId`** for approved flows.
- `DELETE /shipping-instructions/:id` — guarded by RBAC `can_delete` and status rules (Draft/Submitted only).

### 3.2.1 SI lookups (master dropdown CRUD)

Base: `/si-lookups`

- `GET /si-lookups/:type` – list items
- `GET /si-lookups/:type/:id` – get item
- `POST /si-lookups/:type` – create `{ value }`
- `PUT /si-lookups/:type/:id` – update `{ value }`
- `DELETE /si-lookups/:type/:id` – delete (blocked when referenced by SI or SI breakdown)

Types are whitelisted by backend config (`Backend/src/routes/si-lookups.js`) and map to the corresponding SI master tables.

### 3.3 Operations & SLA

- `GET /operations` – filter by port, jetty, status, purpose.
- `GET /operations/:id`.
- `POST /operations` – create from SI (one operation per SI + jetty).
- `PUT /operations/:id`.
- `POST /operations/:id/start-docking`
  - Body: none or optional manual `docking_start_time`.
  - Side-effects: sets `docking_start_time`, calculates SLA:
    - Load SLA config (`Q1`, `Q2`, `C`, `S_default`, `buffer_default`).
    - Load `operation_materials` and `standard_rates`.
    - Compute SLA duration:
      - \( SLA = Q1 + Q2 + C + \sum (V_n / Rate_n \times Buffer_n) + ((n-1) \times S) \).
    - Set `estimated_completion_time = docking_start_time + SLA`.
- `POST /operations/:id/recalculate-sla` – if volumes or config change.
- `POST /operations/:id/signoff` – sets `COMPLETED` + `actual_completion_time` when:
  - `exception_status === APPROVED` (skips gates), **or**
  - `completion_percent === 100`, all QC surveys `Done`, at least one Pre- + one Post-Checking `Done` (when any QC rows exist), and all Operational `quantity_checks` have `occurred_at`.
- `POST /operations/:id/request-exception` – body `justification`, optional `exception_document_url`; sets `PENDING` (before COMPLETED/SAILED).
- `POST /operations/:id/approve-exception` – body optional `approver_user_id`.
- `POST /operations/:id/reject-exception` – body optional `approver_user_id`.
- `POST /operations/:id/depart` – after signoff (`COMPLETED`); body `cast_off_at` (ISO, required), optional `clearance_document_url`, `vessel_photo_url`; sets `SAILED`, `sailed_at`.

### 3.4 QC & Quantity

- `GET /operations/:id/qc-surveys`.
- `POST /operations/:id/qc-surveys`.
- `PUT /qc-surveys/:id`.
- `GET /operations/:id/quantity-checks`.
- `POST /operations/:id/quantity-checks`.
- `PUT /quantity-checks/:id`.

### 3.4A Pre-Checking hybrid persistence (implemented + evolving)

This subsection describes the **implemented** hybrid persistence for Pre-Checking and related conventions.

#### 3.4A.1 Design decision

- Keep `operations.nor_tendered_at` and `operations.nor_accepted_at` as operational milestone fields.
- Add a dedicated NOR detail table for NOR-specific note/metadata.
- Add a generalized sub-process table for other Pre-Checking tabs using a key-based model.
- Keep existing `qc_surveys` and `quantity_checks` endpoints during migration for compatibility.

#### 3.4A.2 Proposed new data entities

- `operation_sub_processes` (generalized per operation + phase + key):
  - `id`, `operation_id`, `phase`, `sub_process_key`, `status`, `occurred_at`, `remark`, `payload_json`, audit timestamps, `deleted_at`.
  - Unique active row target: `(operation_id, phase, sub_process_key)` where `deleted_at IS NULL`.
- `operation_sub_process_documents`:
  - `id`, `sub_process_id`, file metadata fields, timestamps, `deleted_at`.
- `operation_nor_details` (dedicated NOR detail):
  - `id`, `operation_id`, `remark`, optional metadata JSON, timestamps, `deleted_at`.

#### 3.4A.3 Planned API surface

- Generalized sub-process:
  - `GET /operations/:id/sub-processes?phase=Pre-Checking`
  - `PUT /operations/:id/sub-processes/:subProcessKey` (upsert semantics)
- Sub-process documents:
  - `GET /operations/:id/sub-processes/:subProcessKey/documents`
  - `POST /operations/:id/sub-processes/:subProcessKey/documents`
- NOR details:
  - `GET /operations/:id/nor-details`
  - `PUT /operations/:id/nor-details`
- Existing NOR timestamps remain persisted by `PUT /allocation/arrival`.

Save mode semantics (Pre-Checking UI):

- **Save Draft** -> upsert sub-process with `status = 'In Progress'`.
- **Save** -> upsert sub-process with `status = 'Done'` (for completed step submission).
- For NOR Accepted:
  - timestamps persist via `PUT /allocation/arrival`,
  - NOR-specific remark/details persist via `PUT /operations/:id/nor-details`,
  - save mode/status may be mirrored in sub-process payload (`sub_process_key = 'nor_accepted'`) for unified progress tracking.

#### 3.4A.4 Tab-to-storage mapping (target)

- `key_meeting` -> `operation_sub_processes` (`phase='Pre-Checking'`, own remark/documents)
- `tank_inspection` -> `operation_sub_processes`
- `hold_inspection` -> `operation_sub_processes`
- `sampling` -> `operation_sub_processes` (`payload_json.records`)
- `initial_sounding` -> `operation_sub_processes` (**remark** column for free text; legacy rows may have text only in `payload_json.result` — frontend loads with fallback)
- `initial_draft_survey` -> `operation_sub_processes` (same **remark** convention as `initial_sounding`)
- NOR accepted tab:
  - timestamps -> `operations`
  - NOR remark/details -> `operation_nor_details`
  - NOR file attachments -> **`operation_documents`** (`kind='NOR'`) for uploads from **Allocation (Log arrival update)** and from the **NOR Accepted** tab; the Loading UI merges **`GET /operation-documents/operations/:id/NOR`** with sub-process documents so shared NOR files appear in the NOR Accepted tab.
  - Optional metadata in `operation_nor_details.payload_json` (e.g. `norSource`, `norStage`, `updatedVia`) supports **Last Updated Via** and consistent logging; `PUT /nor-details` merges payload JSON so partial updates do not wipe existing keys.

#### 3.4A.5 Migration and compatibility strategy

1. Add schema and new endpoints behind non-breaking contracts.
2. Enable write-through from `Loading.jsx` Pre-Checking Save to new endpoints.
3. Switch read path in Pre-Checking to new source of truth.
4. Keep existing `qc_surveys` / `quantity_checks` routes active until:
   - signoff/completion logic is aligned,
   - reports are verified,
   - old write paths are removed.
5. Optional: provide compatibility view/adapters for legacy reporting queries.

#### 3.4A.6 Migrations applied (baseline)

Core hybrid persistence:

1. `020_operation_sub_processes.sql`
2. `021_operation_sub_process_documents.sql`
3. `022_operation_nor_details.sql`

**Dev-only seed data** (idempotent; safe to re-run on fresh DB via `npm run migrate`):

4. `023_seed_dev_operational_data.sql` — sample `shipping_instructions`, `operations`, `operation_materials`, breakdown rows (`reference_number` prefix `SEED-SI-2026-…`).
5. `024_seed_dev_prechecking_data.sql` — sample `operation_sub_processes` for `key_meeting`, `sampling`, `initial_sounding` on those operations, plus sample `operation_sub_process_documents` metadata.

Optional future migrations (comments/views) remain out of scope until needed.

`operation_sub_processes` (generalized):

- Columns:
  - `id BIGSERIAL PRIMARY KEY`
  - `operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE`
  - `phase TEXT NOT NULL CHECK (phase IN ('Pre-Checking','Operational','Post-Checking'))`
  - `sub_process_key TEXT NOT NULL`
  - `status TEXT NULL CHECK (status IN ('Pending','In Progress','Done','N/A'))`
  - `occurred_at TIMESTAMPTZ NULL`
  - `remark TEXT NULL`
  - `payload_json JSONB NULL`
  - `created_by BIGINT NULL` (optional FK to `users`)
  - `updated_by BIGINT NULL` (optional FK to `users`)
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `deleted_at TIMESTAMPTZ NULL`
- Index/constraints:
  - unique active row: `(operation_id, phase, sub_process_key)` where `deleted_at IS NULL`
  - active read index: `(operation_id, phase)` where `deleted_at IS NULL`
  - optional key index: `(sub_process_key)` where `deleted_at IS NULL`

`operation_sub_process_documents`:

- Columns:
  - `id BIGSERIAL PRIMARY KEY`
  - `sub_process_id BIGINT NOT NULL REFERENCES operation_sub_processes(id) ON DELETE CASCADE`
  - `original_name TEXT NOT NULL`
  - `stored_name TEXT NOT NULL`
  - `stored_path TEXT NOT NULL`
  - `mime_type TEXT NULL`
  - `size_bytes BIGINT NULL CHECK (size_bytes IS NULL OR size_bytes >= 0)`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `deleted_at TIMESTAMPTZ NULL`
- Index:
  - `(sub_process_id)` where `deleted_at IS NULL`

`operation_nor_details` (dedicated NOR note/metadata):

- Columns:
  - `id BIGSERIAL PRIMARY KEY`
  - `operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE`
  - `remark TEXT NULL`
  - `payload_json JSONB NULL`
  - `created_by BIGINT NULL` (optional FK to `users`)
  - `updated_by BIGINT NULL` (optional FK to `users`)
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `deleted_at TIMESTAMPTZ NULL`
- Index/constraint:
  - one active row per operation: `(operation_id)` unique where `deleted_at IS NULL`

Target sub-process keys for Pre-Checking phase:

- `key_meeting`
- `tank_inspection`
- `hold_inspection`
- `sampling`
- `initial_sounding`
- `initial_draft_survey`

Notes:

- NOR timestamps remain in `operations` (`nor_tendered_at`, `nor_accepted_at`) for operational queries and existing Allocation/overview logic.
- NOR remark/details move to `operation_nor_details` (tab-scoped remark, no global remark coupling).
- Phase 1 does not drop or rename existing `qc_surveys` / `quantity_checks`; deprecation is post-stabilization.

### 3.5 Allocation & Jetty

**Master / jetty CRUD**

- `GET /ports`, `POST /ports`, `PUT /ports/:id`.
- `GET /jetties`, `POST /jetties`, `PUT /jetties/:id`.
- `PUT /jetties/:id/status` – status = Available / Maintenance / High-Priority / Out of Service.

#### 3.5.1 `GET /allocation/overview`

Returns `{ queue, berths }`.

- **`queue`**: union of (a) **active operations** (`status <> 'SAILED'`) joined to SI + jetty, and (b) **approved SIs without an operation**. Each row is normalised in **`formatListRow`** (`Backend/src/routes/allocation.js`).
- **Key camelCase fields** (non-exhaustive): `id`, `vesselId`, `operationId`, `shippingInstructionId`, `vesselName`, `shippingInstruction`, `commodity`, `purpose`, `priority`, `noPkk`, `remark`, `eta`, `etb`, `jetty`, `etaDateTime`, `taDateTime`, `etbDateTime`, `tbDateTime`, `pobDateTime`, `sobDateTime`, `estimatedCompletionDateTime`, `actualCompletionDateTime`, `castOffDateTime`, `status`, `norDocuments`, **`shipper`**, **`agent`**, **`surveyor`** (from `si_shippers`, `si_agents`, `si_surveyors` joins on `shipping_instructions`).
- **`eta` / `etb`**: short display strings from SQL `to_char(… AT TIME ZONE 'UTC', 'DD/MM HH24:MI')` — **no** trailing ` LT` suffix.
- **`berths`**: jetty list with occupancy derived from operations where **TB is set** and/or status in DOCKED / IN_PROGRESS / COMPLETED.

#### 3.5.2 `PUT /allocation/arrival`

- Updates the **operation** linked from the queue row: ETA, TA, ETB, POB, TB, SOB, NOR times, remark, priority, `no_pkk`, `jetty_id`, **`estimated_completion_time`**, etc.
- When **TB** is provided, sets **`status = DOCKED`** if previously PENDING / ALLOCATED / empty; syncs **`docking_start_time`** with TB where applicable.

#### 3.5.3 `GET /operations/at-berth`

Used by Dashboard and other consumers. Selection:

- `deleted_at IS NULL`, **`status <> 'SAILED'`**, and **any of**:
  - `status IN ('DOCKED','IN_PROGRESS','COMPLETED')`, or
  - **`tb IS NOT NULL`**, or
  - **`docking_start_time IS NOT NULL`**.

Ensures berthed vessels appear even if status and TB were temporarily out of sync.

### 3.6 SLA & Rates

- `GET /sla-config` / `PUT /sla-config`.
- `GET /standard-rates` / `POST` / `PUT /standard-rates/:id`.

### 3.7 Dashboard & Weather

- `GET /dashboard/summary` – pipeline counts, occupancy, SLA metrics.
- `GET /dashboard/weather?port_id=...` – proxy to Google Weather API.

### 3.8 Audit Trail

- `GET /audit-log` – admin-only, filter by entity type, user, date.

### 3.8A Activity Log Contract (Page-Level Panel)

The in-app Activity Log panel (`ActivityLogPanel`) renders expandable details only when `changes` is a non-empty array.
To keep behavior consistent across all pages/modules, backend writers MUST follow this contract when calling `writeActivityLog(...)`:

- Required:
  - `pageKey` (route/page scope: `shipping-instruction`, `allocation`, `loading`, `verification`, etc.)
  - `action` (`add` | `update` | `delete`)
  - `summary` (human-readable short sentence)
- Recommended:
  - `entityType`, `entityId`, `entityLabel`
  - `actorUserId` (when token present; optional auth allowed for write operations)
- Detail payload:
  - `changes`: array of `{ field, from, to }`
  - Use `changes` for user-facing diffs (shown in panel when expanded).
  - Use `meta` for machine/debug context only (IDs, flags, source keys); panel does not treat `meta` as detailed diff rows.

Standard logging examples:

- Upload document:
  - `action: 'add'`
  - `changes`: one row per file (`Document: null -> <filename>`)
- Remove document:
  - `action: 'delete'`
  - `changes`: (`Document: <filename> -> null`)
- Save NOR / allocation update:
  - `action: 'update'`
  - `changes`: include NOR dates, ETA/ETB/TB (if provided), jetty, remark, priority, etc.

Backward compatibility note:

- Legacy rows that only have `summary`/`meta` remain readable but may show no expandable details.
- New/updated modules should always include `changes` for parity with Shipping Instruction logging behavior.

**Diff quality (implemented)**:

- Prefer **before/after** values from the database when building `changes` (not `null -> value` when an old value existed).
- For text fields such as **Remark**, normalize empty/whitespace-only strings to a single “empty” representation when comparing so the UI does not show misleading empty chips; sub-process and NOR-detail routes apply this pattern.
- **Optional auth**: selected routes use `optionalAuth` middleware so a valid JWT sets `req.userId` for `actorUserId` in logs without changing authorization rules where `requireAuth` is still required.

**Logged areas (non-exhaustive)**:

- `PUT /allocation/arrival` — arrival/NOR/jetty/priority/remark/estimated completion diffs.
- `operation-documents` — upload/delete with per-file `changes`.
- `operation-sub-processes` — sub-process upsert (phase, status, occurred_at, remark; sampling adds consolidated **Sampling Records** string); document upload/delete; NOR details (remark + payload fields such as NOR Source / Stage / Updated Via).
- `operations` — lifecycle updates (status, completion, docking, exceptions, signoff, depart, etc.) with field-level `changes` where applicable.

### 3.9 Frontend shared utilities (date/time)

| Export | Module | Behaviour |
|--------|--------|-----------|
| `formatDateTimeDisplay` | `Frontend/src/utils/formatDateTimeDisplay.js` | Parses ISO / timestamps / `datetime-local`-like prefixes → **`dd/mm HH:mm`** in **browser local** time. If unparseable, returns string with trailing **` LT`** removed (legacy API text). Empty → `—`. |
| `stripLegacyDatetimeLt` | same | Removes trailing **` LT`** (case-insensitive) only. |

**Current import sites:** `Allocation.jsx`, `AtBerthExecutions.jsx`, `Loading.jsx`, `VesselReport.jsx`, `DailyActivitiesReport.jsx`. Prefer this module for new UI datetime display.

### 3.10 Operation documents (upload)

- `POST /api/v1/operation-documents/operations/:operationId/:kind` — multipart `files`; kinds used in UI include **`NOR`** (Log arrival update) and **`BERTHING`** (Confirm Berthing / vessel photos), stored in **`operation_documents`** with paths under uploads.

### 3.10A Static file serving (`/uploads`)

- **Upload root**: `Backend/src/paths.js` exports `UPLOAD_ROOT` from `process.env.UPLOAD_DIR` when set, otherwise `Backend/uploads` resolved from the backend package (not `process.cwd()`), so static serving and multer paths stay consistent regardless of start directory.
- **Express**: `app.use('/uploads', express.static(UPLOAD_ROOT))` in `Backend/src/index.js`.
- **Docker (local dev)**: `Backend/docker-compose.yml` may set `UPLOAD_DIR` to a container-local directory to avoid Windows host bind-mount stalls during large or concurrent writes; adjust for production (named volume or object storage strategy).
- **Frontend**: `resolveUploadUrl()` in `Frontend/src/api/client.js` prefixes relative `/uploads/...` paths with the API **origin** derived from `VITE_API_BASE_URL`, so links opened from the Vite dev server hit the API host.
- **Vite dev**: `vite.config.js` may proxy `/uploads` to the API for any remaining relative requests.

### 3.10B Multipart uploads from the SPA

- `apiPostForm(path, FormData, timeoutMs)` in `Frontend/src/api/client.js` — uses the same auth + timeout pattern as `apiGet`/`apiPut` (longer default timeout for uploads).
- `uploadOperationDocuments` and `uploadSubProcessDocuments` (`Frontend/src/api/allocation.js`, `Frontend/src/api/operations.js`) use `apiPostForm`; sub-process upload includes `phase` in the URL query as well as the form field for robustness.

---

## 4. Data Model (Relational)

Entities follow the design already outlined in the previous answer; key ones:

- `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- `ports`, `jetties`, `jetty_status_history`.
- `shipping_instructions` — includes **`approval_id`** (migration **`019`**). Migration **`025_si_loading_document_and_approve_rbac.sql`** adds Loading document fields: **`voyage_no`**, **`destination_text`**, **`freight_terms`** (check: PREPAID, COLLECT, AS_PER_CHARTER_PARTY, OTHER), **`bill_of_lading_clause`**, **`consignee_text`**, **`notify_party_text`**, **`bl_indicated`**, **`document_date`**, and approval audit: **`approved_by_user_id`**, **`approved_at`**, **`approver_name_snapshot`**, **`approver_title_snapshot`**. API exposes camelCase equivalents (e.g. **`destinationText`**, **`freightTerms`**, **`approverNameSnapshot`**).
- `users` — optional **`job_title`** (migration **`025`**) used when populating approver title snapshot (fallback: `OPERATION HEAD`).
- `role_permissions` — **`can_approve`** boolean (migration **`025`**); merged in **`GET /rbac/me/page-permissions`** as **`canApprove`** per page. Shipping Instruction approval on **PUT** `/shipping-instructions/:id` when transitioning to **Approved** requires **`can_approve`** for resource_key **`shipping-instruction`**.
- `operation_documents` — file metadata per operation (`kind`, `stored_path`, NOR/BERTHING, etc.).
- `operations`, `operation_materials`, `operation_activities` (optional).
- `qc_surveys`, `qc_documents`.
- `quantity_checks`.
- `operation_sub_processes` (generalized Pre-Checking / other phase sub-process rows).
- `operation_sub_process_documents` (files linked to sub-process rows).
- `operation_nor_details` (NOR-specific remark + metadata JSON).
- `sla_config`, `standard_rates`.
- `audit_logs`.

Indexes:
- `operations (shipping_instruction_id, status)`.
- `operations (jetty_id, docking_start_time, status)`.
- `audit_logs (entity_type, entity_id, created_at)`.

---

## 5. Non-Functional Requirements

### 5.1 Performance & SLA Metrics

- p95 API latency \< 500 ms for standard queries; \< 2s for dashboard aggregates.
- SLA computation \< 200 ms per operation.
- Track:
  - SLA vs actual completion variance per operation.
  - Total demurrage hours per week.

### 5.2 Availability, Security, Observability

- Target availability: 99.5%+ in Production.
- HTTPS in Testing and Production.
- Passwords with strong hashing, JWT for auth.
- Full audit logging of field changes and logins.
- Structured logs with correlation IDs; Alicloud monitoring and alerting.

---

## 6. RBAC Design

### 6.1 Role & Permission Model

- Roles define:
  - Department-level access (view/edit/delete).
  - Page-level access (view/edit/delete).
  - Field-level access per page (view/edit).

UI implementation (`AdminRoles.jsx`):
- **Basic**: role name, description.
- **Departments**: checkboxes for view/edit/delete by department.
- **Pages**: per-page view/edit/delete, plus **Approve SI** (fourth column) for the **Shipping Instruction** page only (`AdminRoles.jsx`).
- **Fields**: per-field view/edit within selected pages.

Backend enforcement:
- All API routes use middleware to:
  - Resolve user → roles → permissions.
  - Enforce:
    - 403 if no view permission for entity/page.
    - 403 if edit/delete requested without permission.

Frontend enforcement:
- `AuthContext` + **`RbacContext`**: page-level **`canView` / `canEdit` / `canDelete` / `canApprove`** from **`GET /rbac/me/page-permissions`** (see **`Frontend/src/context/RbacContext.jsx`**).
- Navigation and buttons:
  - Hide Admin/Master menus without page view permission.
  - Disable create/edit/delete actions when edit/delete is false.
  - Hide/disable sensitive fields based on field-level view/edit.

### 6.2 Admin → Roles UX & persistence

- Permission checkbox ticks update **local UI state only**.
- Database persistence for role permissions happens only when user clicks **Save role**.
- Roles UI supports:
  - Page list **search**
  - **Collapsible groups** (Core modules, Master – Port & Jetty, Master – Shipping Instruction)
  - Group-level bulk toggles (View all / Edit all / Delete all)
- Admin role actions (create/update/delete roles, permission changes) write to `activity_logs` and show toast notifications for success/failure.

### 6.3 New page keys (SI master menu)

New master pages have dedicated RBAC page keys (seeded by migration):

- `master-si-term`
- `master-si-shipper`
- `master-si-loading-port`
- `master-si-surveyor`
- `master-si-agent`
- `master-si-commodity`
- `master-si-freight-terms` (read-only UI; RBAC still gates view)

**Fresh database bootstrap (permissions)**:

- `GET /rbac/me/page-permissions` merges flags from **`user_roles`** → **`role_permissions`** → **`permissions`** (`resource_type = 'page'`). If the user has **no roles** or no **`role_permissions`** rows, the UI receives **no page grants** (everything appears locked).
- After migrations, ensure at least one **role** exists, assign **`role_permissions`** for all catalog pages (see migration **`014_seed_page_permissions.sql`**), and link the admin user via **`user_roles`**. For local dev, granting **Edit** on Shipping Instruction usually also sets **`can_approve`** for that page (migration **`025`** backfill); use **Admin → Roles** to adjust **Approve SI** per role.

---

## 7. Acceptance Criteria (Summary)

Selected, testable criteria:

- **Shipping Instruction**
  - Filter by purpose and status works; list shows vessel, material, purpose.
  - SI → Operation link exists; clicking opens Allocation for that SI.
  - Submit for approval persists **Submitted**; approve transition enforces **`can_approve`**; document view shows approver **snapshots** and **reference_number** on the printed form when present.

- **Allocation & Berthing**
  - Arrival update stores ETA/TA/ETB and NOR data; audit log captured.
  - Berthing cannot allocate to an occupied jetty without override (or is blocked).
  - Berthing confirm sets `docking_start_time` and triggers SLA calculation.

- **Loading / Unloading**
  - Pre-/Post-Checking sections persist QC data and documents via API.
  - Operational activities and offloading events appear in timesheet and can be edited.
  - Progress vs SLA (time or volume) visible for at least one example operation.

- **Clearance & Exceptions**
  - Clearance allowed only when operation is 100% complete and mandatory QC/quantity steps are done.
  - Exception requests capture justification and require admin approval before marking `Sailed`.

- **Dashboard**
  - Weekly counts, occupancy, and demurrage match underlying operations.
  - Weather widget gracefully handles external API failures.

- **RBAC**
  - Non-admin users cannot access Admin / Master screens directly via URL.
  - Roles configured in Admin UI are reflected in actual page and field visibility.

---

## 8. Implementation Backlog (Feature-Level)

### 8.1 Highest Priority – Operational Core & SLA

1. **Backend operations & SLA engine**
   - Implement `operations`, `operation_materials`, `sla_config`, `standard_rates` tables.
   - Implement `POST /operations/:id/start-docking` and SLA calculation per formula.
   - Expose `GET /operations/at-berth` for frontend.

2. **Wire Allocation to backend**
   - Replace `allocationPlan` mock with `/operations` data.
   - On berthing confirm, call `start-docking`.

3. **At-Berth → Loading/Unloading → Clearance linkage**
   - Resolve `vesselId` to `operation.id` on frontend.
   - Use backend operation status & SLA fields in vessel detail and dashboard.

### 8.2 QC & Quantity Persistence

4. **Implement QC APIs**
   - Backend `qc_surveys` / `qc_documents`.
   - Connect Pre-Checking & Post-Checking sections in `Loading.jsx` to these endpoints.

5. **Implement quantity check APIs**
   - Backend `quantity_checks`.
   - Map sampling, sounding, and key quantity fields into quantity check records.

6. **Completion & readiness rules**
   - Define backend rule set for “operation complete” and “ready to sail”.
   - Expose a `completion_status` field used by Clearance UI.

### 8.2A Pre-Checking hybrid migration plan (new)

17. **Schema extension**
    - Add migrations for:
      - `operation_sub_processes`
      - `operation_sub_process_documents`
      - `operation_nor_details`
    - Add FK constraints to `operations`.
    - Add unique active index on `(operation_id, phase, sub_process_key)`.

18. **API implementation**
    - Implement sub-process and NOR detail routes (GET/PUT + document upload/read).
    - Keep current QC/quantity routes untouched for compatibility.

19. **Frontend wiring**
    - `Loading.jsx` Pre-Checking:
      - Replace local-only Save with API save per sub-tab.
      - Load persisted records on page open.
      - Keep UI/UX unchanged in phase 1.

20. **Cross-module alignment**
    - Ensure clearance signoff validation reads the intended source(s) during transition.
    - Validate allocation NOR timestamps and Pre-Checking NOR details consistency.
    - Verify reporting queries/exports with new persisted data.

21. **Decommission path**
    - After stabilization, decide whether some generalized tabs should fully replace parts of `qc_surveys`/`quantity_checks`.
    - Remove duplicate write paths and update docs/tests accordingly.

22. **DDL quality gates**
    - Verify FK cascade behavior (`operation_id` and `sub_process_id`) in integration tests.
    - Verify partial unique indexes enforce one active row per key.
    - Verify soft-delete does not break uniqueness (re-insert after soft-delete).
    - Verify migration order and rollback scripts in non-prod before SIT rollout.

### 8.3 Clearance & Exception Workflow

7. **Update Clearance backend**
   - Add exception model to `operations` (reason, status, approver).
   - Implement `request-exception`, `approve-exception`, `reject-exception`.

8. **Enhance Clearance UI**
   - Disable “Submit” if backend says not ready.
   - Add “Request Exception Clearance” path with justification and upload.
   - Show pending/approved/rejected status for exceptions.

### 8.4 Dashboard & Demurrage

9. **Dashboard summary API**
   - Implement `/dashboard/summary` backed by operations.
   - Compute:
     - Occupancy.
     - Pipeline counts.
     - Demurrage hours (per operation and total).

10. **Frontend integration**
    - Replace `mockData` in `Dashboard.jsx` with live summary.
    - Add explicit “Demurrage” widget using SLA vs actual completion.

### 8.5 Master Data & Jetty Status

11. **Ports & Jetties backend**
    - Implement `/ports` and `/jetties` endpoints.
    - Connect `MasterPort` and `MasterJetty` UIs.

12. **Jetty status**
    - Extend `jetties` with status field.
    - Add status control (Available/Maintenance/High-Priority) in Master or dedicated Ops page.
    - Use status in Allocation & schedule to warn/block allocations.

### 8.6 RBAC Enforcement

13. **Backend RBAC enforcement**
    - Implement roles, permissions, and middleware to guard all APIs.

14. **Frontend permission-aware navigation**
    - Add `AuthContext` and wire current user.
    - Hide or disable menus and actions based on page/field permissions.

### 8.7 Hardening & Non-Functional

15. **Audit trail**
    - Implement `audit_logs` and log key operations: SI changes, allocation, berthing, QC, clearance, RBAC changes.

16. **Performance & monitoring**
    - Add metrics and logs for SLA calculations, dashboard queries, and external calls.

