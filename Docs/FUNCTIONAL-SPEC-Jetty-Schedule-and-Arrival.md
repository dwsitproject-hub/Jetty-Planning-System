# Functional specification — Jetty schedule Gantt & arrival updates

**Product:** Jetty Planning & Monitoring System (JPS)  
**Scope:** Features delivered for **Allocation → Jetty schedule**, **Log arrival update**, **Confirm Berthing**, **At-Berth Executions list**, and **user-visible date/time presentation** (Gantt bar logic, estimated completion, and related UI).  
**Audience:** Product, QA, and engineering (for regression and extension).  
**Version:** 1.2 (see document history at end).

---

## 1. Purpose

This document describes **behaviour that is implemented in code**, including:

- Jetty schedule **Gantt** rendering rules (planned vs actual, segment types, end dates).
- **Estimated completion** capture in UI and persistence via the allocation API.
- **Confirm Berthing** saving arrival-related fields (including estimated completion) to the backend.
- Related **cosmetic** behaviour on the Gantt (reset control, intro area, removal of a confusing planned segment).
- **At-Berth Executions** list: what the user sees, which data it reflects, columns, expandable details, and summary cards.
- **Date/time labels** shown in the UI (no misleading “LT” suffix; consistent formatting where the shared formatter is used).

For API field names, database columns, and shared code modules, see **TECH-SPEC-Jetty-Planning-System.md** and **§6** below for arrival/estimated completion mapping.

---

## 2. User-facing features

### 2.1 Jetty schedule (Gantt)

| Feature | Description |
|--------|-------------|
| **Date range** | User selects **From** / **To** (inclusive start, end date handled as calendar range in the component). |
| **Reset** | Button label **Reset** — restores the default range (**today** → **today + 1 month**). |
| **Intro line** | The schedule keeps an intro `<p>` wrapper for layout; **long instructional copy was removed**. Only **validation errors** (invalid range, range too large) appear there. |
| **Compare plan vs actual** | On narrow viewports, a checkbox toggles dual **Planned** / **Actual** lanes; wide viewports show both by default. |
| **Legend** | Explains **Planned (known)** vs **Planned (open end)**, **Actual (known)** vs **Actual (open end)**, and **Now** line. |
| **Vessel icon** | Bars use an **inline SVG** ship icon (avoids emoji rendering issues on Windows). |
| **Click vessel** | Where configured, clicking a bar selects the vessel for details. |
| **Removed segment** | The **planned “transit” sliver** from **ETA → planned ETB** was **removed** — it was visually confusing; the Gantt does not draw that segment anymore. |

### 2.2 Log arrival update (modal)

- Includes **Estimated completion** as a **`datetime-local`** input, consistent with other date/time fields on the form.
- Saving uses the allocation **arrival** API (see §6); value is stored on the operation record.

### 2.3 Confirm Berthing (modal)

- Includes **Estimated completion** (`datetime-local`), aligned with Log arrival update.
- **Confirm Berthing** persists data via the same **arrival** API **before** applying local UI state; the button shows a **saving** state while the request runs.

---

## 3. Gantt data inputs (per queue row)

Segments are built from allocation overview **queue** rows. Relevant fields:

| Concept | Typical row fields (API/camelCase) |
|--------|-------------------------------------|
| Planned alongside start | `plannedEtbDateTime`, else `etbDateTime` |
| Actual time of arrival (berth approach) | `taDateTime` |
| Actual alongside / berth | `tbDateTime` |
| Estimated completion | `estimatedCompletionDateTime` |
| Actual completion | `actualCompletionDateTime` |
| Cast-off (optional end proxy) | `castOffDateTime` |

**Display-only constants**

- **Default tail:** **+3 calendar days** from a reference start when an end is unknown (72 hours in milliseconds in code).
- **“Known” vs “open end”** is expressed visually: **solid** bar vs **gradient** (faded tail).

---

## 4. Segment types

For each vessel row with a jetty id, the chart may draw:

1. **Planned · alongside** — from **planned ETB** (planned or ETB) to a computed end (§5.1).
2. **Actual · transit — TA → TB** — when **TA and TB** exist and **TB > TA** (fixed segment).
3. **Actual · transit — TA only (TB TBD)** — when **TA** exists but **TB** does not; end follows **§5.3**.
4. **Actual · alongside** — only when **TB** exists; from **TB** to a computed end (§5.2).  
   - If **TB is missing**, the **alongside** bar is **not** drawn (user requirement: do not show alongside until alongside has started).

---

## 5. End-date decision logic

The matrix uses:

- **Estimated completion** = `estimatedCompletionDateTime` parsed as time (`estComp`).
- **Actual completion** = `actualCompletionDateTime` parsed as time (`actComp`) for branch selection.
- **Cast-off** = `castOffDateTime` — used as a **fallback known end** for the **alongside** bar when **both** completion fields are empty (see §5.2 branch “both NULL”).

Invalid dates (e.g. end **not after** start) fall back to **+3 days** from the relevant start with an **open end** / indicative behaviour so bars never go “backwards”.

### 5.1 Planned · alongside (from planned ETB)

| Condition | Planned end | Style |
|-----------|-------------|--------|
| `estComp` set and **after** planned ETB | `estComp` | Known (solid) |
| Otherwise | planned ETB **+ 3 days** | Open end (gradient) |

Planned end **does not** depend on whether actual completion is filled; it reflects **plan** vs **ETB + default** when estimate is missing or invalid.

### 5.2 Actual · alongside (only if **TB** is set)

Let `actualEnd = actComp ?? castOff` (known physical end when completion field empty but cast-off recorded).

| # | Estimated | Actual completion (field) | Alongside end | Style |
|---|-----------|----------------------------|---------------|--------|
| 1 | NULL | NULL | If `actualEnd > TB` → `actualEnd`; else **TB + 3 days** | Solid if `actualEnd`; else open end |
| 2 | Set | NULL | If `estComp > TB` → `estComp`; else **TB + 3 days** | **Open end** (provisional to estimate) |
| 3 | NULL | Set | If `actComp > TB` → `actComp`; else **TB + 3 days** | Solid if valid |
| 4 | Set | Set | If `actComp > TB` → `actComp`; else **TB + 3 days** | Solid if valid |

### 5.3 Actual · transit when **TA** set and **TB** not set

A single **actual** bar runs from **TA** to a computed end so that **case (2)** is visible even before TB exists (otherwise the UI showed **TA + 3 days** while planned showed estimated completion).

Uses the same four-way idea on **`estComp`** / **`actComp`**:

| # | Estimated | Actual completion (field) | End from TA | Style |
|---|-----------|----------------------------|-------------|--------|
| 1 | NULL | NULL | **TA + 3 days** | Open end |
| 2 | Set | NULL | If `estComp > TA` → `estComp`; else **TA + 3 days** | Open end to estimate when valid |
| 3 | NULL | Set | If `actComp > TA` → `actComp`; else **TA + 3 days** | Solid when valid |
| 4 | Set | Set | If `actComp > TA` → `actComp`; else **TA + 3 days** | Solid when valid |

When **TB** is later recorded, the chart shows **TA → TB** transit plus the **alongside** segment from **§5.2**.

---

## 6. API & database (estimated completion)

| Item | Detail |
|------|--------|
| **Endpoint** | `PUT /api/v1/allocation/arrival` (relative to API base; client wraps as `PUT /allocation/arrival`). |
| **Purpose** | Persist “Log arrival update” style fields on the linked **operation**, including estimated completion. |
| **Request body (relevant)** | Includes `estimatedCompletionDateTime` (ISO or empty string to clear, per client/backend parsing). |
| **Table** | `operations` |
| **Column** | `estimated_completion_time` (`TIMESTAMPTZ`), updated when arrival payload includes estimated completion. |

Other arrival fields (ETA, TA, ETB, NOR times, remark, priority, jetty, `no_pkk`, etc.) remain as implemented in the same route.

---

## 7. Implementation references

| Area | Location |
|------|----------|
| Gantt UI & segment logic | `Frontend/src/components/JettyScheduleGantt.jsx` |
| Allocation page, modals, berthing confirm save | `Frontend/src/pages/Allocation.jsx` |
| Allocation API client | `Frontend/src/api/allocation.js` |
| Arrival route | `Backend/src/routes/allocation.js` |
| DB — operations estimated completion | Migrations defining `operations.estimated_completion_time` (e.g. `Backend/migrations/004_shipping_operations_tables.sql` and related) |

---

## 8. Out of scope / follow-ups

- **Business-day** or **working-hours** tails (current default is **calendar** +3 days).
- **Cast-off** in the **four-way matrix** for transit/TB-missing rows (matrix uses **actual completion field**; cast-off is used for alongside “both NULL” end).
- **Configurable org timezone** (e.g. WIB): not implemented; times follow browser local formatting unless otherwise noted in TECH-SPEC.
- **AIS**, automated weather, and other items remain per main PRD / TECH-SPEC.

---

## 9. At-Berth Executions (page behaviour)

| Area | Behaviour |
|------|-----------|
| **Purpose** | Operators see vessels that are **berthed** (same notion as the **Berthed** filter on “Incoming vessel & berthing plan”) and open the **operation** workspace. |
| **Data source** | The table and **Full details** use the **same queue** as Allocation: **`GET /allocation/overview`** (`queue`), **not** a separate at-berth-only list. Rows shown are those with an **operation** and **berthed** status (e.g. TB recorded, or operation status DOCKED / IN_PROGRESS / COMPLETED per the same rules as Allocation). |
| **Summary cards** | Two groups — **Loading** and **Unloading** — each with counts for **Pre-Checking**, **Operational**, **Post-Checking**. Phase is **derived from operation status** (e.g. IN_PROGRESS → Operational, COMPLETED → Post-Checking, else Pre-Checking). |
| **Tabs** | **All / Loading / Unloading** filter the table; summary always reflects all berthed rows. |
| **Table columns** | **Vessel**, **SI** (reference only), **Commodity** (separate from SI), **Purpose**, **Jetty**, **TA**, **TB**, **Phase**, **Status**. |
| **Expand row** | Same interaction pattern as **Incoming vessel & berthing plan**: expand column + row click toggles **Full details**. |
| **Full details (order)** | Vessel Name, Shipping Instruction, No PKK, Priority, Number of Palka, Purpose, Shipper, Agent, Surveyor, Jetty, ETA, TA, ETB, TB, Remark. (Shipping Table block, when present in data, remains on Allocation only where applicable.) |
| **Action** | **Open** → `/{loading|unloading}/:vesselId` (purpose-based hub entry; API-backed rows may use `op-<operationId>` vessel id form). |
| **Removed from page** | Intro line (“Live data from GET…”) and **Refresh** button; list still loads on visit. |
| **Layout** | Loading / Unloading summary groups use a **two-column** grid on wide screens so phase cards do not overlap. |

---

## 10. Date and time display (user-facing)

| Rule | Behaviour |
|------|-----------|
| **No “LT” suffix** | Display strings do **not** append the literal **“ LT”** (previously suggested “local time” but was ambiguous). API-built ETA/ETB display strings also omit **LT**. |
| **Common format** | Where the app uses the shared **`formatDateTimeDisplay`** helper, users see **`dd/mm HH:mm`** based on the **browser’s local timezone** for parsed instants. |
| **Legacy strings** | If old cached text still ends with **` LT`**, the helper **strips** that suffix when the value cannot be parsed as a date. |
| **Not yet global** | Some screens may still use other formatters (`toLocaleString`, etc.); standardisation is to prefer the shared helper for new work (see TECH-SPEC). |

---

## 11. Document history

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-03 | Initial: Gantt segments, end-date matrix, estimated completion in modals, `PUT /allocation/arrival`. |
| 1.1 | 2026-03-24 | At-Berth Executions alignment with Allocation queue, table/columns/details, summary layout, date/time presentation rules, scope note. |
| 1.2 | 2026-03-24 | Added **planned migration** for Pre-Checking persistence (hybrid model: generalized sub-process records + dedicated NOR details), rollout/test plan, and impact notes. |
| 1.3 | 2026-03-24 | Added Pre-Checking save-mode behavior: **Save Draft** (In Progress) and **Save** (Done). |
| 1.4 | 2026-03-24 | Pre-Checking UX updated to checklist-style interaction with step status chips and **Save & Next** path. |
| 1.5 | 2026-03-25 | NOR Accepted: merged NOR documents from Allocation + tab; **Last Updated Via**; Initial Sounding / Initial Draft Survey **Remark** field; Activity Log expectations; app shell (logout placement); fresh DB / Docker reset explanation; cross-ref to dev seed migrations and RBAC bootstrap. |

---

## 12. Pre-Checking persistence migration (in rollout)

This section describes the agreed migration direction. It is a plan for upcoming implementation and QA.

### 12.1 Functional objective

- Keep current user journey in Loading/Unloading (same Pre-Checking sub-tabs and Save actions).
- Make Save actions durable in backend storage (no longer in-memory only).
- Keep NOR milestone timestamps available for operational views that depend on operation-level fields.
- Use a hybrid persistence model:
  - Generalized sub-process records for most Pre-Checking tabs.
  - Dedicated NOR detail storage for NOR-specific note/metadata.
  - Core NOR timestamps remain on operation.

### 12.2 Tab-level functional mapping (target)

| Pre-Checking tab | Functional persistence target |
|---|---|
| Key Meeting | Generalized sub-process record (`sub_process_key = key_meeting`) with own remark and documents. |
| NOR Accepted | NOR Tendered/Accepted timestamps remain operation-level; NOR-specific remark/details stored in dedicated NOR detail entity; NOR files from **Allocation (Log arrival update)** and from this tab are **shown together** in the NOR Accepted documents list (no separate “source” labels in the list). **Last Updated Via** reflects metadata when present (e.g. Allocation & Berthing vs NOR Accepted tab). |
| Tank Inspection | Generalized sub-process record (`tank_inspection`) with own remark/documents/status. |
| Hold Inspection | Generalized sub-process record (`hold_inspection`) with own remark/documents/status. |
| Sampling | Generalized sub-process record (`sampling`) with structured sampling values (per-palka FFA/Moisture in `payload_json.records`); UI may show **summary** indicators (e.g. counts/averages) and formatted numbers in the records table. |
| Initial Sounding | Generalized sub-process record (`initial_sounding`) with **Remark**, date/time, and documents (free text persisted as sub-process **remark**; legacy data may still show values previously stored only in payload). |
| Initial Draft Survey | Generalized sub-process record (`initial_draft_survey`) with **Remark**, date/time, and documents (same remark convention as Initial Sounding). |

### 12.3 User-visible behavior (target)

- Save in each Pre-Checking tab persists data to backend.
- Data remains available after refresh, logout/login, and cross-device access.
- Each tab has its own remark (no global shared remark for all tabs).
- Existing page structure remains stable (no major UI redesign required for phase 1).
- Editing actions support two save modes:
  - **Save Draft** persists partial values and keeps step state as **In Progress**.
  - **Save** persists values as completed step data (**Done** status where applicable).
- Pre-Checking interaction uses a checklist-style navigator:
  - each step shows current state (`Not Started` / `In Progress` / `Done`),
  - users open any step directly,
  - **Save & Next** is available to support linear workflow when desired.

### 12.4 Rollout phases (functional)

1. **Phase A - Backend readiness**
   - Add new persistence entities and APIs.
   - Keep existing user flow unchanged.
2. **Phase B - Write path**
   - Pre-Checking Save writes to backend for all target tabs.
3. **Phase C - Read path**
   - Pre-Checking loads from backend as source of truth.
4. **Phase D - Validation and hardening**
   - Full regression for Allocation, At-Berth, Loading/Unloading, Clearance gating, and reports.

### 12.5 Functional impact/risk areas to regression-test

- Allocation and At-Berth should still open correct operation/vessel workspace.
- NOR timestamps from allocation flow and Pre-Checking flow should not conflict.
- Clearance gating rules should remain consistent after persistence source changes.
- Existing reports or summary counts should remain accurate when new records are introduced.

---

## 13. Activity Log (page-scoped panel)

| Rule | Behaviour |
|------|-----------|
| **Scope** | Entries are associated with a **page key** (e.g. allocation, loading) so the slide-out panel shows relevant history for the screen the user is on. |
| **Detail** | When the backend supplies a **`changes`** array (`field`, `from`, `to`), the user can expand an entry to see a **before → after** list (aligned with Shipping Instruction style). |
| **Quality** | Updates should show real prior values when they existed, not only “empty → new value”, for fields such as remarks and status. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §3.8A**.

---

## 14. Application shell (sidebar & top bar)

| Element | Behaviour |
|---------|-----------|
| **Sidebar** | Primary navigation uses an updated layout (card-style on desktop, collapsible). |
| **Logout** | **Logout** sits in the **top bar** next to the greeting (**Hi, &lt;user&gt;**), not in the sidebar footer. |

---

## 15. Fresh install vs “lost” data

| Situation | What users notice |
|-----------|-------------------|
| **New Docker volume / DB reset** | All **business** data (operations, SIs, uploads on old volume) is gone; **schema** returns after **`npm run migrate`** (or equivalent). |
| **Not a bug** | Migrations create **structure** and small **reference seeds**; optional **dev seed migrations** (`023`, `024`) add sample SIs/operations/pre-checking rows for local testing. |
| **Login / menu access** | A new DB has users from seed migration **002** but **no roles** until created; **page permissions** require **`user_roles`** + **`role_permissions`** — assign an admin role with full page access or the UI will look “locked”. |

---

*End of document.*
