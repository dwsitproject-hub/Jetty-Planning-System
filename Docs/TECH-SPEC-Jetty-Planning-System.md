## Jetty Planning & Monitoring System – Technical Specification

**Version**: 1.44
**Last Updated**: 2026-06-12  
**Author**: AI Engineering Manager (based on PRD by Rian Dharmawan)

---

## 0. Addendum (2026-03-31)

### 0.33 Inbound Shipping Instruction integration API (`/api/v1/integrations`) (2026-06-12)

**Purpose:** Machine-to-machine API for external partners (EOS Export/Import, KLIPS, etc.) to submit **Shipping Instructions** into JPS. Creates real **`shipment_plans`** + **`shipping_instructions`** + breakdown rows; operators review via existing **`shipment-plan`** approval UI. Partner contract: **Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md**; local test walkthrough: **Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-API-TEST-GUIDE.md**. Functional behaviour: **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.23**.

**Mount (`Backend/src/index.js`):**

- **`apiV1.use('/integrations', integrationsRoutes)`** — registered **before** **`csrfProtection`** and **before** JWT-gated routes. Partner clients use **`x-api-key`** only (no cookie session, no CSRF).

**Database (migrations):**

| Migration | Objects |
|-----------|---------|
| **`084_integration_partner_api.sql`** | **`integration_api_keys`** (`partner_name`, `key_prefix`, `key_hash` SHA-256 hex, `allowed_port_ids BIGINT[]` — **deprecated/unused**, keys are not port-scoped, `active`, `last_used_at`); **`integration_submissions`** (`api_key_id`, `external_reference`, `shipping_instruction_id`, `shipment_plan_id`, `payload JSONB`, `received_at`; **`UNIQUE (api_key_id, external_reference)`** for idempotency). |
| **`085_shipment_plan_integration_source.sql`** | **`shipment_plans.external_reference`**, **`shipment_plans.requested_by`** (TEXT, nullable); index on **`external_reference`** where not null. |
| **`086_si_commodity_short_name.sql`** | **`si_commodities.short_name`** (TEXT NOT NULL, unique among active rows on **`LOWER(short_name)`**). Integration API resolves **`cargo_type`** against this column. |

**Key provisioning:**

- **`node scripts/create-integration-api-key.mjs --partner "EOS-EXPORT"`** — generates **`jps_live_<hex>`**, stores hash only, prints plaintext once. Keys are not port-scoped.
- **`--list`**, **`--deactivate <id>`** for ops.

**Auth middleware — `Backend/src/middleware/integration-auth.js`:**

- Header **`x-api-key`** → SHA-256 lookup in **`integration_api_keys`** (`active`).
- Sets **`req.integrationKey = { id, partnerName, allowedPortIds }`** (**`allowedPortIds`** retained for compatibility but no longer enforced — keys are not port-scoped).
- Rate limit **120 req/min** per key (`express-rate-limit`, env **`INTEGRATION_RATE_LIMIT_PER_MINUTE`**).
- Response envelope: **`{ success: true, data }`** / **`{ success: false, error: { code, message, details }, request_id }`**.

**Routes — `Backend/src/routes/integrations.js`:**

| Method | Path | Behaviour |
|--------|------|-----------|
| **`POST`** | **`/shipping-instructions`** | Validates payload (vessel, purpose, eta, cargo lines with **`cargo_type`** → **`si_commodities.short_name`** (case-insensitive, normalized uppercase), **`unit`** → **`metric.code`**). **`port_id`** must be a valid (non-deleted) **`ports`** row; unknown port → **400** **`VALIDATION_ERROR`**. Keys are **not** port-scoped. Transaction: insert **`shipment_plans`** (`approval_status` **`Submitted`**, **`external_reference`**, **`requested_by`** = payload **`requested_by`** or **`partnerName`**), **`shipping_instructions`** (`status` **`Submitted`**), **`shipping_instruction_breakdown`**, **`integration_submissions`**. Triggers **`shipment_plan.submitted`** notification + activity log. Returns **201** with partner status **`Pending`**. Duplicate **`external_reference`** → **409** **`DUPLICATE_REFERENCE`**. Unknown **`cargo_type`** → **400** with **`valid_cargo_types`** listing active **`short_name`** values. |
| **`GET`** | **`/shipping-instructions/:id`** | Lookup by SI id scoped to caller’s **`api_key_id`** via **`integration_submissions`**. |
| **`GET`** | **`/shipping-instructions?external_reference=`** | Same payload shape; lookup by partner reference. |

**External status derivation (partner-facing):**

| Partner status | Internal rule |
|----------------|---------------|
| **`Pending`** | Plan not **Rejected**; no operation beyond **`PENDING`**; plan not **Approved** (or still **Submitted**). |
| **`Approved`** | **`shipment_plans.approval_status` = `Approved`**; no allocated operation yet. |
| **`Rejected`** | Plan **`approval_status` = `Rejected`**; includes **`rejection_reason`**. |
| **`Allocated`** | Active **`operations`** row with **`status` ≠ `PENDING`**; returns **`allocation.jetty_name`**, **`planned_berthing_time`** (`docking_start_time`). |

**Manual plan create — `requested_by` on `shipment_plans`:**

- **`Backend/src/lib/resolve-requested-by.js`** — **`resolveUserRequestedBy(db, userId)`** → **`users.display_name`** or **`users.username`**.
- Set on **`POST /shipment-plans`** (`Backend/src/routes/shipment-plans.js`) and on implicit plan create in **`POST /shipping-instructions`** when no **`shipment_plan_id`** (`Backend/src/routes/shipping-instructions.js`).
- **`external_reference`** remains **null** for manual creates (integration-only).
- **`requested_by`** is **not** updated on plan edit — captures **initiator at create time** only.

**Internal API — shipment plan list (`Backend/src/routes/shipment-plans.js`):**

- **`toPlanListRow`** exposes **`externalReference`**, **`requestedBy`** from **`sp.*`** (list/detail SQL already selects plan columns).

**Frontend — `Frontend/src/pages/ShipmentPlansList.jsx`:**

- Table columns after **ETA**: **External reference**, **Requested by**; client-side filters **`externalReference`**, **`requestedBy`**.
- i18n **`colExternalReference`**, **`colRequestedBy`**, **`filterExternalReference`**, **`filterRequestedBy`** in **`Frontend/src/locales/en/shipmentPlan.json`** and **`id/shipmentPlan.json`**.

**Error codes (integration envelope):** **`INVALID_API_KEY`**, **`VALIDATION_ERROR`**, **`DUPLICATE_REFERENCE`**, **`NOT_FOUND`**, **`RATE_LIMITED`**, **`INTERNAL_ERROR`**.

### 0.32 Overview tables — Commodity Qty column (`siBreakdownDisplay`) (2026-05-26)

**Purpose:** Show **SI-declared cargo** (commodity name + quantity per breakdown line) in main overview tables without opening SI modals. A single **Commodity Qty** column replaces a separate **Commodity** + **Total Qty** pair because each cell already embeds the commodity name (e.g. `RPO 5.000 MT`).

**Data source:** Active rows in **`shipping_instruction_breakdown`** (`commodity_id`, `metric_id`, `qty`, `line_order`) joined to **`si_commodities`** and **`metric`**.

**Shared formatter — `Backend/src/lib/siBreakdownDisplay.js`:**

| Function | Role |
|----------|------|
| **`formatSiCargoDisplay(breakdownRows)`** | Groups lines by **`commodity_id`**; within each group sums **`qty`** per **`metric_id`** (separate subtotals if mixed units on one commodity). Formats qty with **`id-ID`** locale and **`metric.code`**. Returns **`commodityDisplay`** (distinct names joined ` · `) and **`totalQtyDisplay`** (per-commodity strings like `RPO 5.000 MT`, joined with **`\n`**). |
| **`loadBreakdownBySiIds(pool, siIds)`** | Single batch query for many SIs (avoids N+1). |
| **`enrichRowsWithCargoDisplay(pool, rows)`** | Attaches **`commodity_display`**, **`total_qty_display`**, **`cargo_breakdown_summary[]`** to SQL rows before JSON mapping. |
| **`buildCargoBreakdownSummary(siId, ref, breakdown)`** | One summary object per SI: `{ shippingInstructionId, referenceNumber, commodityDisplay, totalQtyDisplay }`. |

**Unit test:** **`npm run test:si-breakdown-display`** (`Backend/scripts/test-si-breakdown-display.mjs`).

**API — allocation overview (`Backend/src/routes/allocation.js`):**

- After **`operationsOverviewSql`** / incoming-SI queries, **`buildAllocationOverviewPayload`** calls **`enrichRowsWithCargoDisplay`** on ops, schedule ops, and incoming SI rows (parallel batch).
- **`formatListRow`** exposes camelCase: **`commodityDisplay`**, **`totalQtyDisplay`**, **`cargoBreakdownSummary`**; **`commodity`** prefers **`commodity_display`** for backward compatibility.
- Endpoints: **`GET /allocation/overview`**, **`GET /allocation/plan-overview`** (same payload builder).

**API — operations list (`Backend/src/routes/operations.js`):**

- **`GET /operations`** (incl. Clearance status filters) and **`GET /operations/pending-signoff-requests`** enrich rows before **`toOp()`**.
- **`toOp`** adds **`commodityDisplay`**, **`totalQtyDisplay`**, **`cargoBreakdownSummary`** (legacy **`cargoSiQty`** / **`cargoSiMetricCode`** remain for other consumers).

**API — shipment plan list (`Backend/src/routes/shipment-plans.js`):**

- List SQL **`si_children_json`** breakdown objects now include **`qty`**, **`metric_id`**, **`metric_code`** (JOIN **`metric`**).
- **`parseSiChildrenJson`** maps **`commodityQtyDisplay`** per child SI via **`formatSiCargoDisplay`**.

**Frontend:**

| Module | Role |
|--------|------|
| **`Frontend/src/utils/siCargoTableDisplay.jsx`** | **`renderCommodityQtyCell(row)`** — **`white-space: pre-line`** via **`.si-cargo-qty-cell`**; stacked multi-SI via **`planQueueSiEntries[].totalQtyDisplay`**. |
| **`Frontend/src/styles/allocation.css`** | **`.si-cargo-qty-cell { white-space: pre-line; }`** |
| **`Frontend/src/pages/Allocation.jsx`** | Column **`commodityQty`** after **`shippingInstruction`**; i18n **`colCommodityQty`**. |
| **`Frontend/src/pages/AtBerthExecutions.jsx`** | Same column; group header shows **`totalQtyDisplay`** or localized **Mixed**. |
| **`Frontend/src/pages/Verification.jsx`** | SI column reference-only; **`commodityQty`** column; merged plan rows join qty with **`\n`**. |
| **`Frontend/src/pages/ShipmentPlansList.jsx`** | Column after SI refs; stacked **`si.commodityQtyDisplay`** per child SI. |
| **`Frontend/src/utils/allocationPlanPovMerge.js`** | **`planQueueSiEntries[]`** includes **`commodityDisplay`**, **`totalQtyDisplay`** per SI. |

**i18n:** **`colCommodityQty`** / **`clearanceColCommodityQty`** (EN/ID) in **`allocation.json`**, **`atBerth.json`**, **`pages.json`**, **`shipmentPlan.json`**.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.21**.

**Update to §0.29 shipment-plan list breakdown:** **`GET /shipment-plans`** embeds **`qty`**, **`metric_id`**, **`metric_code`** in list **`breakdown[]`** (in addition to commodity/shipper fields documented in **§0.29**).

### 0.27 Self-service change password — `PUT /users/me/password` (2026-05-19)

**Purpose:** Authenticated **local** users change their own password without admin involvement. SSO-only accounts (`auth_source = 'sso'`) cannot use this endpoint; the UI hides **Change Password** in the header menu.

**API — `Backend/src/routes/users.js` (before admin `router.use(...requireAdminPageView)`):**

- **`PUT /api/v1/users/me/password`** — `requireAuth` only (not admin-gated).
- Body (snake_case): **`current_password`**, **`new_password`**.
- Validation:
  - **`current_password`** required.
  - **`new_password`** required, min **6** characters (same rule as admin **`POST /users`** / **`PUT /users/:id`** optional password).
  - **`new_password`** must differ from **`current_password`** → **400**.
- Load user: **`password_hash`**, **`auth_source`**, **`is_active`**.
  - Inactive → **403**; missing row → **404**.
  - **`auth_source !== 'local'`** → **403** `{ error: 'Password cannot be changed for SSO accounts' }`.
  - **`bcrypt.compare`** on current → **401** `{ error: 'Invalid current password' }` + **`logAuthEvent('local.password.change.failure', …)`**.
- Success: **`bcrypt.hash`** (cost **10**), **`UPDATE users SET password_hash, updated_at`**, **`logAuthEvent('local.password.change', { userId, ip })`**, **204** (no body).
- Session cookies are **not** invalidated on success (user stays logged in).

**Frontend:**

- **`Frontend/src/components/UserMenu.jsx`** — top-bar trigger (display name + initials); dropdown with name, email, **Change Password** (when **`fetchMySsoStatus()`** → **`authSource === 'local'`**), **Logout** (callback to existing **`handleLogout`** in **`Layout.jsx`**). Click-outside + **Escape** to close (pattern aligned with **`NotificationBell.jsx`**).
- **`Frontend/src/components/ChangePasswordModal.jsx`** — overlay modal; client validation; **`changeMyPasswordApi`**; success banner then auto-close.
- **`Frontend/src/components/PasswordField.jsx`** — password input + visibility toggle.
- **`Frontend/src/api/usersApi.js`** — **`changeMyPasswordApi({ currentPassword, newPassword })`** → **`apiPut('/users/me/password', { current_password, new_password })`** (CSRF + cookie session per **§0.10**).
- **`Frontend/src/components/Layout.jsx`** — replaces inline greeting + logout button with **`<UserMenu me={me} onLogout={handleLogout} />`** when **`me`** is set.
- Styles: **`Frontend/src/styles/user-menu.css`**, **`modal.css`** (`.modal__header`, `.modal__close`, `.password-field__*`).
- i18n: **`Frontend/src/locales/en/common.json`**, **`id/common.json`** — namespace key **`changePassword.*`**.

**Admin password reset unchanged:** **`PUT /api/v1/users/:id`** with optional **`password`** remains **admin-only** and does not require the user’s current password.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.16**, **§14**.

### 0.26 Jetty Live CCTV — `jetties.rtsp_link` + `rtsp-stream-viewer` (2026-05-21)

**Purpose:** Per-jetty optional RTSP URLs for live CCTV; browser playback via a host-side stream helper (FFmpeg → MPEG1 WebSocket), not embedded in the API container. Opened from **Allocation → Jetty schematic** (popup **`/jetty-live`**), not a dedicated sidebar page.

**Database (migration `077_jetties_rtsp_link.sql`):**

- Column **`jetties.rtsp_link`** (`TEXT`, nullable) — full RTSP URL including credentials when required by the camera.
- Rollback: **`Backend/rollback/077_rollback_jetties_rtsp_link.sql`**.

**RBAC (migration `078_retire_jetty_live_page_permission.sql`; supersedes `072`):**

- Standalone page key **`jetty-live`** is **retired** (soft-deleted). Existing **`jetty-live` can_view** grants are migrated to **`at-berth` can_approve**.
- **View Jetty Live stream** is configured in **Admin → Roles** as an **`can_approve`** sub-checkbox under **At-Berth Executions** (same UX pattern as **Approve shipment plan** under Shipment Plan).
- Schematic camera buttons and **`/jetty-live`** viewer gate on **`useRbac().canApprove('at-berth')`**. Master RTSP configuration remains under **`master-jetty`** edit.

**API — `Backend/src/routes/jetties.js`:**

- **`GET /jetties`**, **`GET /jetties/:id`**, **`POST /jetties`**, **`PUT /jetties/:id`** include **`rtsp_link`** in SQL; JSON camelCase **`rtspLink`** (`null` when unset).
- **`normalizeRtspLink`:** trim; empty → `null`; max **512** characters → **400** if exceeded.
- **`PUT`** activity log may record **RTSP link** field changes.

**Frontend:**

- **`Frontend/src/pages/MasterJetty.jsx`** — optional **RTSP link (CCTV)** on add/edit; **`MAX_RTSP_LINK_CHARS`** from **`inputLimits.js`**.
- **`Frontend/src/components/JettySchematic.jsx`** — **`canApprove('at-berth')`** gates **`renderCctvButton`**; opens **`/jetty-live?rtsp=…&label=…`** in a new tab.
- **`Frontend/src/pages/JettyLive.jsx`** — same **`canApprove('at-berth')`** gate; **`POST`** stream **`/api/reconnect`** with **`rtspUrl`** before JSMpeg attach.
- **`Frontend/src/pages/AdminRoles.jsx`** — **View Jetty Live stream** sub-row under **At-Berth Executions**.
- Route: **`Frontend/src/App.jsx`** — **`/jetty-live`** (no sidebar nav entry in **`Layout.jsx`**).

**Stream helper — `rtsp-stream-viewer/`** (separate Node process on app host): see **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**.

- **On-demand FFmpeg:** starts when the first WebSocket viewer connects to **`/jetty-live-ws`**; stops **`STREAM_IDLE_STOP_MS`** (default **30 s**) after the last viewer disconnects. Node + WS server stay up under systemd; idle health shows **`ffmpegRunning: false`**, **`viewerCount: 0`**.
- **Output rate:** **`STREAM_OUTPUT_FPS`** (default **1**) via **`-vf fps=`**; **`STREAM_MPEG1_RATE=25`** for the mpeg1video encoder; **`STREAM_SCALE=640:-1`** for HEVC/H.265 cameras.
- **`GET /api/health`** includes **`viewerCount`**, **`outputFps`**, **`idleStopMs`** in addition to status / restart count.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.15**.

### 0.28 Master data list tables — client sort and filter (2026-05-22)

**Purpose:** Consistent **client-side** column sorting and per-column text filtering on **Master Menu** list pages, matching the Allocation / Shipping Instruction table pattern (no new API query parameters).

**Shared frontend modules:**

| Module | Role |
|--------|------|
| **`Frontend/src/utils/sortableFilterableTable.js`** | Pure **`filterRows`**, **`sortRows`**, **`filterAndSortRows`**; optional per-column **`getFilterValue`** (defaults to stringified **`getSortValue`**). |
| **`Frontend/src/hooks/useSortableFilterableRows.js`** | React state: **`filters`**, **`sortState`**, **`displayRows`**, **`updateFilter`**, **`handleSort`** (toggle asc/desc on same column key). |
| **`Frontend/src/components/SortableFilterableTableHead.jsx`** | Renders sort buttons + filter inputs in **`<thead>`** using **`allocation-table__sort`**, **`allocation-table__filter-row`**, **`allocation-table__filter`** from **`allocation.css`**. Supports **`leadingBlankCols`** / **`trailingBlankCols`** for non-data columns (e.g. **Actions** on the right). |

**Pages wired:**

| Page | File | Default sort | Notes |
|------|------|--------------|--------|
| Master – Port | `MasterPort.jsx` | `name` asc | Columns: name, scheduleTimezone, description |
| Master – Preferred Jetty | `MasterJetty.jsx` | `port` asc | Replaces fixed client sort by port+order only |
| Term, Shipper, Loading Port, Surveyor, Agent, Commodity | `MasterSiLookup.jsx` (props per route) | `value` asc | Dynamic columns: value; commodity **Type** + rate fields when `enableStandardRateFields`; **no `sortOrder` column in UI** |
| Master – Freight Terms | `MasterFreightTerms.jsx` | `code` asc | Static enum rows; read-only |

**SI lookup — `sort_order` vs UI:**

- **`GET /si-lookups/:type`** (and aggregate **`GET /si-lookups`**) still **`ORDER BY sort_order`** in SQL (`Backend/src/routes/si-lookups.js`); JSON may include **`sortOrder`**.
- Admin **MasterSiLookup** tables **do not** render, sort, or filter on **Sort order**; dropdown order elsewhere still follows API **`sort_order`**.
- New creates still set **`sort_order`** on insert (backend default **0**); no admin UI to edit sort order.

**Filter inputs:** Not subject to **`inputLimits.js`** caps (same as Allocation / SI list filters). See FUNCTIONAL-SPEC **§2.11** note.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.17**.

### 0.29 Dashboard V2 — Purpose and Commodity Type filters (2026-05-22)

**Purpose:** The live dashboard (`/`, **`DashboardV2.jsx`**) adds **Purpose** and **Commodity Type** multi-select filters beside the date range. Most metrics filter **client-side** on data already fetched for the selected port and date window; **Weekly trends** filter **server-side** via **`GET /dashboard-v2/weekly-trends`**.

**Frontend modules:**

| Module | Role |
|--------|------|
| **`Frontend/src/pages/DashboardV2.jsx`** | Filter state (`selectedPurposes`, `selectedCommodityIds`); **`refresh()`** (plans, ops, at-berth, allocation, jetties) on port/date change; **`refreshWeekly()`** on port/date/**filter** change; derived **`filteredPlans`**, **`filteredOps`**, **`filteredAtBerth`**, slot occupancy via filtered berth occupants. |
| **`Frontend/src/utils/dashboardFilters.js`** | **`planMatchesFilters`**, **`opMatchesFilters`**, **`filterPlans`**, **`filterOps`**, **`buildPlanCommodityIndex`**, **`extractCommodityOptionsFromMaster`**, **`buildCommodityNameById`**, **`buildCommodityIdByName`**, **`pruneInvalidCommoditySelection`**. |
| **`Frontend/src/components/DropdownMultiSelect.jsx`** | Reusable multi-select; optional **`titleLabel`** → trigger **Purpose (n)** / **Commodity Type (n)**; **`emptyText`**; panel open animation via **`.is-open`**. |
| **`Frontend/src/components/DashboardV2WeeklyTrends.jsx`** | Props **`refreshing`**, **`filtered`**; **Updating charts…** status; filtered hint text when filters active. |
| **`Frontend/src/api/dashboardV2.js`** | **`fetchDashboardV2Weekly({ startDate, endDate, purposes, commodityIds })`**. |
| **`Frontend/src/api/siLookups.js`** | **`fetchSiLookups()`** → master **`commodities`** for dropdown labels. |
| **`Frontend/src/styles/dashboard.css`** | **`.v2-filters`**, **`.v2-filter-empty-banner`**, **`.v2-weekly--refreshing`**. |

**Filter semantics:**

- Empty selection in a category → no constraint.
- Multiple values in one category → **OR**.
- Purpose + Commodity together → **AND**.
- **Purpose:** match **`shipment_plans.purpose_id`** → **`purposeCode`** on plans; **`operations.purpose`** on ops.
- **Commodity:** match **`shipping_instruction_breakdown.commodity_id`** on plan child SIs (list payload **`breakdown[]`**) and/or operation **`commodity`** name fallback via master id map.

**Data fetches (dashboard `refresh()`):**

| Endpoint | Query | Used for |
|----------|-------|----------|
| **`GET /shipment-plans`** | `start_date`, `end_date` | Pipeline, performance (plan-side), commodity index |
| **`GET /operations`** | `start_date`, `end_date` | Pipeline, SLA, turnaround, at-berth clearance stats |
| **`GET /operations/at-berth`** | (live snapshot) | At berth now |
| **`GET /allocation/overview`** | — | Slot occupancy berths/occupants |
| **`GET /jetties`** | port id | Jetty status (**unfiltered**) |
| **`GET /si-lookups`** | — | Master commodity dropdown |
| **`GET /dashboard-v2/weekly-trends`** | `start_date`, `end_date`, optional **`purpose`**, **`commodity_id`** | Weekly trends only |

**Backend — weekly trends filters (`Backend/src/routes/dashboard-v2-weekly.js`):**

- Mount: **`/api/v1/dashboard-v2`** (`requireAuth`, `requirePortScope`).
- **`GET /dashboard-v2/weekly-trends`**
  - Required: **`start_date`**, **`end_date`** (YYYY-MM-DD).
  - Optional (repeatable or comma-separated): **`purpose`** (`Loading` \| `Unloading`), **`commodity_id`** (positive int, **`si_commodities.id`**).
  - **`parseDashboardFilters(req)`** → `{ purposeCodes, commodityIds }` (null when omitted).
  - Filter SQL applied to **`berthOccupiedPlansAt`**, **`countApprovedPlansInRange`**, **`countSailedPlansInRange`**, **`slaAtRiskAtSnapshot`** via **`EXISTS`** on plan purpose and SI breakdown.
  - **`totalSlots`** (jetty capacity denominator for occupancy %) remains **unfiltered** port capacity; occupied numerators respect filters.

**Backend — shipment plan list commodity breakdown (`Backend/src/routes/shipment-plans.js`):**

- **`GET /shipment-plans`** list embeds per-SI **`breakdown`** in **`si_children_json`**: `{ commodity_id, commodity_name, commodity_type, metric_id, metric_code, qty, shipper_id, shipper_name }[]` from **`shipping_instruction_breakdown`** (JOIN **`metric`**; LEFT JOIN **`si_shippers`**).
- **`parseSiChildrenJson`** maps to **`shippingInstructions[].breakdown[]`** with **`commodityId`**, **`commodityName`**, **`commodityType`**, **`metricId`**, **`metricCode`**, **`qty`**, **`shipperId`**, **`shipperName`**, plus **`commodityQtyDisplay`** (formatted per **§0.32**) for list tables and dashboard commodity index.

**Deploy note:** Weekly trends filtering requires a backend build that includes **`dashboard-v2-weekly.js`** filter changes. Frontend-only deploy updates pipeline/KPI/at-berth filtering but not weekly charts until the API is restarted/redeployed.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.18**.

### 0.30 Uploaded document preview — `/view` routes and `FilePreviewModal` (2026-05-25)

**Purpose:** Replace immediate browser download when users click uploaded file links. Persisted files open in a **shared preview modal** (images inline, PDF in iframe). **Download** and **Open in new tab** remain explicit footer actions.

**Problem addressed:** List APIs return **`/download`** URLs (`Content-Disposition: attachment`). Plain `<img src>` / `<iframe src>` cannot send **`X-Selected-Port-Id`**, which **`requirePortScope`** requires for users with multiple assigned ports. The SPA therefore **fetches file bytes with authenticated headers** and displays them via temporary **`blob:`** URLs for API-backed files.

**Backend — inline view routes** (`Backend/src/lib/send-stored-file.js`):

| Route | File | Disposition |
|-------|------|-------------|
| `GET /api/v1/operation-documents/:id/view` | `Backend/src/routes/operation-documents.js` | `inline` |
| `GET /api/v1/operation-documents/:id/download` | same | `attachment` (unchanged) |
| `GET /api/v1/sub-process-documents/:documentId/view` | `Backend/src/routes/operation-sub-processes.js` | `inline` |
| `GET /api/v1/sub-process-documents/:documentId/download` | same | `attachment` |
| `GET /api/v1/si-documents/:id/view` | `Backend/src/routes/si-documents.js` | `inline` |
| `GET /api/v1/si-documents/:id/download` | same | `attachment` |

- Shared helpers: **`sendStoredFileInline`**, **`sendStoredFileAttachment`**, **`mimeFromFilename`**, **`safeContentDispositionFilename`**.
- Same auth stack as existing download routes: **`requireAuth`**, **`requirePortScope`** (mounted on `/api/v1/...` in `Backend/src/index.js`).
- **`GET /uploads/...`** (static, **§3.10A**) remains unauthenticated inline; preview uses direct URL when not an API document path.

**SI Approval attachments:** **`GET /shipping-instructions/:id`** includes a **`documents`** array (`id`, `name`, `mimeType`, `sizeBytes`, `downloadUrl`) from **`shipping_instruction_documents`** (`Backend/src/routes/shipping-instructions.js`).

**Frontend modules:**

| Module | Role |
|--------|------|
| **`Frontend/src/context/FilePreviewContext.jsx`** | App-wide **`openFilePreview({ url, name, mimeType })`**; mounts **`FilePreviewModal`**. Wrapped in **`App.jsx`** inside **`PortScopeProvider`**. |
| **`Frontend/src/components/FilePreviewModal.jsx`** | Preview UI: header (filename + close), body (image / PDF iframe / unsupported message), footer (**Open in new tab**, **Download**). |
| **`Frontend/src/components/FilePreviewLink.jsx`** | Drop-in replacement for document name anchors. |
| **`Frontend/src/components/AuthenticatedFileImage.jsx`** | Thumbnails for API-backed images (berthing photos); fetches with auth before render. |
| **`Frontend/src/utils/filePreview.js`** | **`toViewUrl`** / **`toDownloadUrl`** (maps `.../download` → `.../view`); **`resolvePreviewSrc`**; **`triggerFileDownload`**. |
| **`Frontend/src/api/client.js`** | **`fetchAuthenticatedBlobUrl(absoluteUrl)`** — `credentials: 'include'`, **`authHeaders({ Accept: '*/*' })`** including **`X-Selected-Port-Id`**. |
| **`Frontend/src/api/siDocuments.js`** | **`siDocumentViewUrl(id)`**. |
| **`Frontend/src/styles/file-preview.css`** | Modal layout (`.modal--file-preview`, preview image/iframe). |
| i18n **`Frontend/src/locales/{en,id}/filePreview.json`** | Modal strings. |

**Integrated surfaces:** see FUNCTIONAL-SPEC **§2.19** — **`Allocation.jsx`**, **`Loading.jsx`**, **`Verification.jsx`**, **`ShippingInstructionDocumentUploadSection.jsx`**, **`SIApproval.jsx`**, **`OperationActivityTimeline.jsx`**.

**Out of scope:** generated CSV/Excel exports, SI print/PDF (`window.print()`), upload-only filename lists without persisted URLs.

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.19**.

### 0.31 SI shipper at breakdown line level (2026-05-25)

**Purpose:** One Shipping Instruction can assign a **different shipper per commodity / contract line**. Shipper is no longer a single header field on **`shipping_instructions`**.

**Migration:** **`079_si_breakdown_shipper_id.sql`**

- Adds **`shipping_instruction_breakdown.shipper_id`** (`BIGINT`, nullable FK → **`si_shippers.id`**).
- **Backfill:** copies legacy **`shipping_instructions.shipper_id`** to **every active breakdown row** on that SI (preserves old single-dropdown behaviour on existing data).
- Secondary backfill: matches legacy **`shipper_text`** on breakdown lines to **`si_shippers.name`** where possible.
- Drops **`shipping_instructions.shipper_id`** and **`shipping_instruction_breakdown.shipper_text`**.
- Rollback: **`Backend/rollback/079_rollback_si_header_shipper.sql`** (restores header column from first breakdown line per SI).

**Deploy order:** Run **079** before or with an API build that reads/writes **`breakdown[].shipperId`**. Running **079** against an old API (still querying **`si.shipper_id`**) causes **500** errors on allocation and shipment-plan list routes until the API container is rebuilt.

**API — `POST` / `PUT /shipping-instructions`:**

- **Remove** top-level **`shipper_id`** from accepted body. If present → **400** (`shipper_id must be set on each breakdown row, not on the shipping instruction header`).
- **Add** optional **`shipperId`** / **`shipper_id`** on each **`breakdown[]`** row; validated against active **`si_shippers`** when non-null.
- Shipper remains **optional** per row (same as prior header behaviour).

**API — `GET /shipping-instructions`, `GET /shipping-instructions/:id`:**

- **Remove** top-level **`shipperId`** / **`shipperName`** from SI header JSON.
- **Add** per breakdown row: **`shipperId`**, **`shipperName`** (JOIN **`si_shippers`**).
- **Add** aggregated **`shipperNames`** on list/detail (distinct shipper names, comma-separated) for tables and read-only views.

**API — allocation / plans:**

- **`GET /allocation/overview`**, **`GET /allocation/plan-overview`**: queue row **`shipper`** = comma-separated distinct names from breakdown lines (`STRING_AGG` subquery), not a join on **`si.shipper_id`**.
- **`GET /shipment-plans`**: nested **`shippingInstructions[].breakdown[]`** includes **`shipperId`** / **`shipperName`**; header **`shipperId`** removed from child SI JSON.
- **`DELETE /si-lookups/shippers/:id`**: blocked when referenced by **`shipping_instruction_breakdown.shipper_id`** (in addition to any legacy header checks removed by **079**).

**Frontend (plan-linked SI — primary path):**

- **`Frontend/src/components/ShippingInstructionSiLinkedFields.jsx`** — Shipper **`<select>`** is the **first column** of the **Shipment breakdown** table (not **Party & port**).
- **`Frontend/src/utils/siPlanLinkedDraft.js`** — **`shipperId`** on each breakdown row; removed from form root; payload builder sends **`shipperId`** inside **`breakdown[]`** only.
- **`Frontend/src/api/shippingInstructions.js`** — no header **`shipper_id`** on create/update.
- **OCR autofill:** **`Frontend/src/utils/siExtractMerge.js`** applies extracted shipper to the **first breakdown row** with an empty **`shipperId`**.
- **Display:** **`siViewModel.js`**, **`SiDocumentView.jsx`**, **`SIApproval.jsx`**, **`SiDetailModal.jsx`** — shipper from line **`shipperName`**; Unloading document breakdown table includes a **Shipper** column.

**Activity log:** SI update diff tracks **Shipper** via aggregated breakdown shipper names (not header **`shipperName`**).

**Functional behaviour:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.20**, **§16**.

### 0.24 Shipping instruction vessel-call columns removed (canonical `shipment_plans`) (2026-05-11)

**Migrations:** **`066_shipment_plans_approval_id_and_si_nullable_transition.sql`** adds **`shipment_plans.approval_id`**, backfills plan vessel-call fields from legacy SI rows where the plan was empty, and relaxes **`shipping_instructions.vessel_name` / `purpose`** nullability so the app can stop writing them before drop. **`067_drop_si_vessel_call_columns.sql`** drops from **`shipping_instructions`**: `vessel_name`, `purpose`, `eta`, `purpose_id`, `preferred_jetty_id`, `approval_id`, `voyage_no`, `approved_by_user_id`, `approved_at`, `port_id`.

**API / SQL:** List and detail SI queries **`LEFT JOIN shipment_plans`** (and **`si_purposes`** on **`spl.purpose_id`**) so JSON still exposes **`vesselName`**, **`purpose`**, **`eta`**, **`approvalId`**, **`preferredJettyId`**, etc., resolved from the plan. **`PUT /shipping-instructions/:id`** updates **`shipment_plans`** for those fields and **`shipping_instructions`** for SI-only columns. **`POST /shipping-instructions`** with **`shipment_plan_id`** applies optional body overrides to the linked plan (`vessel_name`, `voyage_no`, `jetty_id`, `approval_id`). Allocation overview / incoming SI SQL and **`operations`** joins use **`sp.vessel_name`**, **`sp.eta`**, plan port/jetty, and **`si_purposes.code`** instead of removed SI columns.

**Deploy order:** Run **066** before or with the application build that writes vessel-call data only on plans; run **067** only after all app instances use the new queries (no references to dropped SI columns).

**Rollback:** Prefer **`pg_dump`-based restore** to a snapshot taken before **067**. Optional SQL to re-add columns and copy back from **`shipment_plans`** (for emergency revert of schema only): **`Backend/rollback/067_rollback_restore_si_vessel_columns.sql`**. After rollback SQL, redeploy the previous API revision that still expected SI mirror columns.

### 0.25 Shipment plan agent + plan-linked SI surveyor (2026-05-13)

**Migration:** **`071_shipment_plan_agent_id.sql`** adds nullable **`shipment_plans.agent_id`** (FK **`si_agents`**, `ON DELETE SET NULL`), backfills from the first child **`shipping_instructions.agent_id`** per plan; rollback **`Backend/rollback/071_rollback_shipment_plan_agent_id.sql`**.

**API:** **`POST` / `PATCH /shipment-plans`** accept optional **`agent_id`**; **`PATCH`** may sync child SIs’ **`agent_id`** to match the plan. List/detail plans expose **`agentId`** / **`agentName`** (list joins **`si_agents`**). **`POST /shipping-instructions`** with **`shipment_plan_id`** resolves **`agent_id`** from the plan when the body omits it. Allocation overview / incoming-SI SQL joins **`si_agents`** on **`COALESCE(si.agent_id, sp.agent_id)`**.

### 0.14 Allocation schedule dataset split (2026-04-21)

Allocation overview now returns a dedicated **schedule dataset** so the two visuals can intentionally diverge:

- **Live surfaces** (Incoming vessel table + Jetty Schematic) continue to use **`queue`** and **`berths`** (non-`SAILED` operations only).
- **Jetty Schedule Gantt** uses **`scheduleQueue`**, which can include **`SAILED`** operations for time-series context.

Default backend policy in `allocation.js`:

- `scheduleQueue` includes operation rows where:
  - `status <> 'SAILED'`, **or**
  - `status = 'SAILED'` and `COALESCE(cast_off_at, actual_completion_time, updated_at)` is within a bounded lookback window.
- Lookback constant: **`SCHEDULE_SAILED_LOOKBACK_DAYS = 90`**.
- `scheduleQueue` also includes approved incoming SI rows (same shape as queue rows via `formatListRow`).

Frontend wiring:

- `Frontend/src/pages/Allocation.jsx` keeps table/schematic on `data.queue` / `data.berths`.
- `JettyScheduleGantt` receives `data.scheduleQueue` (fallback to `queue` for backward compatibility).

### 0.15 Jetty Schedule source-context tooltip + planned start fallback (2026-04-21)

`Frontend/src/components/JettyScheduleGantt.jsx` now exposes source references in bar tooltips so users can reconcile derived bars with underlying operation timestamps:

- Tooltip includes:
  - **Planned refs**: `ETB`, `ETA`
  - **Actual refs**: `TB`, `TA`
  - Start label with selected source: `Start ... (from ETB|ETA|TB|TA)`
- Planned bar start now uses:
  - `plannedStart = COALESCE(plannedEtbDateTime, etbDateTime, etaDateTime)`
- Planned end matrix remains guarded:
  - use `estimatedCompletionDateTime` only when later than `plannedStart`, else `plannedStart + 3 days`.

This change is presentation-only for schedule explainability; API contracts remain unchanged.

### 0.16 Jetty Schedule legend/status alignment hardening (2026-04-21)

`Frontend/src/components/JettyScheduleGantt.jsx` now closes remaining legend-alignment gaps:

- **Sailed status source-of-truth** (updated migration **082**):
  - `isSailed = (status === 'SAILED') OR castOffDateTime IS NOT NULL`
  - `operations_completed_at` (sign-off) does **not** end alongside occupancy; `actual_completion_time` is set at depart (`= cast_off_at`).
- **Legend simplification**:
  - Removed legend items: `Arriving / allocated`, `Berthing`.
  - Retained legend items: Planned known/open-end, Actual known/open-end, Now, Sailed off.
- Segment rendering classes and lane assignment remain unchanged.

### 0.17 Jetty Operation Id — `operations.jetty_operation_code` (2026-04-22)

**Purpose:** Human-facing operation reference (`LD|UN-YY-MM-####`) alongside the internal bigint `operations.id`. REST paths keep using **numeric** `:id` only; the code is returned in JSON as **`jettyOperationCode`** (camelCase) for UI and integrations that read responses.

**Database (migration `056_jetty_operation_code.sql`):**

- Column **`operations.jetty_operation_code`** (`TEXT`, nullable only transiently during insert; assigned in the same transaction as insert).
- Table **`jetty_operation_code_counters`** (`period_key`, `last_n`) — atomic increment per `period_key` (e.g. `LD-26-04`).
- Function **`public.assign_jetty_operation_code(p_operation_id bigint, p_tz text)`** — reads `purpose` + `created_at`, computes `YY`/`MM` with `timezone(p_tz, created_at)`, upserts counter, sets `jetty_operation_code`.
- **Backfill** (ordered `created_at`, `id` within each month/type bucket) uses IANA **`Asia/Jakarta`** in SQL; **must match** the default shipped in **`Backend/.env.example`** for `JETTY_OPERATION_CODE_TIMEZONE` unless the migration literal is edited before first apply on a new environment.
- **Partial unique index** on `jetty_operation_code` where not null.

**Application:**

- **`Backend/src/lib/jetty-operation-code.js`** — `getJettyOperationCodeTimezone()`, `assignJettyOperationCode(client, operationId)` calling the SQL function.
- **Insert paths** (same DB transaction as `INSERT INTO operations`): `Backend/src/routes/operations.js` (`POST /operations`), `Backend/src/routes/allocation.js` (arrival flow when it creates a new operation row).
- **`toOp`** in `operations.js` exposes **`jettyOperationCode`**; allocation overview SQL selects **`o.jetty_operation_code`** and **`formatListRow`** maps **`jettyOperationCode`**.

**Dev reset:** `Backend/scripts/reset-and-seed-dev.sql` truncates **`jetty_operation_code_counters`** and assigns codes for seeded operations after insert (requires migration **056** applied).

### 0.18 Frontend text input maximum lengths (2026-04-24)

**Source of truth (names + numbers):** `Frontend/src/constants/inputLimits.js` — imported by pages/components so caps stay aligned with **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.11**.

**Mechanism:** HTML **`maxLength`** on `<input>` / `<textarea>` for listed fields. PostgreSQL **`TEXT`** columns do not enforce length; limits are **application-level** in the UI.

**Recommended follow-up (backend):** mirror the same bounds on **`POST` / `PATCH`** handlers (operations, allocation arrival, shipping instructions, auth login body fields, RBAC roles, master ports/jetties) so oversized strings cannot bypass the browser. Not implemented in this change set unless explicitly scheduled.

| Constant (export) | Chars | Typical UI |
|-------------------|------:|--------------|
| `MAX_REMARK_CHARS` | 500 | Allocation remarks; Loading sign-off + pre-check remarks; At-Berth shift-out; operational **Remark**; Unloading comments |
| `MAX_POSTCHECK_RESULT_CHARS` | 500 | Loading Final Inspection / Final Cargo Checking **result** textareas |
| `MAX_SAMPLING_PALKA_FIELD_CHARS` | 20 | Loading sampling **No. Palka**, **FFA**, **Moisture** |
| `MAX_LOGIN_USERNAME_CHARS` / `MAX_LOGIN_PASSWORD_CHARS` | 50 | `/login` |
| `MAX_MASTER_JETTY_NAME_CHARS` / `MAX_MASTER_PORT_NAME_CHARS` | 100 | Master modals |
| `MAX_MASTER_DESCRIPTION_CHARS` | 100 | Master Port / Master Jetty **Description** |
| `MAX_RTSP_LINK_CHARS` | 512 | Master – Preferred Jetty **RTSP link (CCTV)**; mirrors **`jetties.js`** `MAX_RTSP_LINK_CHARS` |
| `MAX_ROLE_NAME_CHARS` / `MAX_ROLE_DESCRIPTION_CHARS` | 50 / 100 | Admin Roles |
| `MAX_MILESTONE_SUBSTEP_TITLE_CHARS` / `MAX_MILESTONE_REASON_CHARS` | 100 / 500 | Operational milestone composer |
| `MAX_SI_*` (see module) | varies | Shipping Instruction form + breakdown row short fields |
| `MAX_SI_APPROVAL_COMMENTS_CHARS` | 500 | SI Approval **Approval comments** |

### 0.19 OIDC strict integration hardening + local host consistency (2026-04-28)

This addendum captures the implemented OIDC integration behavior and rollout learnings from local stabilization.

**Backend integration (`Backend/src/routes/oidc-sso.js` + libs):**

- OIDC routes mounted under **`/auth`**:
  - `GET /auth/oidc/start`
  - `GET /auth/oidc/callback`
  - `GET /auth/oidc/ready` (plain readiness probe for auth route reachability)
- Start flow:
  - builds authorization URL from discovery metadata (`oidc-client.js`)
  - sets short-lived signed flow cookie (`jps_oidc_flow`)
  - uses PKCE (`code_challenge` / verifier)
- Callback flow:
  - validates token via JWKS (`jose`)
  - resolves user by `oidc_sub` (`claims.sub`)
  - optional fallback path for provider variants that return callback `code_verifier` in query when enabled by env:
    - `OIDC_ALLOW_QUERY_CODE_VERIFIER=true`
- Account collision guard:
  - if no `oidc_sub` match and local account exists for the same email, returns guarded failure (`email_collision_local_account`) instead of silent takeover.

**Browser/frame hardening:**

- SSO start behavior includes top-window promotion path for browser HTML requests to reduce iframe redirect traps.
- Callback includes iframe breakout handling for browser iframe destinations (`Sec-Fetch-Dest: iframe`) by returning minimal HTML that promotes to `window.top` with same callback URL.

**Transport hardening (`Backend/src/index.js`):**

- API server uses explicit `http.createServer(...)` with configurable max header size:
  - env: `HTTP_MAX_HEADER_SIZE` (default 131072 bytes)
- server listens on `0.0.0.0` in container runtime for consistent Docker host publishing.

**Frontend/client alignment:**

- Login SSO launch uses top-window navigation (`window.top.location.assign`).
- Vite local API base should be set in `Frontend/.env`:
  - `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1`

**Local host consistency (critical):**

- Use a single host identity across SPA/API/callback in local:
  - preferred known-good: `127.0.0.1`
- Avoid mixing `localhost` and `127.0.0.1` in one auth session; mixed hostnames can break cookie/session continuity and produce misleading RBAC/Forbidden symptoms despite successful callback.

**Known-good local OIDC env profile:**

- `OIDC_REDIRECT_URI=http://127.0.0.1:3000/auth/oidc/callback`
- `JPS_PUBLIC_ORIGIN=http://127.0.0.1:5173`
- `CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173`
- `COOKIE_SECURE=false` (HTTP local)
- `SSO_OIDC_ENABLED=true`

### 0.20 Schedule entry timezone (device IANA) + Master Port timezone picker (2026-05-04)

**Frontend — naive `datetime-local` ↔ API:**

- **`Frontend/src/utils/scheduleDateTime.js`**: **`getScheduleEntryTimeZone()`** (alias of **`getClientIanaTimeZone()`**) is the zone passed into **`naiveLocalToUtcIso`**, **`utcIsoToNaiveLocal`**, **`normalizeForApi`**, **`normalizeForApiOrEmpty`**, and **`nowToNaiveLocalInScheduleZone`** for operational schedule UIs (Allocation, Loading, Unloading, Verification, operational activities/sub-processes via **`Frontend/src/api/operations.js`** defaults, **`OperationalMilestoneWorkspace`**, **`SiDetailModal`** hub loader, **`loadingHubProcessStagesFromApi.js`**).
- The SPA should POST/PUT **ISO strings with `Z` or numeric offset** for schedule instants so the backend does not need to guess.

**Frontend — Master – Port:**

- **`Frontend/src/utils/ianaTimeZoneOptions.js`**: builds sorted **`Intl.supportedValuesOf('timeZone')`** options with **Luxon** offset labels.
- **`Frontend/src/components/SearchableSingleSelect.jsx`**: searchable single-select; dropdown panel is **`createPortal`**’d to **`document.body`** with **`z-index: 1100`** so **`modal` `overflow: auto`** does not clip it.
- **`Frontend/src/pages/MasterPort.jsx`**: port **`schedule_timezone`** is chosen from that list (orphan row if DB value is non-standard).

**Shell — `Layout.jsx`:**

- Shows **⚓** port IANA and **💻** device IANA with tooltips; muted subtitle: schedule entry follows the device clock.

**Backend — parsing (`Backend/src/lib/schedule-instant.js`):**

- **`parseScheduleInstantToIso`**: if the client sends a **naive** `YYYY-MM-DDTHH:mm` (no zone), it is interpreted in **`scheduleIana` from the operation’s port** (legacy / non-web). If the string includes **`Z`** or a **numeric offset**, **`new Date(v).toISOString()`** is used and port zone is **not** applied to that token.

**See also:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §10.1**.

### 0.21 Shipment Plan multi-SI vessel call (2026-05-11)

**Schema:** Migration **`059_shipment_plans.sql`** — table **`shipment_plans`**; required FK **`shipping_instructions.shipment_plan_id`**; 1:1 backfill from legacy rows.

**Allocation**

- **`GET /allocation/overview`**: flat **`queue`** unchanged at the top level; each row includes **`shipmentPlanId`** and **COALESCE(plan, operation, SI)** vessel-level timestamps and jetty so existing tables keep working (`Backend/src/routes/allocation.js`).
- **`PUT /allocation/arrival`**: persists vessel-call fields to **`shipment_plans`** first, then updates the resolved **`operations`** row; when **TB** is set, syncs sibling **`operations`** on the same approved plan (see **§0.24**).

**Operations JSON**

- **`loadOperationJoined`** **`LEFT JOIN shipment_plans sp`**; **`toOp`** prefers **`sp.*`** timestamps and jetty when **`shipment_plan_id`** is set so **`GET /operations`** and **`GET /operations/:id`** expose a single merged voyage timeline to clients (`Backend/src/routes/operations.js`).

**Depart / clearance**

- **`POST /shipment-plans/:id/depart`** — same body as operation depart (`cast_off_at`, optional evidence URLs); validates **port scope**; requires **every** non-`SAILED` child operation on the plan to be **`SIGNOFF_APPROVED`**; sets **`SAILED`** + clearance fields on **all** eligible children and updates **`shipment_plans`** (`Backend/src/routes/shipment-plans.js`, shared **`Backend/src/lib/shipment-plan-depart.js`**).
- **`POST /operations/:id/depart`** — still supported; when **`shipment_plan_id`** is set it runs the **same** multi-operation transaction via the shared helper.

**Frontend**

- **Verification** — plan-level table collapse + **`departShipmentPlan`** (`Frontend/src/pages/Verification.jsx`, `Frontend/src/api/shipmentPlans.js`).
- **JettyScheduleGantt** — **`bankLaneKey`** from **`shipmentPlanId`** for double-bank lanes (`Frontend/src/components/JettyScheduleGantt.jsx`).
- **Dashboard / activity chart** — dedupe by **`allocationQueueVesselCallKey`** (`Frontend/src/utils/dashboardQueueClassification.js`).
- **Loading hub** — SI switcher when multiple operations share a plan (`Frontend/src/pages/Loading.jsx`).

### 0.22 Allocation plan-centric page + `plan-overview` (2026-05-11)

**RBAC**

- New page permission **`allocation-plan`** (migration **`064_allocation_plan_page_permission.sql`**): catalog insert plus **`role_permissions`** mirrored from existing **`allocation`** grants; **`JPS Full Access`** backfill.
- **`Frontend/src/data/rolesData.js`** — Admin Roles matrix label for the new page key.

**Backend (`Backend/src/routes/allocation.js`)**

- **`buildAllocationOverviewPayload`** (internal): shared implementation for overview JSON.
- **`GET /allocation/overview`** — same JSON as **`plan-overview`**; guarded by **`...requirePageView('allocation-plan')`** (runs after global **`requireAuth`** + port scope on **`/allocation`** mount). Incoming queue rows use **`source`** = **`incoming-si`** (approved SI without operation yet).
- **`GET /allocation/plan-overview`** — same payload as overview; guarded by **`...requirePageView('allocation-plan')`** (runs after global **`requireAuth`** + port scope on **`/allocation`** mount).
- **`PUT /allocation/arrival`** — edit allowed when **`userHasPageEdit('allocation-plan')`** ( **`userHasAllocationPlanEdit`** in code). **`writeActivityLog.pageKey`** for this route is **`allocation-plan`**. When **`TB`** is set on an approved plan, sibling SIs on the same plan are synced (see **§0.24**).

**Operations shifting-out (`Backend/src/routes/operations.js`)**

- **`POST /operations/:id/shifting-out`** — **`activityLogPage`** in body may be **`allocation-plan`** or **`at-berth`** (legacy client value **`allocation`** is normalised to **`allocation-plan`** for **`writeActivityLog.pageKey`**).

**Frontend**

- **`Frontend/src/api/allocation.js`** — **`fetchAllocationPlanOverview()`** → **`GET /allocation/plan-overview`**; **`fetchAllocationOverview()`** → **`GET /allocation/overview`** (both require **`allocation-plan`** view on the server after migration **068**).
- **`Frontend/src/utils/allocationPlanGrouping.js`** — **`groupQueueByShipmentPlan(rows, globalOrder?)`** for nested table grouping + unlinked bucket; child order follows **`globalOrder`** when provided.
- **`Frontend/src/pages/Allocation.jsx`** — accepts **`pageProfile`**: **`planCentric`** switches fetcher, RBAC keys, nested desktop/mobile queue, **`plannedBerthingPath`** for vessel pipeline link; schematic/Gantt still use flat **`list`** / **`scheduleList`**.
- **`Frontend/src/pages/AllocationPlanBerthing.jsx`** — thin wrapper rendering **`Allocation pageProfile='planCentric'`**.
- **`Frontend/src/App.jsx`** — routes **`/allocation-plans`**, **`/allocation`** and **`/shipping-instruction`** list URLs render **`RetiredPage`** with links to plan-centric hubs; deep links **`/shipping-instruction/view/:id`** and **`/shipping-instruction/approval/:id`** unchanged.
- **`Frontend/src/components/Layout.jsx`** — nav item for **`/allocation-plans`** only; **`pathToPageKey`** maps **`/allocation`** and **`/berthing`** to **`allocation-plan`**, **`/shipping-instruction`** subtree to **`shipment-plan`**.

### 0.23 Shipment plan GET JSON — plan-level timeline fields + plan-centric modal (2026-05-11)

**Mapper (`Backend/src/routes/shipment-plans.js` — `toPlanListRow`)**

List and **`GET /api/v1/shipment-plans/:id`** detail responses now include **ISO 8601 strings** (or `null`) for plan-owned schedule fields in addition to existing **`eta`**:

- **`ta`**, **`etb`**, **`tb`**, **`dockingStartTime`**, **`pob`**, **`sob`**, **`estimatedCompletionTime`**, **`actualCompletionTime`**

**Normalization:** `timestampToIso` coalesces DB `timestamptz` / driver values to strings for JSON.

**Frontend (`Frontend/src/pages/Allocation.jsx`, plan profile)**

- Schematic / berth / Gantt selection passing **`plan-<id>`** sets **`vesselDetailPlanId`** and resolves a **representative** **`vesselDetailModalVesselId`** for operation-scoped sections; **`closeVesselDetailModal`** clears vessel + plan fetch state.
- **`fetchShipmentPlan`** (`Frontend/src/api/shipmentPlans.js`) on open when **`vesselDetailPlanId`** is set; **`planDetail`**, **`planDetailLoading`**, **`planDetailError`** drive the plan **Time & status** card; **`vesselDetailPlanQueueRows`** filters **`list`** ∪ **`scheduleList`** by **`shipmentPlanId`**.
- i18n: **`Frontend/src/locales/en|id/allocation.json`** — plan modal section titles and **`ttPlan*`** tooltip strings.

### 0.24 Plan berth — sibling `operations` sync (2026-05-11)

**Backend (`Backend/src/routes/allocation.js` — `PUT /allocation/arrival`)**

- **`userHasAllocationPlanEdit`** gates the route (**`allocation-plan`** **edit** only).
- After updating **`shipment_plans`** and the **primary** **`operations`** row, when **`shipment_plan_id`** is set and resolved **`tb`** is non-null: for each **other** `shipping_instructions` row on the same **Approved** plan, the handler ensures an **`operations`** row exists ( **`insertOperationForApprovedPlanSi`** + **`assignJettyOperationCode`** on insert), skips rows already **`SAILED`**, then applies **`runArrivalOperationUpdate`** with the same call-level timestamps as the request; **`actual_completion_time`** is taken per sibling unless the body explicitly sets **`actualCompletionDateTime`** (then all updated rows share that value). NOR **`operation_nor_details`** upsert remains **primary operation only**.

### 0.25 Retire legacy Allocation & Shipping Instruction list RBAC (2026-05-11)

**Migrations:** **`068_retire_allocation_si_page_permissions.sql`** — for each role, **OR-merge** active grants from catalog pages **`allocation`** → **`allocation-plan`** and **`shipping-instruction`** → **`shipment-plan`** (including **`can_approve`** mirroring per existing **060** rules), then **soft-delete** matching **`role_permissions`** rows and the two retired **`permissions`** catalog rows.

**Rollback:** Prefer a **pre-migrate snapshot** of **`permissions`** + **`role_permissions`**. Optional script **`069_rollback_retire_allocation_si_page_permissions.sql`** clears **`deleted_at`** on those catalog keys and their role links (review before use if new grants were added post-migration).

**Backend:** **`allocation.js`** — **`GET /allocation/overview`** now uses **`requirePageView('allocation-plan')`**; **`userHasAllocationPlanEdit`** is **`allocation-plan`** **edit** only; activity logs for swap + arrival use **`allocation-plan`**. **`shipping-instructions.js`** — internal SI approve checks **`shipment-plan`** **`can_approve`**; activity **`pageKey`** **`shipment-plan`**. **`operations.js`** / **`operation-documents.js`** — allocation-scoped activity keys use **`allocation-plan`**.

**Retired catalog keys:** **`allocation`**, **`shipping-instruction`** — no longer seeded as active pages; Admin matrix uses **`allocation-plan`** and **`shipment-plan`** only.

### 0.4 Dev reset + seed (transactional data only)

To support “start fresh” local testing without wiping master data, the repo includes a repeatable reset+seed script:

- **Script**: `Backend/scripts/reset-and-seed-dev.sql`
- **Run (PowerShell, from `Backend/`)**:
  - `Get-Content -Raw .\scripts\reset-and-seed-dev.sql | docker compose exec -T jps-db psql -U jps_user -d jps_db`

**Behaviour**

- **Cleans (TRUNCATE, restart identities, cascade)** transactional tables only:
  - `jetty_operation_code_counters` (see **§0.17**; included in `reset-and-seed-dev.sql` truncate list)
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
  - `shipment_plans`
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
- **Choose-port UX (2026-04-02):** Multi-port users use a **dedicated route** **`/select-port`** (no `Layout` shell). The main app **`Layout`** **`useLayoutEffect`** redirects to **`/select-port?returnTo=<encoded path>`** when `PortScopeContext` reports **`requiresSelection`** and the path is not already bypassed (`/admin`, `/master`). **Login** (`Login.jsx`) after a **successful login** (session cookies set; see **§0.10**) calls **`fetchMyPorts`**; if **`assignedPorts.length > 1`** and **`sessionStorage`** has **no** valid stored id for that list, **`navigate('/select-port')`**; otherwise **`navigate('/')`**. **`returnTo`** is validated on the choose-port page (same-origin path only; rejects `//`).
- **Changing port:** Header **no longer** uses an inline `<select>` for multi-port users. A **button** navigates to **`/select-port?returnTo=…`** so selection happens only on the landing page.
- Selected port persistence: **browser `sessionStorage`** key **`jps_selected_port_id`** (see `Frontend/src/api/client.js`: **`getSelectedPortId`**, **`setSelectedPortId`**). Every **`authHeaders()`** request adds **`X-Selected-Port-Id`** when set and **`X-XSRF-TOKEN`** when the CSRF cookie is present (see **§0.10**). **Logout** (`Frontend/src/api/auth.js` **`logout`**) calls **`POST /auth/logout`** (clears HttpOnly session cookies), clears any legacy **`localStorage`** token, and calls **`setSelectedPortId(null)`**. The shell invokes logout from **`UserMenu`** in the top bar (**§0.27**), not a standalone header logout button beside a greeting.
- **`PortScopeContext` bugfix:** When **`me` is temporarily null** (auth still loading after reload), **`refreshPorts` must not** call **`persistSelectedPortId(null)`**—that had been clearing the user’s choice on full page load. The **`!me`** branch only resets in-memory lists and syncs **`selectedPortId` state** from **`getSelectedPortId()`**.
- Scope enforcement applies in both frontend and backend for operational modules; Admin/Master remain configuration surfaces.

**Implementation map**

| Area | Location |
|------|----------|
| Choose-port page | `Frontend/src/pages/SelectPort.jsx` |
| Route registration | `Frontend/src/App.jsx` — **`/select-port`** sibling to **`/login`**, outside **`AppShell` / Layout** |
| Redirect guard | `Frontend/src/components/Layout.jsx` — **`useLayoutEffect`**, **`navigate(..., { replace: true })`** |
| Header user menu | `Frontend/src/components/UserMenu.jsx`, `ChangePasswordModal.jsx`, `PasswordField.jsx` — **§0.27** |
| Port state + API header | `Frontend/src/context/PortScopeContext.jsx`, `Frontend/src/api/client.js` |
| Post-login branch | `Frontend/src/pages/Login.jsx` — **`fetchMyPorts`** after **`refreshMe` / `refreshRbac`** |
| Backend scope | `Backend/src/middleware/port-scope.js` — **`requirePortScope`**, **`req.selectedPortId`** |

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

### 0.5 Jetty layout persistence and Jetty Schematic (2026-04-02)

**Source of truth:** Per-port jetty schematic **geometry** (columns, top/bottom jetty cells, middle pipeline blocks) is stored in **`jetty_layouts`** and exposed via the API. **Master – Jetty Layout** is the configuration UI; **Allocation → Jetty Schematic** (and any future Dashboard schematic) must consume the same API — not the legacy in-memory layout in `Frontend/src/data/masterData.js`.

**API (port-scoped via existing middleware on `selectedPortId`):**

- `GET /api/v1/jetty-layout` — Returns `{ portId, columns }`. If no row exists, **`columns` is an empty array** `[]`.
- `PUT /api/v1/jetty-layout` — Body `{ columns: [...] }` validated server-side (`jetty-layout.js`).

**Layout JSON shape (cells):** Each column has `top`, `middle`, `bottom`. Jetty cells use **`type: 'jetty'`** and **`jettyId`** as a **string of the database `jetties.id`** (bigint), consistent with Master – Jetty Layout save payload.

**Joining layout to occupancy:**

- `/allocation/overview` returns **`berths[].id`** as the **short jetty name** (e.g. `1A`), derived from `jetties.name` with the **`Jetty `** prefix stripped — same rule as `jettyShortName` / `regexp_replace` in `allocation.js`.
- The schematic component resolves **`layout_json` `jettyId` → `berths[].id`** by loading **`GET /jetties?port_id=...`** for the active port and mapping each jetty’s **`id`** to **`name`** after stripping the `Jetty ` prefix.

**Frontend implementation (Option B — self-contained widget):**

- **`JettySchematic`** (`Frontend/src/components/JettySchematic.jsx`) uses **`usePortScope()`** and, when an operational port is selected, loads **`fetchJettyLayout()`** and **`fetchJetties(selectedPortId)`** in parallel, then renders columns from the API. The jetty list also builds **`berthId → rtspLink`** for optional CCTV buttons on each name band (**§0.26**).
- **No saved layout:** If `columns.length === 0`, the UI shows a single user-facing placeholder (functional copy in **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md**); there is **no** hardcoded fallback grid (e.g. old `1A/2A/3A` default).
- **Errors:** Network/API failure shows a distinct “unable to load” message (not the admin placeholder).
- **Dashboard (future):** To embed the same schematic, render **`JettySchematic`** with the same **`PortScopeProvider`** context and pass **`berths` / `vesselById` / handlers** as today on Allocation — **no duplicate layout-fetch parent** required because the component owns layout loading.

**Database:** Table **`jetty_layouts`** (see migration `043_jetty_layout_persistence.sql`); one active row per `port_id` (partial unique index where `deleted_at IS NULL`).

**Schematic presentation (see FUNCTIONAL-SPEC §17.7):** `Frontend/src/styles/jetty-schematic.css` defines **`--jetty-schematic-zone-height`** for the top/bottom grid rows of each column (pipeline row fixed at **48px**). **`JettySchematic`** sets **`--berth-lane-height-divisor`** on each berth stack to **`Math.max(capacity, 2)`** so lane pill height is `(zone − gaps) / divisor`. Implementation files: **`JettySchematic.jsx`**, **`jetty-schematic.css`**.

### 0.6 Jetty schedule Gantt — bank lanes (double bank) (2026-04-02)

**Issue avoided:** Bank lanes must **not** be computed in independent passes per **`planned`** vs **`actual`** layer. Doing so reset lane index to `0` for each layer, so the **same vessel** appeared on **1A-01** for planned and **1A-01** again for actual in a way that **duplicated** the bank row usage and prevented a **second vessel** from consistently using **1A-02**.

**Rule:** For each jetty id, collect distinct **`vesselId`** values from **all** schedule segments (both layers). Sort vessels by **`tbDateTime`** ascending (rows with no TB sort after those with TB), then **`operationId`**, then **`vesselId`**. Assign **bank lane** indices `0 … capacity−1` in that order; `rowKey` = `` `${jettyId}__${lane}` `` (UI label e.g. **1A-01**, **1A-02**). **Every** segment for that vessel — planned or actual — uses the **same** `rowKey`, so **Planned** / **Actual** remain **sub-rows** inside one bank lane.

**Overflow:** If there are more distinct vessels than jetty **`capacity`**, lane index is **clamped** to `capacity − 1` (additional vessels share the last lane).

**Code:** `Frontend/src/components/JettyScheduleGantt.jsx` (`assignBankLanesByVessel`); metadata from allocation **`list`** (`tbDateTime`, `operationId`).

**Schematic parity:** `Frontend/src/components/JettySchematic.jsx` assigns **`berths[].occupants`** into the same **01 / 02** lane order (TB → operation id → vessel id) so labels **1A-01** / **1A-02** align with the schedule.

### 0.7 Active Vessel Detail — times edit, last updated, RBAC (2026-04-02)

**Database:** Migration **`044_operations_updated_by.sql`** adds **`operations.updated_by`** (`BIGINT` → `users.id`, `ON DELETE SET NULL`). Existing **`operations.updated_at`** continues to bump on any `UPDATE` to the row.

**`GET /allocation/overview` (`formatListRow`):**

- Operation-backed queue rows: **`recordLastUpdatedAt`** = `o.updated_at`; **`recordLastUpdatedByDisplayName`** = `COALESCE(users.display_name, users.username)` from join on **`o.updated_by`** (active users only).
- Approved-SI-only rows: **`recordLastUpdatedAt`** = `shipping_instructions.updated_at`; **`recordLastUpdatedByDisplayName`** = `null`.

**`PUT /allocation/arrival`:**

- **Authorisation:** `userHasPageEdit(req.userId, 'allocation-plan')` from **`Backend/src/middleware/permissions.js`**; **403** if false. Route no longer uses **`optionalAuth`**; parent **`requireAuth`** + port scope still apply.
- **Persistence:** `UPDATE operations` sets **`updated_by`** = authenticated user id; **`actual_completion_time`** is updated when the JSON body **includes** key **`actualCompletionDateTime`** (empty string clears); if the key is **omitted**, the column is left unchanged (read **`opBefore`** for merge).
- **Partial JSON bodies:** If the client **omits** keys **`taDateTime`**, **`etbDateTime`**, **`pobDateTime`**, **`tbDateTime`**, **`sobDateTime`**, **`estimatedCompletionDateTime`**, **`norTenderedDateTime`**, or **`norAcceptedDateTime`**, the server **keeps** the existing database values for those columns (supports NOR-only saves from Loading). If a key is **present** (including with an empty string), the server applies normal parse/clear rules.
- **Activity log:** `writeActivityLog` **`meta`** may include **`source: 'active_vessel_detail'`** when the client sends **`source`** in the body (Active Vessel Detail save).

**Frontend:** `Frontend/src/pages/Allocation.jsx` — **`useRbac().canEdit('allocation-plan')`** gates the Edit icon; **Log arrival** / **Confirm Berthing** requests send the same field keys as before; optional extra fields preserve behaviour when the backend merges partial updates.

### 0.8 Admin User Management — port assignment IDs (2026-04-02)

**Issue:** PostgreSQL **`bigint`** port ids can arrive in JSON as **strings**; **`formPortIds.includes(portListRow.id)`** failed when state held **numbers**, so Edit User showed unchecked ports and toast counts could disagree with **`PUT /users/:id/ports`** deduping.

**Fix (`Frontend/src/pages/AdminUsers.jsx`):** Canonicalise with **`portIdNum` / `uniquePortIds`**; **`loadPorts`** normalises **`id`** to **Number**; success toast uses **`saveUserPorts`** response **`assignedPorts.length`** when present.

**API:** `GET /ports` **`toPort`** (`Backend/src/routes/ports.js`) returns **`id: Number(row.id)`** for consistency.

### 0.9 Shifting out / re-dock — `operations.shifting_out` + remark (2026-04-02)

**Purpose:** Double-bank / priority workflows need to **free berth capacity** without soft-deleting the operation or clearing **TB**. Implementation is **port-scoped**, **authenticated** (`requireAuth` + `requirePortScope`), route: **`POST /api/v1/operations/:id/shifting-out`** (`Backend/src/routes/operations.js`).

**Database (migration `042_jetty_capacity_and_shifting_out.sql`):**

- **`operations.shifting_out`** — `BOOLEAN NOT NULL DEFAULT false`
- **`operations.shifting_out_at`** — `TIMESTAMPTZ NULL` (set on **first** transition to shifted-out; cleared when shift-out cleared)

**Request body (JSON):**

| Field | Type | Rule |
|--------|------|------|
| `shiftingOut` | boolean | **Required** |
| `remark` | string | **Required** when `shiftingOut === true` (non-empty after trim); persisted to **`operations.remark`** (full replace). When `shiftingOut === false`, include a **non-empty** `remark` to update remark while clearing shift-out (**re-dock** from Allocation); **omit** `remark` (or only whitespace) to clear shift-out **without** changing `operations.remark` (**Undo shift-out** from At-Berth). |
| `activityLogPage` | string | Optional; **`allocation-plan`** or **`at-berth`** only (legacy **`allocation`** is treated as **`allocation-plan`**). Drives `writeActivityLog(..., pageKey)` so re-dock appears under **Allocation (plans)** and shift-out under **At-Berth** in the page-scoped Activity Log panel. |

**Handler behaviour (ordering):**

1. `BEGIN`; load operation + port access check (`canAccessOperationForSelectedPort` vs `req.selectedPortId`).
2. Reject **404** if not found / wrong port; **409** if **SAILED** or **no `jetty_id`** (cannot shift out without a jetty).
3. **First `UPDATE`:** `shifting_out`, `shifting_out_at` (CASE: set `NOW()` on first true; NULL when false), `updated_at`.
4. **Second `UPDATE` (when remark payload applies):** `remark = $1::text`, `updated_at` — avoids relying on a single statement mixing boolean + optional text binds across drivers.
5. **`writeActivityLog`:** `summary` **Shifted out from berth** vs **Re-docked (shift-out cleared)** (when remark sent on clear) vs **Shift-out cleared** (undo without remark); **`changes`** include **Shifting out** and **Remark** when remark actually changed; **`meta`:** `{ source: 'operations.shifting-out', shiftingOut }`.
6. `COMMIT`; response body **`toOp(row)`** including **`remark`** (`loadOperationJoined`).

**Client:** `Frontend/src/api/operations.js` — **`setOperationShiftingOut(operationId, shiftingOut, remark?, options?)`**. Pass **`{ activityLogPage: 'allocation-plan' }`** on re-dock; **`{ activityLogPage: 'at-berth' }`** on shift-out from At-Berth.

**Allocation overview / UI:**

- **`GET /allocation/overview`** — `activeOperationsOverviewSql` selects **`o.remark`**, **`o.shifting_out`**; `formatListRow` exposes **`remark` / `remarks`** via **`??`** (do not collapse empty string with `|| null`).
- **`berths` occupancy:** loop **skips** rows where **`o.shifting_out`** is true so shifted vessels do not consume a slot (see `allocation.js` occupants build).
- **`Frontend/src/pages/Allocation.jsx`** — re-dock modal; overview `useEffect` depends on **`useLocation().key`** and **`visibilitychange`** refetch so returning from At-Berth does not show a stale remark.
- **`Frontend/src/pages/AtBerthExecutions.jsx`** — shift-out confirmation modal + success toast.

**FUNCTIONAL-SPEC:** **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md §2.5**.

### 0.10 Browser session, CSRF, SI lookups auth, uploads, headers (2026-04-03)

**Goal:** Align the technical spec with implemented **high-priority security hardening** (see `Docs/Security/SECURITY-HIGH-FINDINGS-DETAILED-PLAN.md` §1a).

**Session (replaces primary `localStorage` JWT for the SPA)**

- **Login** `POST /api/v1/auth/login`: on success, response JSON is **`{ user }`** by default; **`Set-Cookie`** sets **`jps_at`** (HttpOnly JWT) and **`jps_xsrf`** (readable anti-CSRF token). Cookie **`maxAge`** follows **`JWT_EXPIRES_IN`** (default **8h** in code / `.env.example`).
- **Optional:** `AUTH_RETURN_TOKEN_BODY=true` adds **`token`** to the JSON for non-browser API clients that cannot use cookies.
- **Logout** `POST /api/v1/auth/logout`: clears both cookies (**204**). Frontend **`Frontend/src/api/auth.js`** calls this, clears legacy **`jps_token`** in `localStorage` if present, and **`setSelectedPortId(null)`**. Entry point in the authenticated shell: **`UserMenu`** dropdown (**§0.27**).
- **Authorisation header:** `Backend/src/middleware/auth.js` accepts **`Authorization: Bearer <jwt>`** **or** cookie **`jps_at`**. Bearer-only requests **skip** CSRF verification (integrations/scripts).
- **CSRF:** For unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`), when the session cookie **`jps_at`** is present **and** there is **no** Bearer header, middleware **`Backend/src/middleware/csrf.js`** requires **`X-XSRF-TOKEN`** to match cookie **`jps_xsrf`**. **`POST /auth/login`** is exempt.
- **Frontend:** `Frontend/src/api/client.js` uses **`credentials: 'include'`** on all `fetch` calls and sends **`X-XSRF-TOKEN`** when the `jps_xsrf` cookie exists. **`AuthContext`** / **`RbacContext`** rely on **`GET /users/me`** and RBAC endpoints with cookie session (not `localStorage` token checks).

**CORS / proxy**

- **`CORS_ORIGIN`** must list the SPA origin(s) (e.g. `http://localhost:5173`); credentials enabled. Pair with **`Frontend/.env`** **`VITE_API_BASE_URL`** (e.g. `http://localhost:3000/api/v1`). **`Backend/.env`** / **`Backend/.env.example`** document API-side pairing; root **`.env.example`** may point to the two app env files only (no secrets duplicated).
- **`TRUST_PROXY`:** set hop count (or value) when behind a load balancer so **login rate limiting** uses the real client IP (`Backend/src/index.js`).

**Login rate limiting**

- **`express-rate-limit`** on **`POST /auth/login`** (`Backend/src/routes/auth.js`); cap tunable via **`AUTH_LOGIN_MAX_ATTEMPTS`** (default **40** per 15 minutes per IP).

**SI aggregate lookups require authentication**

- Router **`/api/v1/si-lookups`** is mounted with **`requireAuth`** in **`Backend/src/index.js`**. **`GET /si-lookups`** (bulk dropdown bundle) returns **401** without a session. Per-type CRUD behaviour unchanged aside from requiring login first.

**Upload type validation**

- After **multer** writes files for **`operation-documents`** and **sub-process document** uploads, **`Backend/src/lib/upload-mime.js`** runs **`file-type`** (magic bytes) against an allowlist (PDF, common images, XLSX). Mismatch → files removed, **400**.

**Nginx security headers (production SPA image)**

- **`Frontend/nginx.conf`** (copied into the production nginx image) adds **`X-Content-Type-Options`**, **`Referrer-Policy`**, **`Permissions-Policy`**, **`X-Frame-Options`**, and **`Content-Security-Policy`**. **Vite dev** does not use this file; tune **`connect-src`** (and related directives) for your real API hostname in Alicloud or other hosting.

**E2E smoke (optional)**

- **`npm run test:e2e`** from repo root delegates to **`Frontend/`** (Playwright): login UI, asserts cookies, **`GET /users/me`**, logout with CSRF header. Equivalent: `cd Frontend && npm run test:e2e`. Requires Vite + API + DB running locally.

### 0.11 Repository layout and frontend env (2026-04-13)

After the **root four-folder reorg**, ownership is explicit; root remains a thin compatibility layer.

| Concern | Location | Notes |
|--------|----------|--------|
| SPA dependencies + scripts | `Frontend/package.json`, `Frontend/package-lock.json` | Canonical install: `cd Frontend && npm ci` / `npm install`. |
| Vite + build-time env | `Frontend/vite.config.js`, `Frontend/index.html` | **`VITE_*`** variables (including **`VITE_API_BASE_URL`**) belong in **`Frontend/.env`** (or env files Vite loads from that directory). |
| Playwright E2E | `Frontend/playwright.config.js`, `Frontend/e2e/` | Run via root `npm run test:e2e` or from `Frontend/`. |
| Production SPA image | `Frontend/Dockerfile`, `Frontend/nginx.conf`, `Frontend/nginx.alicloud-app.conf`, `Frontend/.dockerignore` | Compose **`build.context: ./Frontend`** from repo root files. |
| Root npm UX | Root `package.json` | Delegates only: `npm --prefix Frontend run …` for dev/build/preview/e2e. |
| Backend + DB compose | `Backend/docker-compose.yml` (local dev), root `docker-compose.backend.yml` | API **`Backend/`**; canonical copies also under **`Backend/infra/`** — see **`Docs/Plan/ROOT-FOUR-FOLDER-REORG-PLAN.md`**. |

### 0.12 SI hyperlink detail modal (2026-04-17)

**Goal:** Provide one reusable, non-document SI detail experience triggered from SI values in table rows across operational pages.

**Frontend implementation**

- Shared component:
  - `Frontend/src/components/SiDetailModal.jsx`
  - `Frontend/src/styles/si-detail-modal.css`
- Data source:
  - `fetchShippingInstruction(id)` (`Frontend/src/api/shippingInstructions.js` → `GET /shipping-instructions/:id`)
- Trigger behavior:
  - SI value is rendered as hyperlink text (`<a href="#">...`) in table rows and opens the shared modal.
  - Click handler uses `preventDefault()` and `stopPropagation()` so row-expand handlers are not triggered.
- Integrated pages:
  - `Frontend/src/pages/ShippingInstruction.jsx` (`siNo` table column)
  - `Frontend/src/pages/Allocation.jsx` (`shippingInstruction` table column)
  - `Frontend/src/pages/AtBerthExecutions.jsx` (`shippingInstruction` table column)
  - `Frontend/src/pages/Verification.jsx` (**Clearance** — **Jetty Operation ID** column opens the same modal when hyperlinked to the SI id, consistent with other pages)
- Scope:
  - Table SI values only (expanded detail blocks are not modal triggers in this release).
- Localization:
  - Modal labels/chrome use `shippingInstruction` i18n namespace (EN/ID keys, including modal title/loading/error/close text).
- **Nested executions log (2026-05-04):** When the loaded SI has **`operationId`**, the modal’s **At-berth process** block includes a control that opens a **second** full-screen overlay (higher `z-index` than the default `.modal-overlay`, see `.si-detail-modal__nested-overlay` in `si-detail-modal.css`). The inner dialog embeds **`Frontend/src/components/OperationActivityTimeline.jsx`** with `operationId`, `vesselId` = `op-{operationId}`, and `basePath` = `/loading` or `/unloading` from **`normalizeHubPurpose`** (SI purpose or `fetchOperation` snapshot) so **Edit** deep-links match the hub. Inner close / backdrop / **Escape** dismiss only the nested layer; parent **Operation Detail** stays open. Timeline refresh uses the component’s `refreshToken` / `onActivityLogRefresh` pattern. Document names in the timeline use **`FilePreviewLink`** (**§0.30**).

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
- **Frontend (`Frontend/.env` for local Vite; build-time `VITE_*` in Docker via compose args):** `VITE_API_BASE_URL` (must match API host + `/api/v1`). Root **`npm run dev`** is a thin wrapper — see **§0.11**.
- **Backend:** `DATABASE_URL` / `DB_*`, `JWT_SECRET`, **`JWT_EXPIRES_IN`** (session cookie lifetime; default **8h**), `CORS_ORIGIN` (must include SPA origin), optional **`AUTH_RETURN_TOKEN_BODY`**, **`AUTH_LOGIN_MAX_ATTEMPTS`**, **`TRUST_PROXY`**, and strict OIDC controls (`OIDC_ISSUER`, `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`, `OIDC_SCOPES`, `SSO_OIDC_ENABLED`, `SSO_LEGACY_BRIDGE_ENABLED`) (see **§0.10**).
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

**Workflow (current frontend: plan-linked **`ShipmentPlansList.jsx`** + **`ShippingInstructionSiLinkedFields.jsx`**; legacy **`ShippingInstruction.jsx`** retired route; **`SIApproval.jsx`**, **`SIView.jsx`**)**:
1. SIs are listed with filters (purpose, status, search by SI, vessel, agent).
2. For each SI:
   - Show vessel, commodity, purpose (Loading/Unloading), ETA, status.
   - Expand row for full details (breakdown, documents; extended header fields as implemented).
3. **Shipper** is selected **per breakdown row** (master **`si_shippers`** dropdown in the breakdown table). One SI may therefore list **multiple shippers** when it has multiple commodity/contract lines. **Party & port** retains loading port, surveyor, trade term (Unloading), and NPWP display (Loading) — not shipper.
4. Loading SIs: create/edit includes **destination**, **freight_terms**, **B/L & consignee** text fields, **voyage**, **document date**; modal shows **B/L split preview** from breakdown.
4. Internal approval (Loading + Unloading): **Submit for approval** persists **Submitted** via API; **Approve/Sign-off** requires RBAC **`can_approve`** on page **`shipment-plan`** (see §6). On approve, API sets **`approved_by_user_id`**, **`approved_at`**, **snapshots**, **`approval_id`**; document view uses **reference_number** as **No.** when set.
5. Document view/approval templates:
   - **Loading** uses the full template (header + full field set).
   - **Unloading** uses a simplified template (label and layout differences).
6. UX details:
   - Mandatory fields are validated client-side and enforced server-side.
   - Action buttons are always visible but may be disabled with one-line “why disabled” tooltips.
   - Delete is supported for Draft and Submitted SIs with RBAC + status enforcement.
7. SI quick detail modal:
   - SI number in table rows is hyperlink-style and opens shared `SiDetailModal` (non-document view).
   - Modal data is fetched with `GET /shipping-instructions/:id` and rendered with `—` fallback for empty fields.

**Target implementation**:
- Source SIs from upstream EXIM/Logistics via `shipping_instructions` API.
- Provide a **link from SI to Operation**:
  - Action “Create Operation / Go to Allocation” should:
    - Create or open an `Operation` for this SI.
    - Navigate to Allocation view with context.

#### 2.2.1.1 SI master data (dropdown sources)

SI dropdown values are sourced from master tables and managed via Master Menu pages:

- Term
- Shipper (used on **breakdown lines**, not SI header — **§0.31**)
- Loading Port
- Surveyor
- Agent
- Commodity

Each SI lookup master list uses **`MasterSiLookup.jsx`** with client-side **sort** and **filter** on displayed columns (**§0.28**). **Sort order** is **not** shown in those admin tables; list APIs still order by **`sort_order`** for dropdowns.

Freight terms are currently fixed (frontend constant + backend validation), so the UI exposes them as a read-only master page with the same sort/filter table pattern (**`MasterFreightTerms.jsx`**).

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
4. SI hyperlink modal:
   - `shippingInstruction` table column is hyperlink-style and opens shared `SiDetailModal` using `shippingInstructionId`.

**Target implementation**:
- Link allocation rows to backend `operations` and `jetties`.
- On berthing confirm:
  - Mark operation as `DOCKED`.
  - Set `docking_start_time` (used for SLA; see §3.3).

#### 2.2.3 At-Berth Executions

**User Story**: As Operator, I see all vessels currently at berth with their pipeline phase and can open their operational detail.

**Workflow (implemented: `AtBerthExecutions.jsx`)**:
1. Data: **`GET /allocation/overview`** → `queue` array, filtered client-side to **berthed** rows (same criteria as Allocation “Berthed” filter: TB present and/or statuses DOCKED, IN_PROGRESS, POST_OPS, SIGNOFF_REQUESTED, SIGNOFF_APPROVED) and **excluding** rows where **`shiftingOut`** is true (those appear as **incoming** on Allocation until re-dock).
2. Summary cards: Loading / Unloading × phase counts; phase derived from **`operations.status`** (IN_PROGRESS → Operational, POST_OPS → Post-Checking, SIGNOFF_REQUESTED → Ready to Sail, SIGNOFF_APPROVED → Signed off, else Pre-Checking).
3. Table columns: Vessel, SI, Commodity, Purpose, Jetty, TA, TB, Phase, Status; **Action** first after expand column; expandable **Full details** aligned with Allocation row detail field order.
4. **Open** → `/{loading|unloading}/:vesselId` (purpose-based route; API rows may use `op-<operationId>` vessel id form).
5. **Shifting out:** modal + required **`remark`** → **`POST /operations/:id/shifting-out`** (`shiftingOut: true`, `activityLogPage: 'at-berth'`). **Undo shift-out:** same endpoint with `shiftingOut: false` and **no** `remark` in body (optional clear).
6. **SI hyperlink modal:** `shippingInstruction` table value is hyperlink-style and opens shared `SiDetailModal` using `shippingInstructionId`.

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

- **Stage tabs — progress counts (`Loading.jsx` / `StageTabs`):** For **API-backed** operations, Pre-Checking, Operational, and Post-Checking readiness uses hydration flags before rendering counts. Until persisted loads have **settled** (success or handled error), the tab meta line shows **`— / N complete`** instead of **`0 / N`**, keyed off parent state (`preCheckPersistHydrated`, `operationalPersistHydrated`, `postCheckPersistHydrated`). Pre/Post sub-processes are also hydrated in the parent page so completion/sign-off state does not depend on opening each tab first. Stale completions are ignored via `operationIdRef` when the user switches operation. Mock route vessels skip the unknown state. Documented functionally in **FUNCTIONAL-SPEC §9.1.5**; see **Docs/Plan/AT-BERTH-TWO-LEVEL-PHASE-AND-WORKSPACE-STAGE-PLAN.md** (Case A, Option A).

- **Pre-Checking**:
  - Checklist-style step navigator: Key Meeting, NOR Accepted, Inspection, Sampling, Initial Cargo Checking.
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
  - Final Inspection (merged from Final Tank + Final Hold Inspection):
    - Result text, documents, date & time.
    - `payload_json.inspectionType` auto-derived from SI commodity type (`Tank` for liquid, `Hold` for solid).
  - Final Cargo Checking (renamed from Final Sounding; still persisted under key `final_sounding` for compatibility):
    - Result text, documents, date & time.
    - `payload_json.cargoCheckingType` auto-derived from SI commodity type (`Sounding` for liquid, `Draft Survey` for solid).
  - When Final Inspection and Final Cargo Checking are completed (C1/C2), UI allows “Proceed to Clearance”.

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
   - CAST Off timestamp (`datetime-local`, required).
   - Document uploads & vessel photos.
   - On open, UI fetches `GET /operations/:id/activity-timeline` and computes `latestTimelineAt = max(startAt, endAt, occurredAt, sortAt, markedAt)` across returned events.
   - Validation: submit is blocked when `CAST Off < latestTimelineAt`; UI shows inline error and keeps the operation unchanged.
   - On valid submit, marks vessel as `departed`.

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

**Live dashboard:** Route **`/`** → **`Frontend/src/pages/DashboardV2.jsx`** (legacy **`Dashboard.jsx`** archived). Header filter bar: **Purpose** + **Commodity Type** multi-select + date range (**§0.29**, FUNCTIONAL-SPEC **§2.18**).

**Workflow (Dashboard V2 — `DashboardV2.jsx`)**:
- **Filter bar** (`.v2-filters`): **`DropdownMultiSelect`** for Purpose (`Loading` / `Unloading`) and Commodity Type (master **`GET /si-lookups`** **`commodities`**); **`DateRangePicker`** presets + From/To. Filters apply instantly; **`dashboardFilters.js`** derives **`filteredPlans`** / **`filteredOps`** / **`filteredAtBerth`**.
- **Vessel pipeline** (seven stages): **`computePipelinePartition(filteredPlans, filteredOps)`** — Shipment Plans through Sailed; links unchanged (`/shipment-plans`, `/allocation-plans`, `/at-berth`, `/verification`).
- **KPI row:** Slot occupancy (filtered berth occupants), Waiting to berth / Turnaround / On-time berthing (date-scoped plans + ops, filtered), SLA at risk (filtered ops). **Jetty status** uses raw **`GET /jetties`** (not filter-scoped).
- **At berth now:** Loading / Unloading phase counts from **`filteredAtBerth`**; clearance row from filtered pipeline/op stats.
- **Weekly trends** (`DashboardV2WeeklyTrends.jsx`): **`GET /dashboard-v2/weekly-trends`** with optional **`purpose`** / **`commodity_id`**; refetch on filter change; **`refreshing`** UI state.
- **Empty filter state:** Banner + KPI placeholders when active filters match no data.

**Workflow (legacy `Dashboard.jsx` — archived, reference only)**:
- **Vessel pipeline** card (`section.dashboard-pipeline`) is rendered **first** in the main column (after header, port chip, and optional API error banner), then the **Port activity chart + KPI grid** row — pipeline is the top-level summary of port flow.
- **Port activity chart** (`DashboardActivityChart.jsx`) in the **second row** left column (beside the KPI grid):
  - **Operations** mode: classifies `GET /allocation/overview` **`queue`** rows by **`purpose`** (Loading / Unloading; unknown purpose omitted) and by stage using shared helpers in `Frontend/src/utils/dashboardQueueClassification.js`. Counts **deduplicate** rows that share **`shipmentPlanId`** via **`allocationQueueVesselCallKey`** so one vessel call does not inflate **Planned berthing** / **Berthing** bars.
    - **Planned berthing:** `isPlannedBerthingQueueRow` — jetty set, no TB, operation status not in `DOCKED` / `IN_PROGRESS` / `POST_OPS` / `SIGNOFF_REQUESTED` / `SIGNOFF_APPROVED` (same idea as pipeline planned berthing).
    - **Berthing:** `isQueueRowBerthing` — TB set or status in that alongside set; **`shiftingOut` rows excluded**.
  - **Shipping instructions** mode: counts by `status` **`Approved` | `Submitted` | `Draft`** from `GET /shipping-instructions` (port-scoped); percentages use total of those three as denominator.
  - **Presentation:** **Y-axis** integer ticks (step sized from data max) with **dashed horizontal grid** lines; bar heights use the same scale (`yMax` ≥ max count in view). **Tooltip:** `createPortal` to `document.body`, positioned from `getBoundingClientRect` (flips if it would leave the left edge); lists **vessel names** collected when building series — queue: `vesselName` → `vesselId` → `—`; SI: same fields per row. Bars with count **0** are non-interactive. Scroll/resize closes the tooltip.
- **Weather** widget (mock `dashboardWeather` in `mockData`, “coming soon” overlay) is rendered at the **bottom** of the page (`section.dashboard-weather-footer`), not in row 1.
- Top KPIs (evolving; not all legacy PRD metrics are wired):
  - **Slot occupancy** — `Σ min(occupiedCount, capacity) / Σ capacity` from `GET /allocation/overview` **`berths`**, excluding jetties with master **`status = 'Out of Service'`** from the capacity denominator (`Dashboard.jsx`).
  - **Jetty status** (Available / Out of Service) from `GET /jetties?port_id=…` (rendered as a compact KPI card in the KPI grid).
  - Ready to sail / SLA at risk (from operations list).
- **KPI tooltips (drill-down)**:
  - **Slot occupancy** includes a **Details** tooltip listing occupied slots as `<jetty>-<lane> — <vessel name>` (portal tooltip; closes on scroll/resize/Escape).
  - **Jetty status** chips are hover/focus interactive and show tooltips listing the jetties in each bucket (Available / Out of Service).
  - **SLA at risk** value is hover/focus interactive and shows a tooltip listing `<vessel name>` with `<jetty>` and `+Xh over ETC`.
- **Performance card (non‑SLA)**:
  - Toggle: **24h / 7d** (frontend-only windowing).
  - Metrics computed client-side with mixed sources:
    - `GET /allocation/overview` **`queue`** for waiting/on-time metrics.
    - `GET /operations` (**`allOps`**) for turnaround so sailed rows can be included.
    - **Waiting to berth (median)**: median of `(TB − TA)` for rows with both timestamps, windowed by **TB**.
    - **Turnaround (median)**: median of `(end − TB)` where `end = castOffAt ?? actualCompletionTime`, windowed by **end**; includes operations that are already `SAILED`.
    - **On‑time berthing (%)**: `TB <= plannedEtbDateTime + 6h`, windowed by **TB**.
  - Drill-down uses the same portal tooltip pattern (`InteractiveTooltip.jsx`) listing worst/late cases with vessel + jetty + duration.
- **Implementation**: shared portal tooltip component `Frontend/src/components/InteractiveTooltip.jsx` (pattern mirrors `DashboardActivityChart.jsx` tooltip).
- Pipeline view (Shipping Instruction → Planned berthing → At-Berth → Clearance; **Allocation** is not a separate dashboard stage — use **Planned berthing** / **At-Berth** links to **`/allocation-plans`** and **`/at-berth`**; the **Shipment plans** stage links to **`/shipment-plans`**).
- **Awaiting berth** sidebar list was **removed** (redundant with pipeline **Planned berthing**). “Next arrivals / line-up” widget was also removed.
- Jetty status chips from `GET /jetties?port_id=…`.
- **Styles:** `Frontend/src/styles/dashboard.css` — `dashboard-row1__chart`, `.dashboard-activity-chart*`, `.dashboard-weather-footer`.

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

- `POST /auth/login` – login; returns **user** in JSON; **session cookies** **`jps_at`** + **`jps_xsrf`** (**§0.10**); rate-limited. Optional JSON **`token`** if **`AUTH_RETURN_TOKEN_BODY=true`**.
- `POST /auth/logout` – clears session cookies (**204**).
- `GET /auth/oidc/start` – initiates strict OIDC code flow + PKCE (Hub provider).
- `GET /auth/oidc/callback` – OIDC callback; validates token/JWKS; sets session cookies; redirects to public origin.
- `GET /auth/oidc/ready` – plain readiness probe for OIDC auth route reachability.
- `GET /users/me` – current user profile (session cookie or Bearer); same for effective permissions context elsewhere.
- `GET /users/me/sso-status` – linked OIDC state and **`authSource`** (`local` \| `sso`); used by **`UserMenu`** to show or hide self-service change password (**§0.27**).
- `PUT /users/me/password` – self-service password change for **`auth_source = 'local'`** only; body **`current_password`**, **`new_password`**; **204** on success (**§0.27**).
- `GET /users`, `GET /users/:id`, `POST /users`, `PUT /users/:id`, `DELETE /users/:id` (soft) – authentication required; cannot delete self. Admin **`PUT /users/:id`** optional **`password`** (min 6) does **not** require current password.
- **RBAC:** base path `/rbac` — `GET/POST /rbac/roles`, `GET/PUT/DELETE /rbac/roles/:id` (system roles not deletable); `GET/POST/DELETE /rbac/roles/:roleId/permissions[/:permissionId]`; `GET/POST/PUT/DELETE /rbac/permissions[/:id]`; `GET/POST/DELETE /rbac/users/:userId/roles[/:roleId]`.

### 3.2 Shipping Instructions

- `GET /shipping-instructions` – list SIs, with filters. Response rows include **`shipperNames`** (aggregated from breakdown lines) and **`breakdown[]`** with **`shipperId`** / **`shipperName`** per line. **No** header **`shipperId`**.
- `GET /shipping-instructions/:id` — same breakdown shipper shape; **`documents[]`** when applicable.
- `GET /shipping-instructions/npwp-master` – get **NPWP master** for the active port (or `?port_id=` when user is assigned to that port); returns `{ npwp, portId }`.
- `POST /shipping-instructions` – create. **`breakdown[]`** rows accept optional **`shipperId`**. **Reject** top-level **`shipper_id`** (**400**).
- `PUT /shipping-instructions/:id` — body may include **`approval_id`** / persisted **`approvalId`** for approved flows; **`breakdown[]`** with per-line **`shipperId`**; **reject** header **`shipper_id`**.
- `DELETE /shipping-instructions/:id` — guarded by RBAC `can_delete` and status rules (Draft/Submitted only).

### 3.2.1 SI lookups (master dropdown CRUD)

Base: `/si-lookups` — **all routes require an authenticated session** (including **`GET /si-lookups`** aggregate used for SI form dropdowns).

- `GET /si-lookups` – bulk bundle for dropdowns (requires auth).
- `GET /si-lookups/:type` – list items
- `GET /si-lookups/:type/:id` – get item
- `POST /si-lookups/:type` – create `{ value }`
- `PUT /si-lookups/:type/:id` – update `{ value }`
- `DELETE /si-lookups/:type/:id` – delete (blocked when referenced by SI breakdown or other master FKs; **shippers** blocked when **`shipping_instruction_breakdown.shipper_id`** references the row — **§0.31**)

Types are whitelisted by backend config (`Backend/src/routes/si-lookups.js`) and map to the corresponding SI master tables.

**List responses** include **`sortOrder`** (DB **`sort_order`**) and are ordered **`ORDER BY sort_order, <value column>`**. The **MasterSiLookup** UI does not expose **Sort order** for editing or table display (**§0.28**).

### 3.2.2 Demurrage Risk Calculator — candidates list & save ETC

**`GET /shipping-instructions/candidates`** (port-scoped via `requirePortScope`, same `X-Selected-Port-Id` as other SI routes)

- **Purpose:** Populate the **Demurrage Risk Calculator** vessel/SI picker with rows in an ETA window.
- **Query params:** `from`, `to` (ISO, inclusive overlap against `si.eta_from` / `si.eta_to`), `include_incoming` (`1`|`0`, default `1`), `include_berthed` (`1`|`0`, default `1`).
- **Port filter:** Row is included if `COALESCE(si.port_id, preferred_jetty.port_id) = selectedPortId` **or** there exists a non-`SAILED` operation for that SI with `operations.port_id = selectedPortId` (allocation path without SI `port_id`).
- **Sailed exclusion:** SIs whose **only** operations are `SAILED` are omitted (no “ghost” open rows).
- **Incoming vs Berthed:** Same classification idea as **Allocation** `getBerthingPlanStatus` (`Frontend/src/pages/Allocation.jsx`): **berthed** = operation exists, not `shifting_out`, and (`tb` set **or** status ∈ `DOCKED`, `IN_PROGRESS`, `POST_OPS`, `SIGNOFF_REQUESTED`, `SIGNOFF_APPROVED`); otherwise **incoming** (includes SI-only rows and pre-berth operations, e.g. jetty still null).
- **Response (per row):** `siId`, `referenceNumber`, `vesselName`, `purpose`, ETA fields, `commodity`, `berthingPlanStatus` (`incoming`|`berthed`), `jettyName` (from `operations.jetty_id` → `jetties.name` when set), optional nested `operation` summary (`id`, `status`, `dockingStartTime`, `estimatedCompletionTime`).

**`PUT /operations/:id/estimated-completion`** (session auth + port access via `canAccessOperationForSelectedPort`)

- **Body:** `estimated_completion_time` (ISO, required); optional `meta` object (audited: e.g. `tool: 'demurrage-risk-calculator'`, buffer, override flags) merged into activity log `meta`.
- **Effect:** Updates `operations.estimated_completion_time`; activity log **`pageKey`:** `demurrage-risk-calculator`.
- **Client:** `Frontend/src/api/operations.js` — `saveEstimatedCompletion`.
- **Calculator input model (UI):**
  - MT transfer term includes **all** SI breakdown rows with MT metric (not only first line).
  - Start timestamp precedence in UI estimate: `operations.docking_start_time` → `operations.tb_at` → `operations.etb` → `si.eta_from` → `si.eta_to`.
  - Scenario inputs are user-adjustable: `Q1`, `Q2`, `C` (default `1` hour each), `buffer` (default from SLA config), and optional override rate.
- **Calculator result model (UI):**
  - Shows decomposition: transfer term \(\sum(V/(Rate \times Buffer))\), base checks \((Q1+Q2+C)\), switch penalty \(((n-1)\times S)\), and total duration.
  - `n` is number of distinct material types in MT lines; `S` comes from SLA config (`s_hours`).

**Reference:** `Docs/Plan/DEMURRAGE-RISK-CALCULATOR-PLAN.md`, `Docs/FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md` §2.6.

### 3.3 Operations & SLA

- `GET /operations` – filter by port, jetty, status, purpose; optional query **`signoff_requested=1`** limits to rows with **`signoff_requested_at` set** and **`status` = `SIGNOFF_REQUESTED`** (pending approval).
- `GET /operations/pending-signoff-requests` – same pending rows for the selected port, **`can_approve` on page `loading`** required (**403** otherwise). Used by Clearance “Pending sign-off”.
- `GET /operations/:id`.
- `POST /operations` – create from SI (one operation per SI + jetty).
- `PUT /operations/:id`.
- `POST /operations/:id/shifting-out` – **shifting out / re-dock** (`shiftingOut`, optional `remark`, optional `activityLogPage`); see **§0.9**, **§3.5.2**.
- `POST /operations/:id/start-docking`
  - Body: none or optional manual `docking_start_time`.
  - Side-effects: sets `docking_start_time`, calculates SLA:
    - Load SLA config (`Q1`, `Q2`, `C`, `S_default`, `buffer_default`).
    - Load `operation_materials` and `standard_rates`.
    - Compute SLA duration:
      - \( SLA = Q1 + Q2 + C + \sum (V_n / Rate_n \times Buffer_n) + ((n-1) \times S) \).
    - Set `estimated_completion_time = docking_start_time + SLA`.
- `POST /operations/:id/recalculate-sla` – if volumes or config change.
- `POST /operations/:id/signoff-request` – berth team **requests** final sign-off. **RBAC:** **`can_edit`** on page **`loading`**. **Body:** optional `remark` (trimmed, max 4000 chars). **Rules:** `status` must be **`POST_OPS`**; **`signoff_requested_at` must be null**; before eligibility check, backend normalizes legacy rows by setting `completion_percent = 100` when status is `POST_OPS` but completion remains below 100; then **`checkSignoffEligible`** must pass (same gates as sign-off). Sets **`status` = `SIGNOFF_REQUESTED`**, **`signoff_requested_at`**, **`signoff_requested_by`**, **`signoff_request_remark`**; activity log **`pageKey`:** `loading`.
- `POST /operations/:id/signoff` – **final approval:** sets **`SIGNOFF_APPROVED`** + `operations_completed_at` when:
  - **RBAC:** **`can_approve`** on page **`loading`** (**403** if missing).
  - **`status` must be `SIGNOFF_REQUESTED`** (a prior **signoff-request**).
  - Gates: **`checkSignoffEligible`** as below (re-checked at approve time).
  - `exception_status === APPROVED` (skips gates), **or**
  - `completion_percent === 100`, all QC surveys `Done`, at least one Pre- + one Post-Checking `Done` (when any QC rows exist), and all Operational `quantity_checks` have `occurred_at`.
  - Activity log **`pageKey`:** `loading`.
- **`operations` columns (migration `049_operations_signoff_request.sql`):** `signoff_requested_at`, `signoff_requested_by` → `users.id`, `signoff_request_remark` (retained after **`SIGNOFF_APPROVED`** for audit).
- `POST /operations/:id/request-exception` – body `justification`, optional `exception_document_url`; sets `PENDING` (before terminal at-berth statuses / `SAILED`).
- `POST /operations/:id/approve-exception` – body optional `approver_user_id`.
- `POST /operations/:id/reject-exception` – body optional `approver_user_id`.
- `POST /operations/:id/depart` – after the operation is **`SIGNOFF_APPROVED`**; body `cast_off_at` (ISO, required), optional `clearance_document_url`, `vessel_photo_url`. Sets **`actual_completion_time = COALESCE(actual_completion_time, cast_off_at)`** on sailed operations (and plan mirror). When **`shipping_instructions.shipment_plan_id`** is set, the backend sails **all** sibling **`SIGNOFF_APPROVED`** operations and updates **`shipment_plans`** using the same transaction helper as **`POST /shipment-plans/:id/depart`**.
- `POST /shipment-plans/:id/depart` – plan-first depart endpoint (see **§3.5.3A**); preferred from **Clearance** when the UI row carries **`shipmentPlanId`**.
- **Clearance UI rule (frontend guard):** before calling depart, `Verification.jsx` loads **`GET /operations/:id/activity-timeline`** for **each** sibling operation on the plan (when collapsed) and rejects `cast_off_at` earlier than the **maximum** latest timestamp. This aligns cast-off with the **combined** **Detailed At-Berth Executions Log** across SIs on the call.
- **UI entrypoint policy:** Loading/Unloading hub (`Loading.jsx`) supports **request sign-off** and pending-state visibility only; final approval action is routed through **Clearance** (`Verification.jsx`) as the single approval entry point.

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
  - `id`, `operation_id`, `phase`, `sub_process_key`, `status`, `occurred_at`, optional interval fields `start_at` / `end_at` (for duration in UI and reporting), `skip_reason`, `remark`, `payload_json`, audit timestamps, `deleted_at`.
  - Unique active row target: `(operation_id, phase, sub_process_key)` where `deleted_at IS NULL`.
- `operation_sub_process_documents`:
  - `id`, `sub_process_id`, file metadata fields, timestamps, `deleted_at`.
- `operation_nor_details` (dedicated NOR detail):
  - `id`, `operation_id`, `remark`, optional metadata JSON, timestamps, `deleted_at`.

#### 3.4A.3 Planned API surface

- Generalized sub-process:
  - `GET /operations/:id/sub-processes?phase=Pre-Checking`
  - `PUT /operations/:id/sub-processes/:subProcessKey` (upsert semantics)
- **Activity timeline (merged log):** `GET /operations/:id/activity-timeline` (`Backend/src/routes/operation-operational-activities.js`) returns a sorted list of events for the **Detailed At-Berth Executions Log**. Sub-process events use `source: 'sub_process'` with `startAt` = `start_at ?? occurred_at`, `endAt` = `end_at`, and `occurredAt` for sorting/legacy; the frontend maps these to **Start**, **End**, and **Duration** the same way as operational activity rows when both interval ends are present. Each event includes **`status`** (sub-process row status), **`remark`**, and **`documents`**: for `sub_process`, `documents` is an ordered array of `{ id, name, url, mimeType, createdAt }` (download URL in **`url`**; preview maps to **`/view`** — **§0.30**), populated in the same SQL read as the sub-process row via `LEFT JOIN LATERAL` + `jsonb_agg` so document rows always match the correct `operation_sub_processes.id`; for operational rows `documents` is `[]`. If a legacy server omits `documents` on sub-process events, the SPA may backfill via `GET .../sub-processes/:key/documents` per row. The **Detailed At-Berth Executions Log** table (`Frontend/src/components/OperationActivityTimeline.jsx`) shows **Status**, **Remark**, and **Documents** as separate columns; document names use **`FilePreviewLink`** to open the shared preview modal (**§0.30**, FUNCTIONAL-SPEC **§2.19**).
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
- `inspection` -> `operation_sub_processes` (`payload_json.inspectionType`: `Tank` | `Hold`, derived from SI commodity type; **Loading only** — not used for Unloading)
- Legacy keys `tank_inspection` / `hold_inspection` are migrated to `inspection` (see migrations `052`, `053`).
- `sampling` -> `operation_sub_processes` (`payload_json.records`)
- `initial_cargo_checking` -> `operation_sub_processes` (`payload_json.cargoCheckingType`: `Sounding` | `Draft Survey`; **remark** column for free text; legacy `initial_sounding` / `initial_draft_survey` merged via migration `053`)
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
  - `status TEXT NULL CHECK (status IN ('Pending','In Progress','Done','Skipped','N/A'))`
  - `occurred_at TIMESTAMPTZ NULL`
  - `start_at TIMESTAMPTZ NULL`, `end_at TIMESTAMPTZ NULL` (interval for duration; `PUT` upsert accepts `startAt` / `endAt`)
  - `skip_reason TEXT NULL`
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
- `inspection` (Loading only)
- `sampling`
- `initial_cargo_checking`
- `nor_accepted` (sub-process mirror; `end_at` not used — single start / NOR timestamps from `operations` + `operation_nor_details`)

Target sub-process keys for Post-Checking phase:

- `final_inspection` (merged Final Tank/Hold Inspection; compatibility: legacy rows may still use `final_tank_inspection` / `final_hold_inspection`)
- `final_sounding` (UI label **Final Cargo Checking** for continuity with existing storage key)

Notes:

- NOR timestamps remain in `operations` (`nor_tendered_at`, `nor_accepted_at`) for operational queries and existing Allocation/overview logic.
- NOR remark/details move to `operation_nor_details` (tab-scoped remark, no global remark coupling).
- Phase 1 does not drop or rename existing `qc_surveys` / `quantity_checks`; deprecation is post-stabilization.

### 3.5 Allocation & Jetty

**Master / jetty CRUD**

- `GET /ports`, `POST /ports`, `PUT /ports/:id`.
- `GET /jetties`, `POST /jetties`, `PUT /jetties/:id`.
  - JSON includes optional **`rtspLink`** from **`jetties.rtsp_link`** (migration **077**). Create/update accept body **`rtsp_link`**; trimmed empty string → `NULL`; max **512** chars (**400** if longer). See **§0.26**.
- `PUT /jetties/:id/status` – status = Available / Out of Service.
  - Before applying **Out of Service**, the handler counts **blocking** `operations` for that `jetty_id`: `deleted_at IS NULL`, `status <> 'SAILED'`, `COALESCE(shifting_out, false) = false` (`Backend/src/lib/jetty-blocking.js`).
  - If count **> 0**, responds **409** — client must reassign or complete operations on Allocation first.

#### 3.5.5 Jetty Live stream helper (host process, not JPS API)

Deployed per **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**. Summary:

| Endpoint (on stream host) | Method | Purpose |
|---------------------------|--------|---------|
| `/api/health` | GET | JSON health for Jetty Live UI card (`viewerCount`, `outputFps`, `idleStopMs`, `ffmpegRunning`, …) |
| `/api/reconnect` | POST | Optional `{ rtspUrl }` — switch RTSP source; restarts FFmpeg **only if** at least one WebSocket viewer is connected |

Browser access in production: same origin **`/jetty-live-stream/*`** and **`/jetty-live-ws`** via nginx → host **3081** / **9999**. Dev: Vite proxy to **3080** / **9999** on localhost.

**On-demand policy:** FFmpeg runs only while **`viewerCount > 0`**; idle stop after **`STREAM_IDLE_STOP_MS`** (default **30 s**) when the last viewer disconnects.

**Single-stream policy:** one FFmpeg input per `rtsp-stream-viewer` instance while viewers are connected; schematic / Jetty Live reconnect with a new jetty URL replaces the previous camera (**last opened wins**).

**Transcode rate:** **`STREAM_OUTPUT_FPS`** env (default **1**).

#### 3.5.1 `GET /allocation/overview`

Returns `{ queue, berths, scheduleQueue }`.

- **`queue`**: union of (a) **active operations** (`status <> 'SAILED'`) joined to SI + jetty, and (b) **approved SIs without an operation**. Each row is normalised in **`formatListRow`** (`Backend/src/routes/allocation.js`).
- **`scheduleQueue`**: schedule-focused union with the same row shape as `queue`, but operations are sourced from a schedule query that includes:
  - non-`SAILED` operations, plus
  - `SAILED` operations within configured lookback (`COALESCE(cast_off_at, actual_completion_time, updated_at)` >= `NOW() - lookbackDays`).
  Incoming approved SI rows are included here as well.
- **Key camelCase fields** (non-exhaustive): `id`, `vesselId`, `operationId`, **`shipmentPlanId`**, `shippingInstructionId`, `vesselName`, `shippingInstruction`, `commodity`, `purpose`, `priority`, `noPkk`, `remark`, **`shiftingOut`**, **`shiftingOutAt`**, `eta`, `etb`, `jetty`, `etaDateTime`, `taDateTime`, `etbDateTime`, `tbDateTime`, `pobDateTime`, `sobDateTime`, `estimatedCompletionDateTime`, `actualCompletionDateTime`, `castOffDateTime`, `status`, `norDocuments`, **`recordLastUpdatedAt`**, **`recordLastUpdatedByDisplayName`**, **`shipper`** (comma-separated distinct names from **`shipping_instruction_breakdown.shipper_id`** — **§0.31**), **`agent`**, **`surveyor`** (from `si_agents` / `si_surveyors` joins; agent may fall back to **`shipment_plans.agent_id`**).
- **`eta` / `etb`**: short display strings from SQL `to_char(… AT TIME ZONE 'UTC', 'DD/MM HH24:MI')` — **no** trailing ` LT` suffix.
- **`berths`**: jetty list with occupancy derived from operations where **TB is set** and/or status in DOCKED / IN_PROGRESS / POST_OPS / SIGNOFF_REQUESTED / SIGNOFF_APPROVED **and `shifting_out` is false** (shifted-out vessels must not occupy a bank slot).

#### 3.5.2 `POST /operations/:id/shifting-out`

See **§0.9** (request/response, remark persistence, activity log, client helpers).

#### 3.5.3 `PUT /allocation/arrival`

- **RBAC:** Requires **`can_edit`** on **`allocation-plan`** (`userHasAllocationPlanEdit`); otherwise **403**.
- After resolving optional body **`jetty`** string to **`jetties.id`** for the selected port, if the jetty row’s **`status`** is **`Out of Service`**, responds **409** and rolls back (no partial update).
- Resolves the **`shipment_plans`** row from the queue context and updates **plan-level** fields first: ETA, TA, ETB, POB, TB, SOB, NOR times, remark, priority, `no_pkk`, `jetty_id`, **`estimated_completion_time`**, **`actual_completion_time`**, plan **`updated_by`** / **`updated_at`**, etc.
- Updates the linked **`operations`** row for the same payload where the backend mirrors fields for legacy paths; when **TB** is provided, sets **`status = DOCKED`** if previously PENDING / ALLOCATED / empty and syncs **`docking_start_time`** with TB where applicable.
- When **`tb`** is non-null and the SI belongs to an **Approved** shipment plan, **every other SI on that plan** gets the same arrival payload applied to its **latest** operation (creating the operation and jetty operation code when missing); **`SAILED`** sibling operations are skipped. **`shipping_instructions.status`** is not changed (document lifecycle remains Draft / Submitted / Approved).

#### 3.5.3A `POST /shipment-plans/:id/depart`

- **RBAC / scope:** Same **`requireAuth`** + **`requirePortScope`** as other operational routes; plan must belong to **`req.selectedPortId`**.
- **Body:** `cast_off_at` (ISO, required), optional `clearance_document_url`, `vessel_photo_url` (mirrors **`POST /operations/:id/depart`**).
- **Behaviour:** Uses **`departShipmentPlanInTransaction`** (`Backend/src/lib/shipment-plan-depart.js`) to sail **all** **`SIGNOFF_APPROVED`** child operations and set **`shipment_plans`** cast-off / evidence / `sailed_at`. Activity log may use **`entityType: ShipmentPlan`** for this entry (`Backend/src/routes/shipment-plans.js`).

#### 3.5.4 `GET /operations/at-berth`

Used by Dashboard and other consumers. Selection:

- `deleted_at IS NULL`, **`status <> 'SAILED'`**, and **any of**:
  - `status IN ('DOCKED','IN_PROGRESS','POST_OPS','SIGNOFF_REQUESTED','SIGNOFF_APPROVED')`, or
  - **`tb IS NOT NULL`**, or
  - **`docking_start_time IS NOT NULL`**.

Ensures berthed vessels appear even if status and TB were temporarily out of sync.

### 3.6 SLA & Rates

- `GET /sla-config` / `PUT /sla-config`.
- `GET /standard-rates` / `POST` / `PUT /standard-rates/:id`.

### 3.7 Dashboard & Weather

**Implemented (Dashboard V2):**

- **`GET /dashboard-v2/weekly-trends`** — port-scoped (`requirePortScope`). Query: **`start_date`**, **`end_date`** (required); optional **`purpose`** (`Loading` \| `Unloading`, repeatable); optional **`commodity_id`** (int, repeatable). Response: `{ totalSlots, weeks: [{ startDate, endDate, slotOccupancyPct, berthOccupiedPlans, approvedPlans, sailedCount, slaAtRiskCount, slaOverHoursSum }] }`. Week chunks are consecutive segments of up to 7 UTC days within the requested range. Filter SQL: **§0.29**. Client: **`Frontend/src/api/dashboardV2.js`**.

**Supporting list data (client-side dashboard filtering, not weekly API):**

- **`GET /shipment-plans?start_date&end_date`** — plan list includes **`shippingInstructions[].breakdown[]`** with **`commodityId`** for commodity matching on early pipeline stages (**§0.29**).
- **`GET /operations?start_date&end_date`**, **`GET /operations/at-berth`**, **`GET /allocation/overview`**, **`GET /jetties`**, **`GET /si-lookups`** — see **§0.29** fetch table.

**Target / not yet wired:**

- `GET /dashboard/summary` – pipeline counts, occupancy, SLA metrics (target; Dashboard V2 computes most KPIs client-side from existing endpoints).
- `GET /dashboard/weather?port_id=...` – proxy to Google Weather API (target). **Legacy UI:** mock weather at bottom of archived **`Dashboard.jsx`** until this is wired.

### 3.8 Audit Trail

- `GET /audit-log` – admin-only, filter by entity type, user, date.

### 3.8A Activity Log Contract (Page-Level Panel)

The in-app Activity Log panel (`ActivityLogPanel`) renders expandable details only when `changes` is a non-empty array.
To keep behavior consistent across all pages/modules, backend writers MUST follow this contract when calling `writeActivityLog(...)`:

- Required:
  - `pageKey` (route/page scope: `shipment-plan`, `allocation-plan`, `loading`, `verification`, etc.; retired: `shipping-instruction`, `allocation`)
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
- **Optional auth**: some routes still use `optionalAuth` so a valid JWT sets `req.userId` for `actorUserId` where applicable. **`PUT /allocation/arrival`** is **not** optional-auth: it requires authenticated user + **`allocation-plan`** **can_edit**; `actorUserId` is always set for successful writes from the UI.

**Logged areas (non-exhaustive)**:

- `PUT /allocation/arrival` — arrival/NOR/jetty/priority/remark/estimated completion diffs.
- `operation-documents` — upload/delete with per-file `changes`.
- `operation-sub-processes` — sub-process upsert (phase, status, occurred_at, remark; sampling adds consolidated **Sampling Records** string); document upload/delete; NOR details (remark + payload fields such as NOR Source / Stage / Updated Via).
- `operations` — lifecycle updates (status, completion, docking, exceptions, signoff, depart, etc.) with field-level `changes` where applicable.
- `POST /operations/:id/shifting-out` — **Shifting out** / **Re-docked** / **Shift-out cleared** summaries; `changes` for **Shifting out** and **Remark** when applicable; `pageKey` from body **`activityLogPage`** (`allocation-plan` vs `at-berth`; legacy `allocation` → `allocation-plan`); **`meta.shiftingOut`** (see **§0.9**).

### 3.9 Frontend shared utilities (date/time)

| Export | Module | Behaviour |
|--------|--------|-----------|
| `formatDateTimeDisplay` | `Frontend/src/utils/formatDateTimeDisplay.js` | Parses ISO / timestamps / `datetime-local`-like prefixes → **`DD/MMM/YYYY HH:mm`** (24-hour) in **browser local** time. Locale-aware month abbreviations via `jps_locale` (`en` → `en-GB`, `id` → `id-ID`). If unparseable, returns string with trailing **` LT`** removed (legacy API text). Empty → `—`. |
| `formatDateDisplay` | `Frontend/src/utils/formatDateTimeDisplay.js` | Date-only values (`YYYY-MM-DD` or ISO) → **`DD/MMM/YYYY`**. Same locale rules as `formatDateTimeDisplay`. Empty → `—`. |
| `stripLegacyDatetimeLt` | same | Removes trailing **` LT`** (case-insensitive) only. |
| `getClientIanaTimeZone` / `getScheduleEntryTimeZone` | `Frontend/src/utils/scheduleDateTime.js` | Resolved **browser IANA** zone (`Intl`). **`getScheduleEntryTimeZone`** is the zone used when converting **naive** `datetime-local` values to/from API ISO for schedule fields (see **§0.20**). |
| `normalizeForApi` / `normalizeForApiOrEmpty` | same | Normalises schedule strings for PUT/POST: zoned/UTC ISO passes through; naive `YYYY-MM-DDTHH:mm` is interpreted in the **second-arg IANA zone** (callers pass **`getScheduleEntryTimeZone()`** for operational schedules). |

**Current import sites:** `Allocation.jsx`, `AtBerthExecutions.jsx`, `Loading.jsx`, `VesselReport.jsx`, `DailyActivitiesReport.jsx`. Prefer this module for new UI datetime display.

### 3.10 Operation documents (upload & download)

- `POST /api/v1/operation-documents/operations/:operationId/:kind` — multipart `files`; kinds used in UI include **`NOR`** (Log arrival update) and **`BERTHING`** (Confirm Berthing / vessel photos), stored in **`operation_documents`** with paths under uploads. **Server validates file content** (magic bytes) against an allowlist (**§0.10**); invalid types rejected with **400**.
- `GET /api/v1/operation-documents/operations/:operationId/:kind` — list metadata; each item includes **`url`** pointing at **`.../:id/download`**.
- `GET /api/v1/operation-documents/:id/view` — **inline preview** (`Content-Disposition: inline`); same auth + port scope as download (**§0.30**).
- `GET /api/v1/operation-documents/:id/download` — **attachment download** (`Content-Disposition: attachment` via **`sendStoredFileAttachment`**).
- `DELETE /api/v1/operation-documents/:id` — soft-delete metadata + best-effort disk remove.

**Sub-process documents** (`Backend/src/routes/operation-sub-processes.js`):

- `GET /api/v1/operations/:operationId/sub-processes/:subProcessKey/documents` — list.
- `POST /api/v1/operations/:operationId/sub-processes/:subProcessKey/documents` — upload.
- `GET /api/v1/sub-process-documents/:documentId/view` — inline preview.
- `GET /api/v1/sub-process-documents/:documentId/download` — attachment download.

**SI source documents** (`Backend/src/routes/si-documents.js`):

- `POST /api/v1/si-documents/extract` — upload + optional OCR.
- `GET /api/v1/si-documents/:id/view` — inline preview.
- `GET /api/v1/si-documents/:id/download` — attachment download.
- `DELETE /api/v1/si-documents/:id` — soft-delete.

### 3.10C SPA file preview (2026-05-25)

See **§0.30**. Summary:

- **`FilePreviewProvider`** in **`App.jsx`** exposes **`openFilePreview`** app-wide.
- Document links use **`FilePreviewLink`** instead of **`<a target="_blank">`** to **`/download`** URLs.
- Berthing photo thumbnails use **`AuthenticatedFileImage`** + click → preview modal.
- **`resolvePreviewSrc`** maps download URLs to **`/view`**, then **`fetchAuthenticatedBlobUrl`** when the target is an API document path (session cookie + **`X-Selected-Port-Id`**).
- Modal footer **Download** calls **`triggerFileDownload`**, which also uses authenticated fetch for API URLs before programmatic save.

### 3.10A Static file serving (`/uploads`)

- **Upload root**: `Backend/src/paths.js` exports `UPLOAD_ROOT` from `process.env.UPLOAD_DIR` when set, otherwise `Backend/uploads` resolved from the backend package (not `process.cwd()`), so static serving and multer paths stay consistent regardless of start directory.
- **Express**: `app.use('/uploads', express.static(UPLOAD_ROOT))` in `Backend/src/index.js`.
- **Startup**: `Backend/src/index.js` creates `UPLOAD_ROOT` if missing and verifies writability; in **`NODE_ENV=production`**, a non-writable upload directory is fatal.
- **Docker (production / Alicloud)**: `docker-compose.backend.yml` sets **`UPLOAD_DIR=/var/jps/uploads`** and mounts named volume **`jps_uploads:/var/jps/uploads`** on **`jps-api`**. Files persist across container rebuilds. See **ALICLOUD-DEPLOYMENT-GUIDE §5.2A** for migration from ephemeral `/tmp` paths and backup procedure. **Never `docker compose down -v`** on production (deletes **`jps_uploads`** and **`jps_pgdata`**).
- **Docker (local dev)**: `Backend/docker-compose.yml` uses the same **`jps_uploads`** named volume at **`/var/jps/uploads`** — avoids Windows host bind-mount stalls while keeping uploads across restarts.
- **Frontend**: `resolveUploadUrl()` in `Frontend/src/api/client.js` prefixes relative `/uploads/...` paths with the API **origin** derived from `VITE_API_BASE_URL`, so links opened from the Vite dev server hit the API host.
- **Vite dev**: `Frontend/vite.config.js` may proxy `/uploads` to the API for any remaining relative requests.

### 3.10B Multipart uploads from the SPA

- `apiPostForm(path, FormData, timeoutMs)` in `Frontend/src/api/client.js` — uses **`credentials: 'include'`**, **CSRF header** when applicable, and a longer default timeout for uploads.
- `uploadOperationDocuments` and `uploadSubProcessDocuments` (`Frontend/src/api/allocation.js`, `Frontend/src/api/operations.js`) use `apiPostForm`; sub-process upload includes `phase` in the URL query as well as the form field for robustness.

---

## 4. Data Model (Relational)

Entities follow the design already outlined in the previous answer; key ones:

- `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- `ports`, `jetties`, `jetty_status_history`. **`jetties.rtsp_link`** (`TEXT`, nullable, migration **077**) — optional RTSP URL for Jetty Live CCTV (**§0.26**).
- `shipping_instructions` — includes **`approval_id`** (migration **`019`**). Migration **`025_si_loading_document_and_approve_rbac.sql`** adds Loading document fields: **`voyage_no`**, **`destination_text`**, **`freight_terms`** (check: PREPAID, COLLECT, AS_PER_CHARTER_PARTY, OTHER), **`bill_of_lading_clause`**, **`consignee_text`**, **`notify_party_text`**, **`bl_indicated`**, **`document_date`**, and approval audit: **`approved_by_user_id`**, **`approved_at`**, **`approver_name_snapshot`**, **`approver_title_snapshot`**. API exposes camelCase equivalents (e.g. **`destinationText`**, **`freightTerms`**, **`approverNameSnapshot`**). **Header `shipper_id` removed** by migration **079** (**§0.31**).
- `shipping_instruction_breakdown` — one row per commodity/contract line: **`commodity_id`**, **`metric_id`**, **`qty`**, contract/PO/SO text fields, **`line_order`**, and **`shipper_id`** (nullable FK → **`si_shippers`**, migration **079**). Legacy **`shipper_text`** dropped in **079**.
- `si_shippers` — master lookup for shipper names; referenced by **`shipping_instruction_breakdown.shipper_id`** only (post-079).
- `si_port_npwp` — per-port **NPWP master** used for Shipping Instruction display (read-only in SI form/view/approval); unique active row per `port_id` (migration **`047_si_port_npwp.sql`**).
- `users` — optional **`job_title`** (migration **`025`**) used when populating approver title snapshot (fallback: `OPERATION HEAD`).
- `role_permissions` — **`can_approve`** boolean (migration **`025`**); merged in **`GET /rbac/me/page-permissions`** as **`canApprove`** per page. Shipping Instruction approval on **PUT** `/shipping-instructions/:id` when transitioning to **Approved** requires **`can_approve`** for resource_key **`shipment-plan`**. **Operation sign-off** (**`POST /operations/:id/signoff`**) requires **`can_approve`** for resource_key **`loading`** (Admin UI: **Approve operation sign-off** under Loading / Unloading).
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
- HTTPS in Testing and Production (required for **`Secure`** session cookies in production builds).
- Passwords with strong hashing (**bcrypt**); **JWT** carried in **HttpOnly cookie** for browser SPA, optional Bearer for scripts; **CSRF** protection on unsafe API methods when using cookie session (**§0.10**).
- Self-service password change requires verifying **current password**; SSO accounts blocked at API and UI (**§0.27**).
- **Login** endpoint rate-limited per IP; **`trust proxy`** configurable behind load balancers.
- **SI master aggregate** and upload pipelines include additional hardening (auth on **`GET /si-lookups`**, magic-byte checks on uploads).
- Production **nginx** template includes baseline **security headers** / **CSP** (`nginx.conf`); validate in staging per deployment hostname.
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
    - Connect `MasterPort` and `MasterJetty` UIs (list tables: client sort/filter per **§0.28**).

12. **Jetty status**
    - Extend `jetties` with status field.
    - Add status control (Available/Out of Service) in Master or dedicated Ops page.
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

