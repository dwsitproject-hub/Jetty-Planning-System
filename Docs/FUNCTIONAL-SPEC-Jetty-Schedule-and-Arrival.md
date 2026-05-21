# Functional specification — Jetty schedule Gantt & arrival updates

**Product:** Jetty Planning & Monitoring System (JPS)  
**Scope:** Features delivered for **Allocation → Jetty schedule**, **Log arrival update**, **Confirm Berthing**, **shifting out / re-dock** (priority / double-bank berth handover)**, **At-Berth Executions list**, **operation sign-off → Clearance (Ready to Sail)**, **Jetty Live CCTV** (per-jetty RTSP links, schematic camera control, browser stream page), **self-service change password** (header user menu), and **user-visible date/time presentation** (Gantt bar logic, estimated completion, and related UI).  
**Audience:** Product, QA, and engineering (for regression and extension).  
**Version:** 1.45 (see document history at end).

---

## 1. Purpose

This document describes **behaviour that is implemented in code**, including:

- Jetty schedule **Gantt** rendering rules (planned vs actual, segment types, end dates).
- **Estimated completion** capture in UI and persistence via the allocation API.
- **Confirm Berthing** saving arrival-related fields (including estimated completion) to the backend.
- Related **cosmetic** behaviour on the Gantt (reset control, intro area, removal of a confusing planned segment).
- **At-Berth Executions** list: what the user sees, which data it reflects, columns, expandable details, and summary cards.
- **Operation sign-off** after at-berth work: request vs approve (RBAC), and **Clearance** queue (**§9.2**).
- **Date/time labels** shown in the UI (no misleading “LT” suffix; consistent formatting where the shared formatter is used).
- **Multi-port sign-in and shell:** dedicated **Choose port** page, session-stored active port, and header behaviour (**§14.1**).
- **Shifting out & re-dock:** temporarily treating a **berthed** operation as **not occupying** the jetty (for double-bank / priority preemption) while **preserving** operation history and TB/TA; coordinated **remark** capture, success messaging, and activity log (**§2.5**).
- **Demurrage Risk Calculator:** port-scoped candidate list (**Incoming** / **Berthed** aligned with Allocation), read-only **voyage context**, **throughput buffer** (and optional **Advanced** rate override), **Estimate** and **Save as estimation of completion** on an operation (**§2.6**).
- **Shipment Plan (multi-SI vessel call):** one **Shipment Plan** groups multiple **Shipping Instructions** on the same physical call; Allocation/berthing and vessel-level clearance timestamps are anchored on the plan while at-berth execution, QC, and quantities stay **per SI / per operation** (**§2.13**). A second **plan-centric** Allocation surface groups the same queue by plan in the UI (**§2.14**).
- **Full details timing fields:** standard detail-block order in operational modules (**§2.8**, **§9**, **§16**).
- **SI hyperlink detail modal:** clicking SI number in table rows opens a shared **SI Detail** modal across Shipping Instructions, Allocation & Berthing, and At-Berth Executions (**§2.9**, **§7**).
- **Jetty Operation ID:** external formatted id for each operation (**§2.10**); shown in Allocation, At-Berth, and Clearance main tables **before** SI.
- **Input maximum lengths (UI):** free-text fields use HTML **`maxLength`** caps for consistent UX and safer payloads (**§2.11**).
- **Jetty Live CCTV:** optional **RTSP link** per master jetty; **Allocation → Jetty Schematic** camera control opens **`/jetty-live`** in a new tab; shared stream service switches camera URL (**last opened wins**) (**§2.15**).
- **Self-service change password:** header **user menu** (name + initials avatar) with **Change Password** for **local** accounts and **Logout**; modal verifies current password before save (**§2.16**, **§14**).
- **Master Menu list tables:** client-side **column sort** and **per-column text filters** on Port, Jetty, SI lookup masters, and Freight Terms; SI lookup pages do **not** display **Sort order** (**§2.17**).

For API field names, database columns, and shared code modules, see **TECH-SPEC-Jetty-Planning-System.md** and **§6** below for arrival/estimated completion mapping. Jetty Live deployment: **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**.

---

## 2. User-facing features

### 2.1 Jetty schedule (Gantt)

| Feature | Description |
|--------|-------------|
| **Date range** | User selects **From** / **To** (inclusive start, end date handled as calendar range in the component). |
| **Reset** | Button label **Reset** — restores the default range (**today** → **today + 1 month**). |
| **Intro line** | The schedule keeps an intro `<p>` wrapper for layout; **long instructional copy was removed**. Only **validation errors** (invalid range, range too large) appear there. |
| **Compare plan vs actual** | On narrow viewports, a checkbox toggles dual **Planned** / **Actual** lanes; wide viewports show both by default. |
| **Legend** | Explains **Planned (known)** vs **Planned (open end)**, **Actual (known)** vs **Actual (open end)**, **Now**, and **Sailed off** status color. |
| **Vessel icon** | Bars use an **inline SVG** ship icon (avoids emoji rendering issues on Windows). |
| **Click vessel** | Where configured, clicking a bar selects the vessel for details. |
| **Sailed visibility scope** | **Jetty Schedule** is a time-series surface and can include **SAILED** operation rows (bounded history from backend) when they intersect the selected date window. **Jetty Schematic** remains a **live occupancy** surface and excludes SAILED by design. |
| **Removed segment** | The **planned “transit” sliver** from **ETA → planned ETB** was **removed** — it was visually confusing; the Gantt does not draw that segment anymore. |
| **Tooltip source context** | Hover tooltip shows source references for derived bars: **Planned refs** (`ETB`, `ETA`) and **Actual refs** (`TB`, `TA`). Start line indicates which source is used, e.g. **Start ... (from ETB/ETA/TB/TA)**. |
| **Status color source of truth** | Gantt bar status color treats a vessel as **Sailed off** when any of these are true: operation status is `SAILED`, `actualCompletionDateTime` is set, or `castOffDateTime` is set. |
| **Double bank — schedule lanes (01 / 02)** | **Bank lane** uses **`shipmentPlanId`** when present (one lane per **Shipment Plan** so sibling SIs on the same call do not occupy separate 01/02 slots); otherwise assignment is per **vessel** (`vesselId`). **Planned** and **Actual** bars for the **same** logical call share the **same** lane (e.g. **1A-01**) as two sub-rows. A **second** call on that jetty uses the next lane (**1A-02**) when capacity allows. Lane order: earliest **TB** first, then **operation id**, then **vessel id** (see TECH-SPEC §0.6). |
| **Out-of-service jetty (lane display)** | When master **`jetties.status`** is **Out of Service** for a jetty present in overview **`berths`**, the **left id column** shows an **OOS** treatment (striped/muted row) and status text explains the lane is for **schedule context only**; new allocations to that jetty are **blocked** (see **§2.7**). |

### 2.2 Log arrival update (modal)

- Includes **Estimated completion** as a **`datetime-local`** input, consistent with other date/time fields on the form.
- Saving uses the allocation **arrival** API (see §6); vessel-level schedule values (including estimated completion when in scope) are persisted on **`shipment_plans`** and mirrored on each sibling queue row for display.

### 2.3 Confirm Berthing (modal)

- Includes **Estimated completion** (`datetime-local`), aligned with Log arrival update.
- **Confirm Berthing** persists data via the same **arrival** API **before** applying local UI state (plan-backed vessel fields per §6); the button shows a **saving** state while the request runs.

### 2.4 Active Vessel Detail (modal) — times & last updated

| Area | Behaviour |
|------|-----------|
| **Where** | Opens from **Jetty Schematic** or **Jetty schedule (Gantt)** when the user selects an occupied / planned vessel (same modal as today for vessel summary). |
| **Last updated** | Between **Current Phase** and **Times & status**, the user sees a single secondary line: **Last updated on** the latest **date/time** across **`shipment_plans.updated_at`** and the linked **`operations.updated_at`** for that row’s vessel call, and when known **by** the **user display name** from whichever side changed most recently. For **incoming** queue rows that are **shipping instruction only** (no operation yet), the timestamp reflects **`shipping_instructions.updated_at`**; no “by” name is shown for those rows in this release. |
| **Edit (Times & status)** | Users whose role grants **Allocation & Berthing → Edit** see an **Edit** control (icon with tooltip **Edit**) on the **Times & status** card header. **View-only** users do not see Edit. Editing is available only when the row has an **operation** (not for SI-only incoming rows in this release). |
| **Fields in edit mode** | **ETA, TA, ETB, TB, POB, SOB, Est. completion, Actual completion** use the same **`datetime-local`** styling as **Log arrival update** / **Confirm Berthing**. **Time Since Berthing** and **Est. Time Remaining** stay **read-only**; they **do not** live-update while the user types—they refresh from saved data **after a successful Save**. |
| **Helper copy** | While editing, a short note explains that **calculated fields apply after saving**. |
| **Actions** | **Cancel** discards draft changes. **Save changes** calls the same **arrival** API as other allocation saves, then refreshes the overview so the modal and lists show updated values. **Close** closes the modal (while editing, **Close** is available alongside Cancel/Save; users should use **Cancel** or **Save** to leave edit mode intentionally). |
| **Audit** | Successful saves are recorded in the **activity log** like other allocation arrival updates; edits from this modal may carry a distinct **meta** source for filtering (see TECH-SPEC). |
| **Plan-centric (`/allocation-plans`, `plan-*` slot)** | An extra read-only **Time & status (shipment plan)** block leads the modal, fed by **`GET /api/v1/shipment-plans/:id`** (**§2.14**). The operation **Times & status** card is **hidden in read-only plan mode** and **shown when editing** so **Edit** / **Save** behaviour stays aligned with the rows above. |

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

### 2.6 Demurrage Risk Calculator

| Area | Behaviour |
|------|------------|
| **Where** | **Demurrage Risk Calculator** in the main nav (RBAC page key `demurrage-risk-calculator`). |
| **Choose voyage** | User filters by **date range** (ETA overlap) and checkboxes **Incoming** / **Berthed**, then **Apply**. These labels match **Allocation → Incoming vessel & berthing plan**: **Incoming** includes SIs with **no** active non-`SAILED` operation **or** an operation that is **not yet “berthed”** in that sense (e.g. `PENDING` / `ALLOCATED` without TB, **including operation with no jetty**); **Berthed** requires TB or status **DOCKED** / **IN_PROGRESS** / **POST_OPS** / **SIGNOFF_REQUESTED** / **SIGNOFF_APPROVED** (and not **shift-out**). |
| **List row** | **Vessel · SI reference · Incoming \| Berthed · [jetty name when set] · commodity** (jetty from allocated operation when present). |
| **Voyage context** | **Read-only** panel: **Purpose**, **commodity line(s)** and summed **volume (MT)** from all SI breakdown rows in MT, **start for calculation** with precedence **docking start → TB → ETB → SI ETA**, and **master rate(s)** from commodity master for loading/unloading. Link to **Shipping Instruction** for edits — users do **not** change commodity, volume, purpose, or operation timestamps on this page. |
| **Scenario** | User-adjustable fields for SLA terms: **Q1** (Quality & Quantity checking), **Q2** (Final Quality & Quantity checking), **C** (Clearance), each default **1 hour** and resettable. Also includes **Throughput buffer** (multiplier on rate) with **Reset to default** (from SLA config). If the user changes buffer or scenario terms after running **Estimate**, a reminder prompts **Estimate** again. **Advanced** (collapsed by default) exposes **Override rate** when master rate is missing or unsuitable (e.g. KLPH). |
| **Result** | **Estimate** shows SLA decomposition: **Transfer term** \(\sum(V/(Rate \times Buffer))\), **Base checks** \((Q1+Q2+C)\), **Material switch penalty** \(((n-1)\times S)\), total **Estimated SLA duration**, and **Estimated completion**. For multi-commodity SI, transfer uses all MT lines; when rates differ, each line is calculated with its own rate then summed. **Save as estimation of completion** persists **`shipment_plans.estimated_completion_time`** when the SI is on a shipment plan, otherwise **`operations.estimated_completion_time`**, when an **operation** exists and the user has **edit** permission on the calculator page; activity log uses page key **demurrage-risk-calculator**. **`GET /operations/:id`** merges plan-level timestamps into the JSON when **`shipmentPlanId`** is set so voyage context stays consistent with Allocation. |

**Related:** Detailed API and port/sailed rules: **TECH-SPEC §3.2.2**; UX notes: **Docs/Plan/DEMURRAGE-RISK-CALCULATOR-PLAN.md**.

### 2.7 Dashboard slot occupancy, jetty out of service, and allocation guardrails

| Area | Behaviour |
|------|------------|
| **Dashboard — slot occupancy** | The KPI labelled **Slot occupancy** shows **vessel positions in use / total positions** across jetties in the port: numerator **Σ min(occupiedCount, capacity)**, denominator **Σ capacity** for jetties whose master status is **not** **Out of Service**. (This replaces counting only “jetties with any occupant” vs “number of jetties”.) If data temporarily exceeds capacity, the bar may indicate **over capacity** visually. The card includes a shortcut link **View at‑berth →** to the At‑Berth Executions page. The caption includes a **Details** tooltip listing occupied slots as `<jetty>-<lane> — <vessel name>` (hover or keyboard focus). |
| **Dashboard — Port activity** | The **top row** (left of the KPI grid) shows a **Port activity** card with a toggle: **Operations** — grouped bars for **Loading** and **Unloading**, each with **Planned berthing** vs **Berthing** counts; percentages are **within that purpose** (planned vs berthing as shares of Loading-only or Unloading-only rows). Data is **allocation overview queue** for the selected port, aligned with pipeline **planned berthing** rules; **berthing** counts exclude rows in **shifting out**. **Shipping instructions** — three bars (**Approved**, **Submitted**, **Draft**) with counts and **percentage of all SIs** returned for the port. The chart shows a **Y-axis** of integer counts with **horizontal dashed grid** lines aligned to bar height. **Hover or keyboard focus** on a non-zero bar opens a **tooltip** (popover) with the count, labels, the same percentage rule as on the chart, and a **list of vessel names** in that segment (queue rows: vessel name, else vessel id, else em dash; SI mode: per instruction the same). Tooltips dismiss on leave, blur, scroll, or resize. Empty and loading states are explicit. |
| **Dashboard — weather** | The weather preview (mock data, “coming soon” overlay) appears at the **bottom** of the dashboard page, not in the top row. |
| **Dashboard — awaiting berth widget** | Removed. **Planned berthing** in the **Vessel pipeline** is the single indicator for “jetty assigned, not yet alongside” (see pipeline sublabel). |
| **Dashboard — jetty status** | The KPI grid includes a **Jetty status** card showing **Available** and **Out of Service** counts. Counts come from **`GET /jetties?port_id=…`**. Hover or keyboard focus on each status chip shows a tooltip listing the jetties in that bucket. |
| **Dashboard — SLA at risk** | The KPI **SLA at risk** shows a count of operations past estimated completion. Hover or keyboard focus on the KPI value shows a tooltip listing `Vessel Name, Jetty No, +Xh over ETC` for each risk item (same items as the “SLA & schedule risk” list). |
| **Dashboard — performance** | The Dashboard includes a **Performance** card (non‑SLA) with a toggle **24h / 7d** and three KPIs: **Waiting to berth** (median **TA→TB**, from allocation overview queue), **Turnaround** (median **TB→Cast‑off**, fallback **TB→Actual completion**; computed from operations so **sailed vessels are included**), and **On‑time berthing** (% where **TB ≤ planned ETB + 6h**, from allocation overview queue). Each KPI supports hover/keyboard tooltip drill‑down showing the worst/late cases in the selected window (vessel, jetty, duration). |
| **Master — Preferred Jetty** | Users set **Operational status** (**Available** / **Out of Service**) in the add/edit modal. Optional **RTSP link (CCTV)** (max **512** characters) is stored per jetty for Jetty Live; empty means no CCTV on that jetty (**§2.15**). **Out of Service** cannot be saved while a **blocking** operation still uses that jetty (**non-SAILED**, **`shifting_out` false**); the API returns **409** and the UI explains planners must **reassign or complete** on **Allocation & Berthing** first. New jetties default to **Available**; non-default status on create is applied via a follow-up status call. |
| **Allocation — copy & validation** | Short intro under **Incoming vessel & berthing plan** states that **out of service** jetties cannot receive new allocations. **Log arrival update**, **Confirm Berthing**, and **Active Vessel Detail** saves that assign a **resolved** jetty whose overview berth is **Out of Service** are **blocked client-side** with RBAC-aware wording (users **with** master-jetty view are pointed to **Master – Preferred Jetty**; others to **contact an admin**). Server **409** on `PUT /allocation/arrival` enforces the same. |
| **Allocation — queue table** | Includes **Jetty Operation ID** before **Shipping Instruction** when the row has an operation; see **§2.10**. Jetty column may show a small **OOS** badge when the row’s jetty maps to an out-of-service berth in overview (e.g. legacy assignment). |
| **Jetty schematic** | Stacks for **Out of Service** berths are **muted**, show an **OOS** badge, and tooltips state the jetty is **not available for new allocation**. |

### 2.8 Full details timing fields (Shipping Instruction, Allocation, At-Berth)

| Module | Behaviour |
|------|------------|
| **Shipping Instructions** | In row **Full details**, timing rows are shown as **ETA → TA → ETB → TB → Estimation of Completion**. Existing ETA range labels (**ETA From / ETA To**) remain available for form context, but detail block follows the unified timing set. |
| **Allocation & Berthing** | In row **Full details**, existing timing rows (**ETA, TA, ETB, TB**) are kept, and **Estimation of Completion** is added (no duplicate timing labels). |
| **At-Berth Executions** | In row **Full details**, timing rows are shown as **ETA → TA → ETB → TB → Estimation of Completion**. |
| **Missing values** | Any missing time value is rendered as **`—`**. |
| **Data source** | Values come from allocation/operation queue row fields (e.g., ETA/TA/ETB/TB/estimated completion) as already delivered by overview payloads. |

### 2.9 SI number hyperlink → shared SI detail modal

| Area | Behaviour |
|------|-----------|
| **Trigger** | In table rows only, the **SI number/value is rendered as hyperlink text** (not a button). |
| **Where** | Implemented on **Shipping Instructions**, **Allocation & Berthing**, and **At-Berth Executions** tables. |
| **Scope rule** | Click target is SI in the table only; expanded **Full details** SI labels are not converted to modal triggers in this release. |
| **Modal content** | Shared SI detail modal shows: SI No, Status, Source, Vessel, Purpose, Jetty, ETA From, ETA To, ETB, TB, ETC, Term, Voyage, Destination, Freight terms, Document date, B/L clause, B/L split, Consignee, Notify party, BL indicated, Shipper, Loading port, Surveyor, Agent, Note, Approver, Approval date, and Contract / PO breakdown. |
| **At-berth process (summary)** | When the SI is linked to an **operation** (`operationId` present), the modal includes an **At-berth process** table (Pre-Checking / Operational / Post-Checking) with progress and state, loaded from the same hub-stage rules as the Loading/Unloading workspace. |
| **Detailed executions log (nested)** | In that section, **View detailed executions log** opens a **second** modal on top with the **Detailed At-Berth Executions Log** (same table as the Loading/Unloading hub: `OperationActivityTimeline`, fed by `GET /operations/:id/activity-timeline`). Closing the inner modal (**Close**, overlay click, or **Escape**) returns the user to the **Operation Detail** modal without closing it; closing Operation Detail behaves as before. |
| **Fallbacks** | Missing values render as **`—`**. |
| **Close behavior** | Parent modal closes via **Close** action or overlay click. |
| **Localization** | Labels use Shipping Instruction translation keys (EN/ID) for consistent SI terminology. |

### 2.10 Jetty Operation ID (external operation reference)

| Area | Behaviour |
|------|------------|
| **What** | Each **operation** receives a stable **Jetty Operation ID** when the operation database row is **first created** (including creation from **Log arrival update** when an approved SI had no operation yet, and from **`POST /operations`** when used). |
| **Format** | **`LD`** or **`UN`** for Loading / Unloading, hyphen, two-digit **calendar year** and **month** (from **`operations.created_at`** in the configured site timezone), hyphen, then a **four-digit** running number within that month and type (example: `LD-26-04-0001`). |
| **Where shown** | Main data tables on **Allocation & Berthing**, **At-Berth Executions**, and **Clearance** include a **Jetty Operation ID** column **immediately before** **SI / Shipping Instruction**. **Incoming SI-only** rows (no operation yet) show **`—`** in that column. |
| **Hyperlink (where wired)** | Where **Jetty Operation ID** is rendered as a hyperlink (e.g. **Allocation**, **At-Berth Executions**, **Clearance** when the row has a **shipping instruction** id), it opens the same shared **Operation Detail** modal as the SI hyperlink (**§2.9**); the nested **Detailed At-Berth Executions Log** link applies whenever the loaded SI has an **operation**. |
| **Full details** | **Allocation** and **At-Berth** expanded **Full details** list **Jetty Operation ID** before **Shipping Instruction** / SI where the row is operation-backed. |
| **vs internal id** | Hub links, **`/operations/:id`…** routes, and uploads continue to use the **numeric internal** operation id. The Jetty Operation ID is **display and reporting** metadata (API JSON field **`jettyOperationCode`**). |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.17**.

### 2.11 Field input maximum lengths (UI)

The browser enforces these limits on the relevant controls (HTML **`maxLength`**). Canonical values are defined in **`Frontend/src/constants/inputLimits.js`** (see TECH-SPEC **§0.18**).

| Category | Max characters | Where (examples) |
|----------|----------------|------------------|
| **Remark / Remarks** (narrative) | **500** | Allocation (vessel detail, confirm berthing, re-dock, log arrival); Loading (sign-off request, Pre-Checking **Remark** on KEY MEETING / NOR / INSPECTION / SAMPLING / INITIAL CARGO CHECKING); At-Berth **shift-out** remark; Operational milestone **Remark**; Unloading milestone / palka **comment** fields. |
| **Post-Checking result** | **500** | Loading **Final Inspection Result**, **Final Cargo Checking Result** (and the same cap on the legacy **LoadingStepCard** quantity result field if used). |
| **Sampling (per palka)** | **20** each | Loading **No. Palka**, **(%), FFA**, **(%), Moisture**. |
| **Login** | **50** each | Username, Password on `/login`. |
| **Master Jetty / Master Port** | **100** | Jetty name, port name, and **Description** textareas on master modals. |
| **RTSP link (CCTV)** | **512** | Master – Preferred Jetty add/edit modal (**§2.15**). |
| **Admin Roles** | **50** / **100** | Role name; role description (optional). |
| **Operational milestone composer** | **100** / **500** | Sub-step title (optional); **Reason** when marking N/A. |
| **Shipping Instruction** | See TECH-SPEC **§0.18** table | Vessel / SI ref / voyage caps; destination; B/L block textareas; breakdown Contract / PO / **Remarks** column (50 each); SI **Note** (500); SI Approval **Approval comments** (500). |

**Note:** Table **filter** inputs (Allocation, At-Berth, SI list, **Master Menu** list tables, etc.) are not capped in this release. Backend validation of string lengths remains a recommended hardening step (TECH-SPEC **§0.18**).

### 2.12 OIDC SSO integration (strict mode) — user-visible behavior

This section documents implemented sign-in behavior for Downstream Hub OIDC integration and the local setup that proved stable during rollout.

| Area | Behaviour |
|------|-----------|
| **SSO entry point** | Login page provides **Sign in with SSO**. The action starts Hub OIDC via backend **`GET /auth/oidc/start`**. |
| **Top-window navigation** | SSO launch is forced to the top browsing context so embedded/iframe contexts do not trap redirects. |
| **Callback** | Hub redirects to **`/auth/oidc/callback`**. Backend validates token/JWKS and establishes app session cookies, then redirects to app public origin. |
| **Identity key** | Linked identity uses OIDC **`sub`** (stored as `users.oidc_sub`). App user id is not used as OIDC identity. |
| **Account collision rule** | If SSO email matches an existing **local** account that is not linked (`oidc_sub` empty), sign-in is blocked with “account not linked” behavior (intentional anti-takeover guard). |
| **Dual login intent** | A user can remain `auth_source='local'` and still use SSO when `oidc_sub` is linked on the same row. |
| **Local host policy (current known-good)** | Use **`127.0.0.1` consistently** for frontend (`:5173`), API (`:3000`), and OIDC callback. Mixing `localhost` with `127.0.0.1` may break session/cookie continuity and can trigger callback transport errors in some Windows + Docker setups. |
| **Direct login / SSO parity** | Once API base URL and callback host are aligned, direct username/password login and Hub SSO both resolve to the same authenticated shell behavior. |

### 2.13 Shipment Plan (multi-SI vessel call)

| Area | Behaviour |
|------|-----------|
| **Terminology** | **Shipment Plan** is the aggregate for one physical vessel call; **Shipping Instructions** are documents/execution scopes under that plan. |
| **Primary list UI** | The standalone **`/shipping-instruction`** list URL is **retired** (placeholder with links to **`/shipment-plans`**). Plan-backed SI creation and list management use **`/shipment-plans`** (and **`/shipment-plans/:id`**). Deep links **`/shipping-instruction/view/:id`** and **`/shipping-instruction/approval/:id`** remain; access is governed by **`shipment-plan`** page permissions (not the retired **`shipping-instruction`** catalog key). |
| **Allocation queue** | **`GET /allocation/overview`** remains a **flat `queue`**: every row is still one SI (plus operation when present). Rows on the same plan share **`shipmentPlanId`** and the **same** plan-level timestamps and jetty (denormalised in SQL for display). |
| **Full details (Allocation)** | When more than one SI exists on the plan, **Full details** lists **SIs on this shipment plan** (read-only reference lines). |
| **Jetty Schedule (Gantt)** | Double-bank **bank lane** groups by **`shipmentPlanId`** when set so the call does not appear as two competing vessels on 01/02 (**§2.1**). |
| **At-Berth** | Table remains **one row per operation (per SI)**; client sort **tie-breaks** by **`shipmentPlanId`** then **TB** so sibling rows sit together. |
| **Loading / Unloading hub** | When multiple operations share a plan, a compact **Shipping instruction** selector switches the route’s **`op-<id>`** segment only; hub chrome is unchanged. |
| **Clearance** | **Ready to Sail** and **Sailed** lists **collapse to one row per shipment plan** (SI column summarises multiple references). **Record depart** uses the **plan depart** API when **`shipmentPlanId`** is present; **CAST Off** must be on or after the **latest** timestamp across **all** sibling operations’ **Detailed At-Berth Executions Log** timelines. Document uploads still attach via a representative **operation id** (primary row). |
| **Dashboard — Port activity** | Operations-mode counts **deduplicate** queue rows by **`shipmentPlanId`** so a multi-SI call is not double-counted in **Planned berthing** / **Berthing** bars. **Performance** waiting / on-time metrics use the same dedupe rule for TA→TB and on-time berthing. |

### 2.14 Allocation & Berthing — plan-centric queue (second page)

| Area | Behaviour |
|------|------------|
| **Where** | Route **`/allocation-plans`** is the primary **Allocation & Berthing** surface. The legacy list URL **`/allocation`** is **retired** (placeholder linking to **`/allocation-plans`** and **`/shipment-plans`**). RBAC page key **`allocation-plan`** replaces the retired catalog key **`allocation`** (migration **068**). |
| **Data** | **`GET /allocation/plan-overview`** and **`GET /allocation/overview`** return the **same JSON shape** (`queue`, `scheduleQueue`, `berths`) and both require **`allocation-plan`** **view** after migration **068**. Each flat queue row includes **`planReference`** and **`planPurposeLabel`** when the shipment plan and purpose master rows are present. Incoming SI rows without an operation use **`source`** = **`incoming-si`**. |
| **Queue table** | The **Incoming** table is **grouped by `shipmentPlanId`**: one **summary** row per plan (reference links to **`/shipment-plans/:id`**, vessel name, purpose badge when available, jetty summary, berthed vs total line count), then **nested child rows** per SI/operation with the **same columns, filters, sort, expand row, and actions** as the legacy Allocation page. Rows with no plan id are listed in an **ungrouped** block after grouped plans (normally empty when all SIs are plan-backed). |
| **Actions on children** | **Log arrival update**, **Confirm Berthing**, **Re-dock**, berthing sequence controls, **Full details**, and SI / Jetty Operation ID links behave like the legacy page and target the **child** SI/operation only. |
| **Jetty schematic & Jetty schedule (Gantt) — data** | Both consume the **flat** **`queue`** / **`scheduleQueue`** from the same response so berth occupancy, sailed schedule rules, and tooltips match the legacy Allocation page. |
| **Jetty schematic / Gantt — merged plan selection** | Slots keyed **`plan-<shipmentPlanId>`** open the **Active vessel call** modal in **plan-first** mode: title links to **`/shipment-plans/:id`**; **Time & status (shipment plan)** is read-only and sourced from **`GET /api/v1/shipment-plans/:id`** (plan-level ISO timestamps); **derived** rows (**Time since berthing**, **Est. time remaining**) use the same display rules as the operation modal but **inputs are plan fields**. Short **source / derivation** text appears on **`<dt>` tooltips** only (not in the value column). A **Shipping instructions on this plan** table lists every child row from the current **`queue`** ∪ **`scheduleQueue`** (deduped). If the plan fetch fails, an inline error appears in the plan **Time & status** block; the SI table still renders from the overview. **Phase A:** **Current Phase**, **Edit** (including operation **Times & status**), **NOR**, and **berthing photos** remain tied to the **representative** operation resolved for that merged slot, with a short explanatory subtitle in the modal; the operation-level **Times & status** card is **hidden in read-only plan mode** to avoid duplicate/conflicting numbers and **shown again when editing** so saves stay operation-scoped. |
| **Retired `/allocation` URL** | Schematic / Gantt clicks that resolve to a **single** `op-*` / `si-*` id keep the existing **Active Vessel Detail** behaviour (**§2.4**); no plan-detail fetch. The bookmark **`/allocation`** itself no longer renders the legacy list. |
| **Saving arrival / berthing** | **`PUT /allocation/arrival`** requires **`allocation-plan`** **edit**; activity log **`page_key`** is **`allocation-plan`**. |
| **Re-dock (shift-out clear)** | **`POST /operations/:id/shifting-out`** accepts **`activityLogPage`** **`allocation-plan`** for audit consistency when used from this page. |

### 2.15 Jetty Live CCTV (per-jetty RTSP)

| Area | Behaviour |
|------|------------|
| **Master data** | **Master – Preferred Jetty** add/edit modal includes optional **RTSP link (CCTV)** (placeholder example: `rtsp://user:pass@host:554/Stream1`). Value is trimmed on save; empty clears the link. Max **512** characters in the UI. |
| **RBAC — schematic & viewer** | No dedicated sidebar item. Schematic **camera** buttons and the **`/jetty-live`** popup require **View Jetty Live stream** — an **`can_approve`** sub-flag on **At-Berth Executions** in Admin → Roles (same pattern as **Approve shipment plan**). Migration **078** retires standalone **`jetty-live`** page permission (**072**). Users without the flag do not see camera controls. |
| **RBAC — master** | Configuring RTSP links uses existing **Master – Preferred Jetty** permissions (`master-jetty` view/edit); no separate CCTV master page. |
| **Jetty Schematic** | Each configured jetty **name band** (short id, e.g. **1A**) shows a small **camera** control beside the label. **Enabled** when that jetty has a non-empty RTSP link in master data. **Disabled** with tooltip *There's no CCTV on this jetty* when the link is missing. **Enabled** click opens a **new browser tab** to **`/jetty-live?rtsp=<url>&label=<berthId>`** (`label` is the short berth id for the page title). |
| **Jetty Live page** | Route **`/jetty-live`**. On load, if **`rtsp`** query param is present and valid (`rtsp://…`), the UI calls the stream helper **`POST /api/reconnect`** with that URL (switches the shared FFmpeg source), then attaches **JSMpeg** to the WebSocket video feed. Optional **`label`** sets the page heading (e.g. *Jetty Live — 1A*). If the link has no **`rtsp`** param, the user sees guidance to configure master data or open from the schematic. |
| **Stream service** | Separate host process **`rtsp-stream-viewer`** (not inside API or frontend containers): FFmpeg pulls RTSP → MPEG1 over WebSocket. **One active RTSP source at a time** on a given instance; opening CCTV for another jetty **replaces** the URL (**last opened wins**). Health card shows status, last frame time, restart count, masked RTSP source; **Reconnect** repeats the current URL (or query URL when opened from schematic). |
| **Deployment** | On the **app server**, stream HTTP listens on **3081** (JPS UI uses **3080**); nginx proxies **`/jetty-live-stream/`** and **`/jetty-live-ws`** to the host process. The app server must reach the camera on **TCP 554** (ping alone is insufficient). See **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**. |

### 2.16 Self-service change password

| Area | Behaviour |
|------|------------|
| **Where** | **Top bar** — when signed in, the greeting + standalone **Logout** control is replaced by a **user menu** trigger: **display name** + circular **initials** avatar (derived from display name or username). |
| **Dropdown** | Clicking the trigger opens a panel below the trigger (right-aligned): **bold name**, **email** (when set), divider, then actions. |
| **Change Password** | Shown only for accounts with **`auth_source = 'local'`** (resolved via **`GET /users/me/sso-status`**). **Hidden** for **SSO-only** users (`auth_source = 'sso'`) — they manage credentials via their identity provider. |
| **Change Password modal** | **Current Password**, **New Password**, **Confirm Password** — each with label, placeholder, and **show/hide** (eye) toggle. **Cancel** closes without saving. **Save Password** submits when validation passes. |
| **Client validation** | All three fields required; new password **≥ 6** characters (same minimum as admin user create); confirm must match new; new must differ from current. Errors appear in the modal before submit. |
| **Server validation** | **`PUT /api/v1/users/me/password`** with **`current_password`** and **`new_password`**; wrong current password → **401**; SSO account → **403**; new same as current or &lt; 6 chars → **400**. |
| **Success** | On success, a short **success** message is shown in the modal, then the modal closes and fields are cleared. The user **remains signed in** (session cookies unchanged). |
| **Logout** | **Logout** in the dropdown (destructive/red styling) uses the same flow as before: clears session cookies, clears selected port in session storage, redirects to **`/login`**. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.27**, **§3.1**.

### 2.17 Master Menu — list tables (sort and filter)

| Area | Behaviour |
|------|------------|
| **Where** | **Master** hub (`/master`) links to list pages: **Port**, **Preferred Jetty**, **Term**, **Shipper**, **Loading Port**, **Surveyor**, **Agent**, **Commodity**, **Freight Terms** (read-only). **Jetty Layout** is unchanged (not a sortable data table). |
| **UX pattern** | Same as **Allocation → Shipment plans — incoming vessel & berthing queue**: clickable column headers toggle **ascending / descending** sort (⇅ / ↑ / ↓); a second header row provides **text filters** per column (case-insensitive substring match). Styling reuses **`allocation-table__sort`** / **`allocation-table__filter`** (see TECH-SPEC **§0.28**). |
| **Port** | Columns: **Port Name**, **Schedule TZ**, **Description** (filter matches **full** description even when the cell is truncated). Default sort: name A→Z. |
| **Preferred Jetty** | Columns: **Port**, **Order**, **Jetty name**, **Capacity**, **Status**, **Description** (full text for filter). Default sort: **Port** A→Z. Add/edit still includes **RTSP link** and operational status (**§2.15**). |
| **SI lookups** (Term, Shipper, Loading Port, Surveyor, Agent, Commodity) | Columns: primary **value** label for that page; **Commodity** also **Type** and optional **loading/unloading rate** columns when enabled. **Sort order is not shown** in the UI (no column, filter, or cell); backend **`sort_order`** still drives API list order and SI dropdown ordering. Default table sort: **value** A→Z. |
| **Freight Terms** | Read-only table: **Code**, **Label**; sort/filter on the four fixed enum rows. Default sort: code A→Z. |
| **Empty filters** | When rows exist but every row is excluded by filters, the page shows *No entries match the current filters.* |
| **Actions** | **Edit** / **Delete** (where RBAC allows) remain in the rightmost column; filter inputs do not intercept button clicks. |

---

## 3. Gantt data inputs (per queue row)

Segments are built from allocation overview **queue** rows. Relevant fields:

| Concept | Typical row fields (API/camelCase) |
|--------|-------------------------------------|
| Row identity (double-bank / Gantt lane) | When **`shipmentPlanId`** is set, segments use an internal **`bankLaneKey`** of `plan-<id>` so sibling SIs share one lane; otherwise the queue **`vesselId`** is used. |
| Planned alongside start | `COALESCE(plannedEtbDateTime, etbDateTime, etaDateTime)` |
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
| `estComp` set and **after** planned start | `estComp` | Known (solid) |
| Otherwise | planned start **+ 3 days** | Open end (gradient) |

Planned end **does not** depend on whether actual completion is filled; it reflects **plan** vs **planned-start + default** when estimate is missing or invalid.

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
| **Purpose** | Persist “Log arrival update” style **vessel-call** fields on **`shipment_plans`** (jetty, ETA/TA/ETB/NOR/POB/TB/SOB, estimated/actual completion, remark, priority, `no_pkk`, etc.), including estimated and actual completion when in scope. Child **`operations`** rows are updated where the backend still mirrors fields for legacy consumers. |
| **Authorisation** | Caller must have **page** permission **`allocation-plan`** with **can_edit**; otherwise the API returns **403**. |
| **Request body (relevant)** | Includes `estimatedCompletionDateTime` and, when supplied, `actualCompletionDateTime` (ISO or empty string to clear, per client/backend parsing). |
| **Table** | Primary write target: **`shipment_plans`**; **`operations`** may receive mirrored timestamps for the targeted operation / siblings per backend rules. |
| **Columns** | Plan: `estimated_completion_time`, `actual_completion_time`, and other vessel-level timestamps (`TIMESTAMPTZ`); `updated_at` / **`updated_by`** on the plan when present. |
| **Overview fields** | `GET /allocation/overview` queue rows include **`shipmentPlanId`**, **`recordLastUpdatedAt`** and **`recordLastUpdatedByDisplayName`** derived from **`GREATEST(shipment_plans.updated_at, operations.updated_at)`** (and SI `updated_at` for incoming rows without an operation). Operation-backed rows also include **`jettyOperationCode`** when migration **056** is applied (**§2.10**). |
| **Jetty assignment guard** | When the body resolves **`jetty`** to a `jetties` row with **`status = 'Out of Service'`**, the API responds **409** and does not apply the update — planners must choose another jetty or restore service in Master (see **§2.7**). |

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
| Jetty Operation Id (DB + assign helper) | `Backend/migrations/056_jetty_operation_code.sql`, `Backend/src/lib/jetty-operation-code.js`, `Backend/src/routes/operations.js` (`POST /operations`), `Backend/src/routes/allocation.js` (new operation on arrival) |
| Jetty blocking queries (master status / allocation guard) | `Backend/src/lib/jetty-blocking.js` |
| Client jetty OOS messages | `Frontend/src/utils/jettyAvailability.js` |
| Master jetty status UI | `Frontend/src/pages/MasterJetty.jsx`, `Frontend/src/api/jetties.js` → `PUT /jetties/:id/status` |
| Jetty Live CCTV (master RTSP, schematic camera, viewer) | `Backend/migrations/077_jetties_rtsp_link.sql`, `078_retire_jetty_live_page_permission.sql`, `Backend/src/routes/jetties.js`; `Frontend/src/pages/MasterJetty.jsx`, `Frontend/src/components/JettySchematic.jsx`, `Frontend/src/pages/JettyLive.jsx`, `Frontend/src/pages/AdminRoles.jsx`; `rtsp-stream-viewer/`; deploy **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md** |
| Master Menu list sort/filter | `Frontend/src/utils/sortableFilterableTable.js`, `Frontend/src/hooks/useSortableFilterableRows.js`, `Frontend/src/components/SortableFilterableTableHead.jsx`; `Frontend/src/pages/MasterPort.jsx`, `MasterJetty.jsx`, `MasterSiLookup.jsx`, `MasterFreightTerms.jsx`, hub `Frontend/src/pages/Master.jsx` |
| Self-service change password (header menu + modal) | `Backend/src/routes/users.js` — **`PUT /users/me/password`**; `Frontend/src/components/UserMenu.jsx`, `ChangePasswordModal.jsx`, `PasswordField.jsx`; `Frontend/src/api/usersApi.js` — **`changeMyPasswordApi`**; `Frontend/src/styles/user-menu.css`, `Frontend/src/styles/modal.css`; i18n **`common.json`** (`changePassword.*`); wired in **`Layout.jsx`** |
| Dashboard slot KPI, Port activity chart, weather footer | `Frontend/src/pages/Dashboard.jsx`, `Frontend/src/components/DashboardActivityChart.jsx`, `Frontend/src/utils/dashboardQueueClassification.js` |
| Shift-out route | `Backend/src/routes/operations.js` |
| Demurrage Risk Calculator UI | `Frontend/src/pages/DemurrageRiskCalculator.jsx`, `Frontend/src/styles/demurrage-risk-calculator.css` |
| Shipment plan depart API + shared transaction | `Backend/src/routes/shipment-plans.js`, `Backend/src/lib/shipment-plan-depart.js`; mount in `Backend/src/index.js` — **`POST /shipment-plans/:id/depart`** |
| Plan timeline merge on `GET /operations/:id` (and list joins) | `Backend/src/routes/operations.js` — **`loadOperationJoined`**, **`toOp`**, **`PLAN_TIMELINE_SELECT`** |
| Clearance plan depart + multi-timeline validation | `Frontend/src/pages/Verification.jsx`, `Frontend/src/api/shipmentPlans.js` |
| Dashboard queue dedupe by plan | `Frontend/src/pages/Dashboard.jsx`, `Frontend/src/utils/dashboardQueueClassification.js` — **`allocationQueueVesselCallKey`** |
| SI candidates + port/sailed rules | `Backend/src/routes/shipping-instructions.js` — `GET /shipping-instructions/candidates` |
| Shared SI detail modal (hyperlink trigger target) | `Frontend/src/components/SiDetailModal.jsx`, `Frontend/src/styles/si-detail-modal.css`; nested **Detailed At-Berth Executions Log** via `OperationActivityTimeline.jsx` |
| Save estimation of completion | `Frontend/src/api/operations.js` → `PUT /operations/:id/estimated-completion`; `Backend/src/routes/operations.js` |
| DB — operations estimated completion | Migrations defining `operations.estimated_completion_time` (e.g. `Backend/migrations/004_shipping_operations_tables.sql` and related) |
| Operation sign-off (request → approve) + Clearance pending queue | `Frontend/src/pages/Loading.jsx`, `Frontend/src/pages/Verification.jsx`, `Frontend/src/api/operations.js`; `Backend/src/routes/operations.js` (`POST .../signoff-request`, `POST .../signoff`, `GET .../pending-signoff-requests`); `Backend/migrations/049_operations_signoff_request.sql`; RBAC sub-row **Approve operation sign-off** — `Frontend/src/pages/AdminRoles.jsx`. Plan: **Docs/Plan/OPERATION-SIGNOFF-REQUEST-AND-APPROVAL-PLAN.md**. |
| Stage tabs: Pre/Post **`— / n`** until persisted load (Case A, Option A) | `Frontend/src/pages/Loading.jsx` (`StageTabs`, `preCheckPersistHydrated` / `postCheckPersistHydrated`, `onPersistedHydrationDone`). Plan: **Docs/Plan/AT-BERTH-TWO-LEVEL-PHASE-AND-WORKSPACE-STAGE-PLAN.md**. |

---

## 8. Out of scope / follow-ups

- **Business-day** or **working-hours** tails (current default is **calendar** +3 days).
- **Cast-off** in the **four-way matrix** for transit/TB-missing rows (matrix uses **actual completion field**; cast-off is used for alongside “both NULL” end).
- **Single global “org timezone” knob:** not implemented. Instead, **read-only** timestamps use **`formatDateTimeDisplay`** (browser local wall clock), and **editable schedule fields** use the **browser IANA zone** for naive `datetime-local` ↔ API conversion (see **§10.1**). **`ports.schedule_timezone`** remains **port site metadata** (Master – Port, header reference), not the zone used to interpret typed schedule times in the SPA.
- **AIS**, automated weather, and other items remain per main PRD / TECH-SPEC.

---

## 9. At-Berth Executions (page behaviour)

| Area | Behaviour |
|------|-----------|
| **Purpose** | Operators see vessels that are **berthed** (same notion as the **Berthed** filter on “Incoming vessel & berthing plan”) and open the **operation** workspace. |
| **Data source** | The table and **Full details** use the **same queue** as Allocation: **`GET /allocation/overview`** (`queue`), **not** a separate at-berth-only list. Rows shown are those with an **operation** and **berthed** status (e.g. TB recorded, or operation status DOCKED / IN_PROGRESS / POST_OPS / SIGNOFF_REQUESTED / SIGNOFF_APPROVED per the same rules as Allocation). Rows with **shift-out** active are **excluded** from this list (they behave as **incoming** in Allocation until re-dock). |
| **Summary cards** | Two groups — **Loading** and **Unloading** — each with counts for **Pre-Checking**, **Operational**, **Post-Checking**, **Ready to Sail**, **Signed off**. Phase is **derived from operation status** (e.g. IN_PROGRESS → Operational, POST_OPS → Post-Checking, SIGNOFF_REQUESTED → Ready to Sail, SIGNOFF_APPROVED → Signed off, else Pre-Checking). |
| **Tabs** | **All / Loading / Unloading** filter the table; summary always reflects all berthed rows. |
| **Table columns** | **Vessel**, **Jetty Operation ID**, **SI** (reference only), **Commodity** (separate from SI), **Purpose**, **Jetty**, **TA**, **TB**, **Phase**, **Status**. |
| **Multi-SI ordering** | Client sort **tie-break**: **`shipmentPlanId`** (numeric), then **TB**, so rows for the same vessel call appear consecutively without a new table layout. |
| **Expand row** | Same interaction pattern as **Incoming vessel & berthing plan**: expand column + row click toggles **Full details**. |
| **Full details (order)** | Vessel Name, **Jetty Operation ID**, Shipping Instruction, No PKK, Priority, Number of Palka, Purpose, Shipper, Agent, Surveyor, Jetty, ETA, TA, ETB, TB, **Estimation of Completion**, Remark. (Shipping Table block, when present in data, remains on Allocation only where applicable.) |
| **Action** | **Open** → `/{loading|unloading}/:vesselId` (purpose-based hub entry; API-backed rows may use `op-<operationId>` vessel id form). **Shifting Out** / **Undo Shift Out** → see **§2.5** (modal + required remark for shift-out; **Undo** clears shift-out without modal). |
| **Removed from page** | Intro line (“Live data from GET…”) and **Refresh** button; list still loads on visit. |
| **Layout** | Loading / Unloading summary groups use a **two-column** grid on wide screens so phase cards do not overlap. |
| **Detailed executions log** | In the Loading/Unloading operation workspace, the **Detailed At-Berth Executions Log** lists operational milestones, operational activities, and Pre-/Post-Checking sub-process rows. The table shows **Phase**, **Title**, **Status**, **Remark**, **Documents** (links for files attached to that sub-process step; operational rows show **—** when there are no attachments), **Start time**, **End time**, **Duration**, and **Actions**. **Status** is the sub-process status for Pre/Post rows; for **Operational** activity rows it is derived from timestamps (**Done** when an end time exists, **In Progress** when only a start exists). **Remark** holds free text (and sub-process **skip** reason on a second line when present). **Start time**, **End time**, and **Duration** use the same formatting rules for **operational activities** and **sub-process** rows when the backend supplies a closed interval (`start_at` / `end_at` on sub-processes, or activity start/end). If only a single instant is recorded (no end), **End** and **Duration** show **—**. Document links open in a **new browser tab**; PDFs and other non-image types follow the same pattern so users keep the log visible (the browser may show the PDF inline in the new tab). |

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

### 9.1.5 Stage tabs — progress counts (API-backed operations)

The horizontal **Pre-Checking / Operational / Post-Checking** stage tabs show **`done / total complete`** for each stage.

- **Pre-Checking** and **Post-Checking** persisted sub-process data is loaded when the user visits that stage (lazy load). Until that load has **finished** (success or error), the tab shows **`— / n complete`** instead of **`0 / n complete`**, so users are not misled into thinking no work has been recorded.
- **Operational** uses the operational-activities load path; it does not use this unknown state for the count line.
- **Mock / demo** vessel routes (not API-backed) do not show the unknown state.
- **Post-Checking merged sections (Loading):**
  - **Final Inspection** (merged from Final Tank Inspection + Final Hold Inspection). The UI shows **Inspection Type** auto-derived from SI commodity type (**Tank** for liquid, **Hold** for solid).
  - **Final Cargo Checking** (renamed from Final Sounding). The UI shows **Cargo Checking Type** auto-derived from SI commodity type (**Sounding** for liquid, **Draft Survey** for solid).
  - Legacy persisted keys remain readable for compatibility; activity log labels use the merged names.

Cross-ref: **TECH-SPEC §2.2.4**; plan **Docs/Plan/AT-BERTH-TWO-LEVEL-PHASE-AND-WORKSPACE-STAGE-PLAN.md** (Case A, Option A).

## 9.2 Operation sign-off → Clearance (Ready to Sail)

Completing **Pre-Checking**, **Operational**, and **Post-Checking** in the hub (stage tabs **7/7**, **4/4**, **2/2** when all sub-process / activity data is **Done** — with Pre/Post numeric counts only after each stage’s data has been loaded; see **§9.1.5**) advances **`operations.status`** via **auto-promotions** (e.g. operational work → **IN_PROGRESS**, Post-Checking completion → **POST_OPS**). A separate **operation sign-off** flow (similar in spirit to Shipping Instruction **submit → approve**) gates the move from **POST_OPS** to **Clearance**.

| Step | Who | What the user sees |
|------|-----|-------------------|
| **1. Request** | Users with **Edit** on **Loading / Unloading** | When all three stages are complete and the operation is **POST_OPS**, the **Operation sign-off** card offers **Request operation sign-off** (optional remark). The server accepts the request only if the same **eligibility rules** as final sign-off are met at that moment (e.g. **completion 100%**, QC / quantity gates — see **TECH-SPEC §3.3**). |
| **2. Pending** | Anyone with hub access | The card shows **Sign-off requested** (time, requester, remark) and directs users to **Open Clearance** for approval handling. Status is **SIGNOFF_REQUESTED**. |
| **3. Approve (sign off)** | Users with **Approve operation sign-off** on **Loading / Unloading** (configured in **Admin → Roles**, same pattern as **Approve internal SI**) | Approval is performed from **Clearance** (not from the Loading/Unloading hub). On approval, the operation becomes **SIGNOFF_APPROVED** and appears on **Clearance** under **Ready to Sail** (signed off, awaiting depart). |
| **4. Clearance** | Clearance users | **Clearance** (`/verification`) lists **Ready to Sail** (**SIGNOFF_APPROVED**) and **Sailed**. Rows that share a **`shipmentPlanId`** are **collapsed to one logical row** per plan for those two statuses (SI column lists multiple references when needed). A **Pending sign-off** filter still shows **one row per operation** awaiting step 3. Approvers can **Open operation** (deep link to the hub) or **Sign off** from the table. The main operations table includes **Jetty Operation ID** immediately **before** **SI** (**§2.10**). |
| **5. Depart** | Clearance users | **Record depart** after **every child operation on the plan** is **SIGNOFF_APPROVED** (server-enforced). **CAST Off** is required and must be **on or after** the **latest** timestamp across the **combined** **Detailed At-Berth Executions Log** timelines of **all** operations on that plan; earlier values are blocked with a validation error. When **`shipmentPlanId`** is present, the client calls **`POST /shipment-plans/:id/depart`**; otherwise **`POST /operations/:id/depart`**. |

**Product rules**

- **Request** and **approve** are separate permissions; operators can request without being able to approve.
- **Duplicate request** while one is already pending is blocked by the API.
- **Audit:** Activity log records request and sign-off (see **TECH-SPEC** for `pageKey` and fields).

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §3.3** (routes, RBAC, `operations.signoff_*` columns). Detailed UX wireframes: **Docs/Plan/OPERATION-SIGNOFF-REQUEST-AND-APPROVAL-PLAN.md** §10.

## 10. Date and time display (user-facing)

| Rule | Behaviour |
|------|-----------|
| **No “LT” suffix** | Display strings do **not** append the literal **“ LT”** (previously suggested “local time” but was ambiguous). API-built ETA/ETB display strings also omit **LT**. |
| **Common format** | Where the app uses the shared **`formatDateTimeDisplay`** helper, users see **`dd/mm HH:mm`** based on the **browser’s local timezone** for parsed instants. |
| **Legacy strings** | If old cached text still ends with **` LT`**, the helper **strips** that suffix when the value cannot be parsed as a date. |
| **Not yet global** | Some screens may still use other formatters (`toLocaleString`, etc.); standardisation is to prefer the shared helper for new work (see TECH-SPEC). |

### 10.1 Schedule entry: device browser timezone vs port metadata

| Rule | Behaviour |
|------|-----------|
| **`datetime-local` inputs** | Values are interpreted in the **user’s browser IANA timezone** (see app shell **💻** and `getScheduleEntryTimeZone()` in **`scheduleDateTime.js`**), **not** in the port’s stored **`schedule_timezone`** (**⚓**). |
| **API persistence** | The SPA sends **ISO 8601 instants** (typically UTC with **`Z`**) for schedule fields; the API stores **timestamptz** / UTC. |
| **Collaboration across zones** | Another user sees the **same instant** in **their** local time when viewing or editing. |
| **Port `schedule_timezone`** | Edited on **Master – Port** via a **searchable IANA list** with **UTC offset** in each option label; used as **site / reporting reference**, not for naive schedule encoding in the web client. |
| **Header** | **⚓** = port site timezone (tooltip). **💻** = device timezone used for **schedule entry** (tooltip). One short muted line clarifies that schedule forms follow the device clock. |

Cross-reference: **TECH-SPEC §0.20**, **`Backend/src/lib/schedule-instant.js`** (naive+port parsing retained only when the client omits zone information).

---

## 11. Document history

| Version | Date | Notes |
|---------|------|--------|
| 1.46 | 2026-05-22 | **§2.17 Master Menu list tables:** client-side column **sort** and **filter** (shared table head; same UX as plan-centric Allocation queue). **Sort order** column **removed** from SI lookup master UI (Term–Commodity); backend **`sort_order`** unchanged. **§2.11** filter note; **§7** map. TECH-SPEC **§0.28**. |
| 1.45 | 2026-05-19 | **§2.16 Self-service change password:** header **user menu** (name + initials), **Change Password** modal (current / new / confirm, show-hide toggles) for **`auth_source = local`** only; **`PUT /api/v1/users/me/password`**. **§14** shell updated (user menu replaces greeting + logout button). **§7** implementation map. TECH-SPEC **§0.27**. |
| 1.45 | 2026-05-21 | **§2.15 RBAC refactor:** retire sidebar **Jetty Live** and **`jetty-live`** page permission; **View Jetty Live stream** is **`can_approve`** under **At-Berth Executions** (camera + `/jetty-live` popup). Migration **078**. TECH-SPEC **§0.26**. |
| 1.44 | 2026-05-21 | **§2.15 Jetty Live CCTV:** optional **`jetties.rtsp_link`** in Master – Preferred Jetty; schematic **camera** button (disabled when no link); **`/jetty-live`** with **`?rtsp=`** / **`?label=`**; shared **`rtsp-stream-viewer`** (single RTSP source, last opened wins). **§2.7**, **§2.11**, **§17.6**, **§7** map. Migration **077**. Deploy **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**. TECH-SPEC **§0.26**. |
| 1.43 | 2026-05-13 | **Shipment plan:** vessel-call **agent** is edited on the **plan** (modal + hub); child SIs inherit **`agent_id`** from the plan on create / plan patch sync. **Plan-linked SI UI:** **surveyor** per shipping instruction; **document upload** sits under each “Shipping instruction *N*” heading (names only; OCR later). Allocation agent label uses plan agent when SI row has no agent. Migration **071**, TECH-SPEC **§0.25**. |
| 1.42 | 2026-05-11 | **Retire legacy list URLs** **`/allocation`** and **`/shipping-instruction`** (placeholder pages → **`/allocation-plans`** / **`/shipment-plans`**). RBAC catalog keys **`allocation`** / **`shipping-instruction`** retired; canonical **`allocation-plan`** / **`shipment-plan`** (migrations **068** / optional rollback **069**). **`GET /allocation/overview`** gated like **`plan-overview`**. Activity / SI approve paths re-keyed. **§2.13–2.14**, **§6**, **§13**, Shipping Instruction approval bullets, TECH-SPEC **§0.22**. |
| 1.41 | 2026-05-11 | **Data model (vessel call):** **Shipment plan** is the sole persisted home for **vessel name, purpose, ETA, voyage, preferred jetty, approval id, approver timestamps** shared by sibling SIs; **`shipping_instructions`** keeps SI-specific document/party/breakdown fields and **`eta_from` / `eta_to`** window. Migrations **066** (plan `approval_id` + backfill, relax SI nullability) and **067** (drop duplicate SI columns). **Rollback:** restore from backup or run **`Backend/rollback/067_rollback_restore_si_vessel_columns.sql`** before redeploying older API builds. TECH-SPEC **§0.24**. |
| 1.40 | 2026-05-11 | **§17.6–17.7** Jetty Schematic: **jetty name band** (short id) adjacent to the central pipeline on top and bottom; lane cells show **bank suffix** `01` / `02` / `03` with full `{berthId}-NN` on hover; **`01` = inner** (closest to pipeline) on **both** sides—top stack uses reversed layout. Lane height uses band minus name strip. `JettySchematic.jsx` / `jetty-schematic.css`. |
| 1.39 | 2026-05-11 | **§2.14** Plan-centric **Active vessel call** modal (**§2.4** cross-ref): merged schematic/Gantt **`plan-*`** selection loads **`GET /api/v1/shipment-plans/:id`** for plan **Time & status**; all SIs table; label tooltips only for source/derivation; Phase A representative op for pipeline/edit/NOR/photos; hide duplicate operation **Times & status** until edit. TECH-SPEC **§0.23**. |
| 1.38 | 2026-05-11 | **§2.14** Plan-centric Allocation & Berthing (`/allocation-plans`, RBAC **`allocation-plan`**, nested queue by shipment plan, **`GET /allocation/plan-overview`**, shared arrival API + activity log page key). Overview rows add **`planReference`** / **`planPurposeLabel`**. Migration **064**. TECH-SPEC **§0.22**. |
| 1.37 | 2026-05-11 | **Shipment Plan (multi-SI):** **§2.13**, **§2.1** Gantt lane key, **§2.2–2.4**, **§2.6** save/read paths, **§3** row identity, **§6** `PUT /allocation/arrival` → **`shipment_plans`**, **§9** sort tie-break, **§9.2** collapsed Clearance rows + **`POST /shipment-plans/:id/depart`**, **§7** implementation map; Dashboard dedupe (**§2.7**). Cross-ref migration **059**, **Docs/CR/Vessel-SI Change Process.md §3.4**, TECH-SPEC **§0.21**, **§3.5.1 / §3.5.3 / §3.3**. Dev seed **DEMO-SI-0005-B** on same plan as **DEMO-SI-0005**. |
| 1.36 | 2026-05-04 | **§10.1** Schedule entry uses **browser device IANA**; port **`schedule_timezone`** is metadata; Master – Port **searchable timezone** select; shell **⚓ / 💻** hints. Replaces the old “configurable org timezone” bullet in **§8**. TECH-SPEC **§0.20** + **§3.9** table. |
| 1.35 | 2026-04-28 | Added **§2.12 OIDC SSO integration** (strict mode behavior, account-linking identity rules, and current local host consistency guidance for stable session/callback flow). |
| 1.34 | 2026-04-24 | **§2.11** UI **maxLength** policy for remarks, post-check results, sampling fields, login, master data, admin roles, operational milestones, and cross-ref to Shipping Instruction / SI Approval limits; TECH-SPEC **§0.18** + `Frontend/src/constants/inputLimits.js`. |
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
| 1.15 | 2026-04-07 | **§2.7** Dashboard **slot occupancy** (capacity-aware, excludes OOS jetties from denominator); remove **Awaiting berth** sidebar; **Master** jetty operational status in UI; **OOS** blocked when operations still use jetty; Allocation **OOS** validation + schematic/Gantt/table cues; **§2.1** Gantt OOS lane styling. TECH-SPEC §2.3, §3.5. See **Docs/Plan/SLOT-OCCUPANCY-JETTY-OOS-DASHBOARD-PLAN.md**. |
| 1.17 | 2026-04-08 | **§2.7** **Port activity** chart (Operations vs Shipping instructions toggle); **weather** moved to page footer. **§7** implementation map. Cross-ref **Docs/Plan/DASHBOARD-ACTIVITY-CHART-PLAN.md** and TECH-SPEC §2.3. |
| 1.18 | 2026-04-08 | **§2.7** Port activity: **Y-axis** count scale + grid; **hover/focus tooltip** with vessel name lists per bar. TECH-SPEC §2.3. See **Docs/Plan/DASHBOARD-ACTIVITY-CHART-PLAN.md** §10. |
| 1.19 | 2026-04-09 | **§9** Detailed At-Berth Executions Log: Pre/Post sub-process rows show **Start / End / Duration** when interval data exists (aligned with operational rows). Cross-ref **Docs/Plan/AT-BERTH-EXECUTIONS-LOG-TIMES-FIX-PLAN.md** (fixed) and TECH-SPEC §3.4A. |
| 1.20 | 2026-04-10 | **§9.2** Operation **sign-off request** (Loading **Edit**) and **approve** (Loading **Approve operation sign-off**); **Clearance** **Pending sign-off** queue; **§7** implementation map. DB migration **049**. TECH-SPEC §3.3. Cross-ref **Docs/Plan/OPERATION-SIGNOFF-REQUEST-AND-APPROVAL-PLAN.md**. |
| 1.21 | 2026-04-10 | **§9.1.5** Loading/Unloading **stage tab** counts: **`— / n complete`** for Pre-Checking and Post-Checking until that stage’s persisted fetch has settled (Option A — avoids misleading **0/n** before lazy load). TECH-SPEC §2.2.4. Cross-ref **Docs/Plan/AT-BERTH-TWO-LEVEL-PHASE-AND-WORKSPACE-STAGE-PLAN.md** (Case A implemented). |
| 1.22 | 2026-04-10 | Post-Checking save hardening for sub-process times (explicit timestamp payload / range guard), sign-off approval entry restricted to **Clearance** (hub keeps request + pending visibility), Dashboard clearance card renamed **Pending Sign Off** and bound to **SIGNOFF_REQUESTED**, and Performance **Turnaround** now includes **sailed** vessels in median calculation. |
| 1.23 | 2026-04-10 | Shipping Instruction create/edit forms: **Agent** selector is now available in **Party & Port** for both **Loading** and **Unloading**. |
| 1.24 | 2026-04-15 | **Master SI Commodity** Solid/Liquid; **one commodity type per SI**; Pre-Checking **Inspection** (Tank/Hold from SI) and **Initial Cargo Checking** (Sounding/Draft Survey from SI); **no Inspection** on Unloading; Operational **Opening** (multi-row hatches; DB key `opening_hatch`) with **start-only** times for Opening and Cargo Pre-Conditioning; NOR Accepted tab uses **NOR Tendered / NOR Accepted** datetimes without a separate Start/End pair. See **Docs/Plan/UAT-COMMODITY-PRECHECK-OPERATIONAL-PLAN.md**. (Cargo handling method on Opening and label **OPENING** finalized in **1.29**.) |
| 1.25 | 2026-04-15 | Post-Checking merge: **Final Tank Inspection + Final Hold Inspection** unified into **Final Inspection** (inspection type auto-derived from SI commodity), and **Final Sounding** renamed to **Final Cargo Checking** (cargo checking type auto-derived: Sounding/Draft Survey). Stage completion count now reflects **2/2** for Post-Checking. |
| 1.26 | 2026-04-15 | **§9.2 Clearance Depart validation:** in **Record depart**, **CAST Off** must be equal to or later than the latest timestamp from the operation’s **Detailed At-Berth Executions Log** timeline; earlier input is rejected in the modal. |
| 1.27 | 2026-04-17 | Added **§2.8** and updated **§9** to standardize **Full details** timing fields across Shipping Instructions, Allocation & Berthing, and At-Berth Executions with order **ETA → TA → ETB → TB → Estimation of Completion** and `—` fallback for missing values. |
| 1.28 | 2026-04-17 | Added **§2.9** SI hyperlink behavior: table SI value opens a shared **SI Detail** modal across Shipping Instructions, Allocation & Berthing, and At-Berth Executions; documented modal field set, fallback, and implementation references. |
| 1.29 | 2026-04-20 | Operational milestone **OPENING** (UI; DB key `opening_hatch`): **cargo handling method** moved from Cargo Operations to Opening; method is **read-only** and server-derived (**Conveyor** for Solid, **Hose** for Liquid). Migration **055** backfills method on existing Opening rows. See **Docs/Plan/UAT-COMMODITY-PRECHECK-OPERATIONAL-PLAN.md**. |
| 1.30 | 2026-04-21 | Allocation visual split: **Jetty Schedule** now uses a schedule dataset that can include **SAILED** operations (time-series context, bounded lookback), while **Jetty Schematic** remains live occupancy and excludes SAILED rows. |
| 1.31 | 2026-04-21 | Jetty Schedule tooltip now shows source context for derived bars: **Planned refs (ETB, ETA)** and **Actual refs (TB, TA)**; start label explicitly shows selected source (**from ETB/ETA/TB/TA**). Planned start fallback includes **ETA** when ETB is unavailable. |
| 1.32 | 2026-04-21 | Legend simplification: removed **Arriving / allocated** and **Berthing** legend items; kept **Sailed off** status indicator. Gantt sailed classification now uses **status = SAILED OR actual completion OR cast-off** as source of truth. |
| 1.33 | 2026-04-22 | **§2.10 Jetty Operation ID** (format, when assigned, UI column order on Allocation, At-Berth, Clearance); **§2.7** Allocation queue note; **§9** table + full-details order; **§9.2** Clearance table; TECH-SPEC **§0.17** (migration **056**, env `JETTY_OPERATION_CODE_TIMEZONE`). |
| 1.34 | 2026-05-04 | **§9** Detailed At-Berth Executions Log: split **Status** / **Remark** / **Documents** columns; `GET /operations/:id/activity-timeline` includes `documents` for each sub-process event. TECH-SPEC **§3.4A.3**. |
| 1.35 | 2026-05-04 | **§2.9** / **§2.10**: **Operation Detail** (`SiDetailModal`) **At-berth process** section adds **View detailed executions log** → nested modal with **Detailed At-Berth Executions Log**; close inner layer returns to Operation Detail. TECH-SPEC **§0.12**. |

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
| Inspection (Loading only) | Single tab **Inspection**; type is **Tank** (liquid SI) or **Hold** (solid SI), read-only from the shipping instruction. **Unloading** operations do not show this step. Storage: `inspection` (`payload_json.inspectionType`). |
| Sampling | Generalized sub-process record (`sampling`) with structured sampling values (per-palka FFA/Moisture in `payload_json.records`); UI may show **summary** indicators (e.g. counts/averages) and formatted numbers in the records table. |
| Initial Cargo Checking | Single tab replacing Initial Sounding / Initial Draft Survey; type is **Sounding** (liquid) or **Draft Survey** (solid), read-only from SI. Storage: `initial_cargo_checking` (`payload_json.cargoCheckingType`). |

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
| **Scope** | Entries are associated with a **page key** (e.g. **`allocation-plan`**, **`shipment-plan`**, loading) so the slide-out panel shows relevant history for the screen the user is on. Retired keys **`allocation`** and **`shipping-instruction`** are no longer written for new actions. |
| **Detail** | When the backend supplies a **`changes`** array (`field`, `from`, `to`), the user can expand an entry to see a **before → after** list (aligned with Shipping Instruction style). |
| **Quality** | Updates should show real prior values when they existed, not only “empty → new value”, for fields such as remarks and status. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §3.8A**.

---

## 14. Application shell (sidebar & top bar)

| Element | Behaviour |
|---------|-----------|
| **Sidebar** | Primary navigation uses an updated layout (card-style on desktop, collapsible). |
| **User menu & logout** | When signed in, the **top bar** shows a **user menu** (name + initials avatar), not a separate greeting line and logout button. The menu lists identity (name, email), **Change Password** (local accounts only — **§2.16**), and **Logout** (red). **Logout** is not in the sidebar footer. |

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

**Scope:** Behaviour for **Loading** and **Unloading** shipping instructions: **purpose-first** create/edit form behaviour, Loading document view, submit for approval, and **RBAC-gated** sign-off.

| Area | Behaviour |
|------|-----------|
| **Extra draft fields** | Optional: **voyage no.**, **document date**, **destination**, **freight terms** (PREPAID / COLLECT / AS PER CHARTER PARTY / OTHER), **B/L clause**, **consignee**, **notify party**, **BL indicated**. |
| **Purpose-first form** | In **Create Vessel Trip / New Shipping Instruction**, user must choose **Purpose** (**Loading** or **Unloading**) first; until selected, the rest of the form is disabled. |
| **Loading vs Unloading field sets** | **Loading** shows Route/Freight + B/L fields; **Unloading** hides those and instead shows **Term** (trade term) under Party & Port. **Agent** is available under **Party & Port** for both Loading and Unloading forms. Both use the same submit/approval pipeline. |
| **B/L split text** | Create/edit modal provides an editable **B/L Split** textarea (not auto-generated), persisted on the SI record and shown on the document view. |
| **NPWP (read-only)** | NPWP is **not** a free-text SI field. The UI shows NPWP as **read-only** from a **per-port master** (based on the active selected port). |
| **Submit for approval** | **Request approval** calls the API to set status **Submitted** (not only local UI state). |
| **Approve SI** | List action opens the approval page only if the user has **Approve shipment plan** / internal SI approve capability on the **`shipment-plan`** page (see Admin → Roles). |
| **Approval API** | Transition **Draft → Approved** requires prior **Submitted**; **PUT** with `status: Approved` checks **`can_approve`** for page **`shipment-plan`**. **403** if missing. |
| **Approver on document** | On approval, the system stores **approver name/title snapshots** (from `users.display_name` / `users.job_title`, default title **OPERATION HEAD** if job title empty). The **SI document view** shows these instead of a fixed name. |
| **Printed SI number** | Document **No.** prefers stored **`reference_number`** when set; otherwise legacy synthetic numbering. |
| **SI quick detail (list table)** | SI values in table rows are hyperlink-style and open a shared **SI Detail** modal (non-document view) with operational fields and Contract/PO breakdown. |

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

### 17.6 Schematic bank lanes (inner `01`, jetty name band)

On **Allocation → Jetty Schematic**, each configured jetty **top** or **bottom** cell is a **zone** containing: (1) a **jetty name band** showing the short **berth id** (e.g. **1A**, **1B**) flush against the central **pipeline** (black bar), plus an optional **CCTV camera** control when the user has **View Jetty Live stream** (`can_approve` on **At-Berth Executions**) and master data defines an RTSP link for that jetty (**§2.15**), and (2) **`capacity`** lane boxes. Each lane shows the **bank suffix** only (**`01`**, **`02`**, **`03`**, …); the full lane id **`{berthId}-NN`** appears on **hover** (e.g. tooltip **`1A-01`**). **Inner bank** is **`01`** (closest to the pipeline on **both** top and bottom); **`02`** is the next **outward**, **`03`** outward again for triple bank. The **top** lane stack uses reversed vertical order so **`01`** stays inner toward the pipeline (the **bottom** stack keeps natural order). Each box holds **at most one** displayed vessel (vacant otherwise). Occupants are ordered like the Jetty schedule Gantt: **TB** ascending, then **operation id**, then **vessel id** (see TECH-SPEC **§0.6**). If more occupied vessels than **capacity**, the last lane shows **+N more** after the representative vessel for that lane. **Incoming** names (queue) are hinted on the **first vacant** lane only to avoid clutter.

### 17.7 Schematic layout & lane sizing (UX)

- **Pipeline alignment:** Each schematic **column** uses a **fixed-height** top band, **fixed** middle (pipeline) band, and **fixed-height** bottom band so the black **pipeline** segment stays **level across columns**, including columns whose top or bottom cell is a non-dockable placeholder (`—`).
- **Consistent lane box height:** Each lane’s height is derived from the **lane stack** area (the fixed band height **minus** the jetty name strip and spacing) divided by **max(jetty `capacity`, 2)**. A jetty with **capacity 1** therefore uses the **same lane band height** as a single lane on a double-bank jetty (the vessel card does not stretch to the full top/bottom band).
- **Readability:** Lane copy (vessel name, SI, purpose, material) uses **compact** typography and padding; lanes may **scroll vertically** if content exceeds the band (edge case).

---

*End of document.*
