# Functional specification — Jetty schedule Gantt & arrival updates

**Product:** Jetty Planning & Monitoring System (JPS)  
**Scope:** Features delivered for **Allocation → Jetty schedule**, **Log arrival update**, **Confirm Berthing**, **shifting out / re-dock** (priority / double-bank berth handover)**, **At-Berth Executions list**, and **user-visible date/time presentation** (Gantt bar logic, estimated completion, and related UI).  
**Audience:** Product, QA, and engineering (for regression and extension).  
**Version:** 1.14 (see document history at end).

---

## 1. Purpose

This document describes **behaviour that is implemented in code**, including:

- Jetty schedule **Gantt** rendering rules (planned vs actual, segment types, end dates).
- **Estimated completion** capture in UI and persistence via the allocation API.
- **Confirm Berthing** saving arrival-related fields (including estimated completion) to the backend.
- Related **cosmetic** behaviour on the Gantt (reset control, intro area, removal of a confusing planned segment).
- **At-Berth Executions** list: what the user sees, which data it reflects, columns, expandable details, and summary cards.
- **Date/time labels** shown in the UI (no misleading “LT” suffix; consistent formatting where the shared formatter is used).
- **Multi-port sign-in and shell:** dedicated **Choose port** page, session-stored active port, and header behaviour (**§14.1**).
- **Shifting out & re-dock:** temporarily treating a **berthed** operation as **not occupying** the jetty (for double-bank / priority preemption) while **preserving** operation history and TB/TA; coordinated **remark** capture, success messaging, and activity log (**§2.5**).

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
| **Double bank — schedule lanes (01 / 02)** | **Bank lane** is assigned per **vessel** on a jetty (not separately for planned vs actual). **Planned** and **Actual** bars for the **same** vessel share the **same** lane (e.g. **1A-01**) as two sub-rows. A **second** vessel on that jetty uses the next lane (**1A-02**) when capacity allows. Lane order: earliest **TB** first, then **operation id**, then **vessel id** (see TECH-SPEC §0.6). |

### 2.2 Log arrival update (modal)

- Includes **Estimated completion** as a **`datetime-local`** input, consistent with other date/time fields on the form.
- Saving uses the allocation **arrival** API (see §6); value is stored on the operation record.

### 2.3 Confirm Berthing (modal)

- Includes **Estimated completion** (`datetime-local`), aligned with Log arrival update.
- **Confirm Berthing** persists data via the same **arrival** API **before** applying local UI state; the button shows a **saving** state while the request runs.

### 2.4 Active Vessel Detail (modal) — times & last updated

| Area | Behaviour |
|------|-----------|
| **Where** | Opens from **Jetty Schematic** or **Jetty schedule (Gantt)** when the user selects an occupied / planned vessel (same modal as today for vessel summary). |
| **Last updated** | Between **Current Phase** and **Times & status**, the user sees a single secondary line: **Last updated on** the operation’s or SI’s last change **date/time**, and when known **by** the **user display name**. For rows backed by an **operation**, the timestamp reflects **`operations.updated_at`** (any change to that operation from any module). For **incoming** queue rows that are **shipping instruction only** (no operation yet), the timestamp reflects **`shipping_instructions.updated_at`**; no “by” name is shown for those rows in this release. |
| **Edit (Times & status)** | Users whose role grants **Allocation & Berthing → Edit** see an **Edit** control (icon with tooltip **Edit**) on the **Times & status** card header. **View-only** users do not see Edit. Editing is available only when the row has an **operation** (not for SI-only incoming rows in this release). |
| **Fields in edit mode** | **ETA, TA, ETB, TB, POB, SOB, Est. completion, Actual completion** use the same **`datetime-local`** styling as **Log arrival update** / **Confirm Berthing**. **Time Since Berthing** and **Est. Time Remaining** stay **read-only**; they **do not** live-update while the user types—they refresh from saved data **after a successful Save**. |
| **Helper copy** | While editing, a short note explains that **calculated fields apply after saving**. |
| **Actions** | **Cancel** discards draft changes. **Save changes** calls the same **arrival** API as other allocation saves, then refreshes the overview so the modal and lists show updated values. **Close** closes the modal (while editing, **Close** is available alongside Cancel/Save; users should use **Cancel** or **Save** to leave edit mode intentionally). |
| **Audit** | Successful saves are recorded in the **activity log** like other allocation arrival updates; edits from this modal may carry a distinct **meta** source for filtering (see TECH-SPEC). |

### 2.5 Shifting out and re-dock (priority / double-bank)

**Problem this solves:** Operations sometimes need to **free a berth** (e.g. second bank slot or priority vessel) **without** deleting the voyage or losing **TB / history**. The voyage should reappear in planning as **incoming / shifted** until the jetty is formally **re-docked**.

**Outcomes (acceptance):**

| # | Outcome |
|---|--------|
| 1 | From **At-Berth Executions**, a berthed operation with a jetty can be **shifted out** in one deliberate step. |
| 2 | **Shift-out** opens a **confirmation modal** with a **single required Remark** field, prefilled from the current operation remark so the user can **replace or extend** it in one place. |
| 3 | On confirm, the vessel **stops occupying** jetty **capacity** in schematic / occupancy views (same rules as TECH-SPEC: `shifting_out` excludes the row from berth slot counts). |
| 4 | The voyage is treated as **incoming** in **Incoming vessel & berthing plan** (Allocation list / filters), with a visible **Shifted** indicator so planners see it is not a greenfield arrival. |
| 5 | **TB / TA / operation status** are **not** wiped by shift-out; undo semantics remain **separate** from “delete operation”. |
| 6 | **Re-dock** is initiated from **Allocation** (incoming row with **Re-dock** action): **confirm modal** + **required remark** (same single-field pattern). On confirm, shift-out is cleared and normal **at-berth** workflows can resume. |
| 7 | **Undo shift-out** from At-Berth (without going through Allocation) remains a **quick clear** of the shift flag **without** forcing a new remark (optional path for corrections). |
| 8 | **Success feedback:** after shift-out, a **toast** directs the user to **Allocation & Berthing** to re-dock; after re-dock, a **toast** directs them to **At-Berth Executions** to resume activities. |
| 9 | **Audit:** shift-out and re-dock are written to the **activity log** with field-level changes (including **Remark** when it changes). |

**Copy (implemented):**

- Shift-out toast: *Shift out complete for &lt;Vessel Name&gt;. Please visit 'Allocation & Berthing' to re-dock.*
- Re-dock toast: *Redocking complete for &lt;Vessel Name&gt;. You may now resume activities via the 'At-Berth Executions'.*

**Dependencies:** Port-scoped API, authenticated user; operation must have **jetty** assigned; **SAILED** operations cannot shift out.

Technical contract (endpoints, columns, persistence order): **TECH-SPEC-Jetty-Planning-System.md §0.9**.

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

## 6. API & database (estimated completion, actual completion, last updated)

| Item | Detail |
|------|--------|
| **Endpoint** | `PUT /api/v1/allocation/arrival` (relative to API base; client wraps as `PUT /allocation/arrival`). |
| **Purpose** | Persist “Log arrival update” style fields on the linked **operation**, including estimated and actual completion. |
| **Authorisation** | Caller must have **page** permission **allocation** with **can_edit**; otherwise the API returns **403**. |
| **Request body (relevant)** | Includes `estimatedCompletionDateTime` and, when supplied, `actualCompletionDateTime` (ISO or empty string to clear, per client/backend parsing). |
| **Table** | `operations` |
| **Columns** | `estimated_completion_time`, `actual_completion_time` (`TIMESTAMPTZ`); `updated_at` set on each save; **`updated_by`** (FK to `users`) set to the saving user when present. |
| **Overview fields** | `GET /allocation/overview` queue rows include **`recordLastUpdatedAt`** and **`recordLastUpdatedByDisplayName`** (from operation + user join, or SI `updated_at` for incoming rows without an operation). |

Other arrival fields (ETA, TA, ETB, POB, TB, SOB, NOR times, remark, priority, jetty, `no_pkk`, etc.) remain as implemented in the same route.

### 6.1 Shifting out / re-dock (operations)

| Item | Detail |
|------|--------|
| **Endpoint** | `POST /api/v1/operations/:id/shifting-out` (client: `POST /operations/:id/shifting-out`). |
| **Purpose** | Set or clear **`shifting_out`** / **`shifting_out_at`**; when a **remark** is supplied per the rules in **§2.5**, replace **`operations.remark`**. |
| **Authorisation** | Authenticated user; operation must belong to the **selected port** (same pattern as other port-scoped operation routes). |
| **Full contract** | **TECH-SPEC-Jetty-Planning-System.md §0.9** and **§3.5.2**. |

---

## 7. Implementation references

| Area | Location |
|------|----------|
| Gantt UI & segment logic | `Frontend/src/components/JettyScheduleGantt.jsx` |
| Allocation page, modals, berthing confirm, **re-dock** modal | `Frontend/src/pages/Allocation.jsx` |
| At-Berth list, **shift-out** modal | `Frontend/src/pages/AtBerthExecutions.jsx` |
| Shift-out / re-dock API | `Frontend/src/api/operations.js` → `POST /operations/:id/shifting-out` |
| Allocation API client | `Frontend/src/api/allocation.js` |
| Arrival route | `Backend/src/routes/allocation.js` |
| Shift-out route | `Backend/src/routes/operations.js` |
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
| **Data source** | The table and **Full details** use the **same queue** as Allocation: **`GET /allocation/overview`** (`queue`), **not** a separate at-berth-only list. Rows shown are those with an **operation** and **berthed** status (e.g. TB recorded, or operation status DOCKED / IN_PROGRESS / COMPLETED per the same rules as Allocation). Rows with **shift-out** active are **excluded** from this list (they behave as **incoming** in Allocation until re-dock). |
| **Summary cards** | Two groups — **Loading** and **Unloading** — each with counts for **Pre-Checking**, **Operational**, **Post-Checking**. Phase is **derived from operation status** (e.g. IN_PROGRESS → Operational, COMPLETED → Post-Checking, else Pre-Checking). |
| **Tabs** | **All / Loading / Unloading** filter the table; summary always reflects all berthed rows. |
| **Table columns** | **Vessel**, **SI** (reference only), **Commodity** (separate from SI), **Purpose**, **Jetty**, **TA**, **TB**, **Phase**, **Status**. |
| **Expand row** | Same interaction pattern as **Incoming vessel & berthing plan**: expand column + row click toggles **Full details**. |
| **Full details (order)** | Vessel Name, Shipping Instruction, No PKK, Priority, Number of Palka, Purpose, Shipper, Agent, Surveyor, Jetty, ETA, TA, ETB, TB, Remark. (Shipping Table block, when present in data, remains on Allocation only where applicable.) |
| **Action** | **Open** → `/{loading|unloading}/:vesselId` (purpose-based hub entry; API-backed rows may use `op-<operationId>` vessel id form). **Shifting Out** / **Undo Shift Out** → see **§2.5** (modal + required remark for shift-out; **Undo** clears shift-out without modal). |
| **Removed from page** | Intro line (“Live data from GET…”) and **Refresh** button; list still loads on visit. |
| **Layout** | Loading / Unloading summary groups use a **two-column** grid on wide screens so phase cards do not overlap. |

**Allocation — incoming & re-dock:** When an operation is shifted out, it appears under the **Incoming** plan status with a **Shifted** badge; **Re-dock** opens the same confirmation + remark pattern as shift-out. After re-dock, the voyage can appear again under **Berthed** when the existing rules say it is berthed.

---

## 9.1 At-berth operation workspace (Pre-Checking) — navigation + workspace width

This section documents UI behaviour implemented in `Frontend/src/pages/Loading.jsx` for the at-berth operation workspace (Loading/Unloading).

### 9.1.1 Goal

- Maintain the multi-layer navigation (Stages → Sections) so users always know where they are.
- Provide a **collapse/expand** experience that increases the main working area (detail/form panel).

### 9.1.2 Stage rail (green)

- Stages are shown as a left rail with icons:
  - 📋 Pre-Checking
  - ⚙️ Operational
  - ✅ Post-Checking
- **Collapsed** stage rail shows short labels:
  - 📋 Pre
  - ⚙️ Ops
  - ✅ Post
- Collapsed state is persisted per user in `localStorage`.

### 9.1.3 Pre-Checking sections rail (blue)

- Pre-Checking sections are shown in a master-detail layout:
  - Left list = sections
  - Right panel = the active section detail (read-only or edit mode)
- **Collapsed** section rail becomes narrow and shows:
  - **Status dot** (Done / In Progress / Not Started)
  - **Short code** (KM / NOR / TANK / HOLD / SAMP / SOUND / DRAFT)
- When the stage rail is collapsed, expanding the section list to choose a section will **auto-collapse** again after selection (focus/workspace-first behaviour).

### 9.1.4 Collapse controls

- Collapse controls are rendered consistently in the rail headers and use non-SVG chevrons to avoid platform-specific SVG rendering quirks.

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
| 1.6 | 2026-03-25 | At-berth operation workspace: **collapsible navigation rails** for stages + Pre-Checking sections (localStorage persistence, narrow collapsed states, auto-close behaviour for section picker in compact navigation mode). |
| 1.7 | 2026-03-31 | Added one-command **transactional reset + fresh demo seeding** script reference for local testing across operational pages. |
| 1.8 | 2026-04-02 | **§17 Master Jetty Layout → Jetty Schematic:** persisted layout consumption, placeholder when unconfigured, loading/error/port states; cross-ref to TECH-SPEC §0.5 for Dashboard embed notes. |
| 1.9 | 2026-04-02 | Gantt **§2.1** double-bank bank lanes: per-vessel lane assignment so planned+actual do not both consume lane 01; second vessel uses 02. TECH-SPEC **§0.6**. |
| 1.10 | 2026-04-02 | **§17.6** Jetty Schematic: per-lane boxes (1A-01 / 1A-02), one vessel per box, same sort as Gantt; overflow "+N more"; incoming hint on first vacant. |
| 1.11 | 2026-04-02 | **§17.7** Schematic UX: fixed column bands for pipeline alignment; lane height divisor **max(capacity, 2)**; compact type / scroll fallback. |
| 1.12 | 2026-04-02 | **§2.4** Active Vessel Detail: **Times & status** edit (RBAC), **Last updated** line, calculated fields after save; **§6** actual completion, `updated_by`, overview **recordLastUpdated*** fields, **allocation edit** on `PUT /allocation/arrival`. |
| 1.13 | 2026-04-02 | **§14.1** Multi-port **Choose port** landing (`/select-port`), session-stored active port, post-login routing, header **Change port** → landing with **`returnTo`**; **§17.4** port-not-selected behaviour aligned with redirect. |
| 1.14 | 2026-04-02 | **§2.5** **Shifting out & re-dock:** modals, single **Remark** field, toasts, Allocation **Shifted** / **Re-dock**; **§9** At-Berth actions & exclusion when shifted; **§17.5** occupancy note; **§7** implementation map; TECH-SPEC **§0.9**. |

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

### 14.1 Multi-port selection (operational scope)

Users assigned to **more than one** port must **choose an active port** before using operational areas (Dashboard, Allocation, At-Berth, Loading, etc.). Admin (**`/admin`**) and Master (**`/master`**) paths **do not** require an operational port first (port scope bypass).

| Rule | Behaviour |
|------|-----------|
| **Dedicated landing** | After sign-in (or when the app detects no valid port for a multi-port user), the user is taken to a **full-page “Choose port”** experience at **`/select-port`**. It is **not** embedded inside the main shell: **no sidebar**, **no primary app chrome**—same “single-task page” pattern as **Sign in** (`/login`). |
| **Session persistence** | The chosen port id is stored for the browser tab **session** (`sessionStorage`, key `jps_selected_port_id`). All API calls to **port-scoped** modules automatically send **`X-Selected-Port-Id`** so the backend resolves the same active port (see TECH-SPEC, `requirePortScope`). |
| **After login** | If the user has **multiple** assigned ports and **no** stored port, or a stored port that is **no longer** in their assignment list, they are sent to **`/select-port`**. If they have **exactly one** port, that port is applied automatically (no landing). If they have **zero** ports, they see the existing **“Access not configured”** message (not the choose-port page). |
| **Returning from landing** | On **Continue**, the selection is saved to session and the user is navigated to the **dashboard** (`/`) or to a **`returnTo`** path when they opened port selection from **Change port** (see below). |
| **Header when a port is active** | For multi-port users, the top bar shows the **current port name** as a **single control** (not a second dropdown on the same screen as the landing page). |
| **Changing port** | The user clicks that control (**e.g. “Port: &lt;name&gt; Change…”**) and is navigated to **`/select-port?returnTo=…`** (current path encoded) so they **explicitly** pick again before returning to the app. |
| **Single port** | Users with one assigned port see **Port: &lt;name&gt;** as read-only text in the header (no change URL needed unless assignments change). |

**Product intent:** force a deliberate port choice up front; avoid duplicate port pickers (embedded card + header) and avoid using the app in an ambiguous port context.

Technical references: **TECH-SPEC-Jetty-Planning-System.md** (port scope, `SelectPort.jsx`, `Layout` redirect, `PortScopeContext`).

---

## 15. Fresh install vs “lost” data

| Situation | What users notice |
|-----------|-------------------|
| **New Docker volume / DB reset** | All **business** data (operations, SIs, uploads on old volume) is gone; **schema** returns after **`npm run migrate`** (or equivalent). |
| **Not a bug** | Migrations create **structure** and small **reference seeds**; optional **dev seed migrations** (`023`, `024`) add sample SIs/operations/pre-checking rows for local testing. |
| **Login / menu access** | A new DB has users from seed migration **002** but **no roles** until created; **page permissions** require **`user_roles`** + **`role_permissions`** — assign an admin role with full page access or the UI will look “locked”. |

### 15.1 One-command reset + fresh demo seeding (local dev)

For “start fresh” testing across pages (Allocation, At-Berth, Loading/Unloading, Verification), use the transactional reset+seed script:

- **Script**: `Backend/scripts/reset-and-seed-dev.sql`
- **Run (PowerShell, from `Backend/`)**:
  - `Get-Content -Raw .\scripts\reset-and-seed-dev.sql | docker compose exec -T jps-db psql -U jps_user -d jps_db`

This script truncates **transactional tables only** (operations/SI/workflow data) and re-seeds demo rows with **fresh dates** (relative to `NOW()`), without wiping master data (ports/jetties/metrics/SLA/rates/SI lookup masters) or RBAC (users/roles/permissions).

---

## 16. Shipping Instructions — Loading document & approval (internal SI)

**Scope:** Behaviour for **Loading** shipping instructions: create/edit form fields, document view, submit for approval, and **RBAC-gated** sign-off.

| Area | Behaviour |
|------|-----------|
| **Extra draft fields** | Optional: **voyage no.**, **document date**, **destination**, **freight terms** (PREPAID / COLLECT / AS PER CHARTER PARTY / OTHER), **B/L clause**, **consignee**, **notify party**, **BL indicated**. |
| **B/L split preview** | Read-only **preview** on the create/edit modal derived from breakdown lines (e.g. `1 × 4,000 MT`). |
| **Submit for approval** | **Request approval** calls the API to set status **Submitted** (not only local UI state). |
| **Approve SI** | List action opens the approval page only if the user has **Approve SI** on the **Shipping Instruction** page (see Admin → Roles). |
| **Approval API** | Transition **Draft → Approved** requires prior **Submitted**; **PUT** with `status: Approved` checks **`can_approve`** for page `shipping-instruction`. **403** if missing. |
| **Approver on document** | On approval, the system stores **approver name/title snapshots** (from `users.display_name` / `users.job_title`, default title **OPERATION HEAD** if job title empty). The **SI document view** shows these instead of a fixed name. |
| **Printed SI number** | Document **No.** prefers stored **`reference_number`** when set; otherwise legacy synthetic numbering. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md** (§2.2.1, §4 `shipping_instructions`, §6 RBAC, migration **`025_si_loading_document_and_approve_rbac.sql`**).

---

## 17. Master Jetty Layout and Jetty Schematic (Allocation)

**Purpose:** Users arrange which **master jetty** appears in which **column** and **row** (top / pipeline / bottom) for a **schematic** view. This is **separate** from double-bank capacity and schedule lanes, but the same **short jetty id** (e.g. `1A`) is used to match occupancy from **Allocation overview**.

### 17.1 Where it is configured

- **Master – Jetty Layout:** Users edit columns and assign **top** and **bottom** cells to master jetties (or leave unused). Saving persists server-side for the **active port**.

### 17.2 Where it is consumed

- **Allocation → Jetty Schematic** tab: The schematic reflects the **saved layout** for the current port after load.
- **Dashboard:** Not required in this release; when added, the same **`JettySchematic`** component and behaviour apply so there is a single implementation (see **TECH-SPEC-Jetty-Planning-System.md §0.5**).

### 17.3 When no layout exists

If the backend returns **no columns** (no configuration saved for that port):

- The schematic area shows an **admin-facing instruction** (exact copy in product):

  > Jetty layout is not configured. Please ask your admin to set it up in the master menu

- There is **no** implicit default grid; operators must complete Master – Jetty Layout first.

### 17.4 Other states (user-visible)

| State | Behaviour |
|--------|-----------|
| **Port not selected** | Multi-port users are **redirected** to **`/select-port`** (dedicated page); in-app copy may still refer to selecting an operational port if they land on a port-scoped surface before redirect completes. |
| **Loading** | Short “Loading jetty layout…” message. |
| **Load error** | Distinct message to retry/refresh (not the “ask admin” placeholder). |

### 17.5 Relationship to double bank (forward reference)

Double-banking (multiple vessels per jetty, schedule `01`/`02` lanes, one-vessel-per-box schematic) is documented and implemented separately. Jetty **layout** only controls **which jetty** sits in which **schematic cell**; **capacity** and **occupancy** still come from overview **`berths`**. **Shifted-out** operations are **not** counted as occupying a berth slot (see **§2.5**, TECH-SPEC **§0.9** / **`berths`** derivation).

### 17.6 Schematic bank lanes (1A-01, 1A-02)

On **Allocation → Jetty Schematic**, each configured jetty cell is split into **`capacity`** lane boxes labelled **`{berthId}-01`**, **`{berthId}-02`**, … (e.g. **1A-01**, **1A-02**). Each box holds **at most one** displayed vessel (vacant otherwise). Occupants are ordered like the Jetty schedule Gantt: **TB** ascending, then **operation id**, then **vessel id** (see TECH-SPEC **§0.6**). If more occupied vessels than **capacity**, the last lane shows **+N more** after the representative vessel for that lane. **Incoming** names (queue) are hinted on the **first vacant** lane only to avoid clutter.

### 17.7 Schematic layout & lane sizing (UX)

- **Pipeline alignment:** Each schematic **column** uses a **fixed-height** top band, **fixed** middle (pipeline) band, and **fixed-height** bottom band so the black **pipeline** segment stays **level across columns**, including columns whose top or bottom cell is a non-dockable placeholder (`—`).
- **Consistent lane box height:** Each lane’s height is derived from the band height divided by **max(jetty `capacity`, 2)**. A jetty with **capacity 1** therefore uses the **same lane band height** as a single lane on a double-bank jetty (the vessel card does not stretch to the full top/bottom band).
- **Readability:** Lane copy (vessel name, SI, purpose, material) uses **compact** typography and padding; lanes may **scroll vertically** if content exceeds the band (edge case).

---

*End of document.*
