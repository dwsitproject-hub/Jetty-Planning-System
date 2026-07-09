# Functional specification — Jetty schedule Gantt & arrival updates

**Product:** Jetty Planning & Monitoring System (JPS)  
**Scope:** Features delivered for **Allocation → Jetty schedule**, **Log arrival update**, **Confirm Berthing**, **shifting out / re-dock** (priority / double-bank berth handover)**, **At-Berth Executions list**, **operation sign-off → Clearance (Ready to Sail)**, **uploaded document preview & download**, **Jetty Live CCTV** (per-jetty RTSP links, schematic camera control, browser stream page), **self-service change password** (header user menu), **Reporting → Jetty – Vessel Report** (jetty utilization summary and vessel detail), and **user-visible date/time presentation** (Gantt bar logic, estimated completion, and related UI).  
**Audience:** Product, QA, and engineering (for regression and extension).  
**Version:** 1.61 (see document history at end).

---

## 1. Purpose

This document describes **behaviour that is implemented in code**, including:

- Jetty schedule **Gantt** rendering rules (planned vs actual, segment types, end dates).
- **Jetty Schematic — View as of** date control, schedule-derived berth occupancy, occupied-lane content layout, and purpose / ETC styling (**§17.7–17.8**).
- **Estimated completion** capture in UI and persistence via the allocation API.
- **Operations completed** (sign-off) vs **actual completion** (depart): separate timestamps, occupancy rules, read-only Allocation modal fields, and **SAILED** pipeline labelling (**§5.2**, **§6**, **§9.2**, **§17.8**).
- **Confirm Berthing** saving arrival-related fields (including estimated completion) to the backend.
- Related **cosmetic** behaviour on the Gantt (reset control, intro area, removal of a confusing planned segment).
- **At-Berth Executions** list: what the user sees, which data it reflects, columns, expandable details, and summary cards.
- **Operation sign-off** after at-berth work: request vs approve (RBAC), **Clearance** queue, **CAST Off** validation on depart (client + API), and read-only **Sailed** modal presentation (**§9.2**).
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
- **Dashboard V2 filters:** **Purpose** and **Commodity Type** multi-select filters on the main dashboard (`/`), with date range, instant apply, and filtered pipeline / KPI / at-berth / weekly-trends views (**§2.18**).
- **Uploaded document preview:** shared in-app preview modal for uploaded **images** and **PDFs** with explicit **Download**; replaces immediate browser download when clicking file links (**§2.19**).
- **SI shipper per breakdown line:** shipper is chosen **per commodity/contract row** in the Shipment breakdown table (not a single Party & port field); one SI may show **multiple shippers**; Allocation queue **Shipper** column aggregates distinct names (**§2.20**, **§16**).
- **Commodity Qty in overview tables:** a single **Commodity Qty** column after **Shipping Instruction** on **Allocation & Berthing**, **At-Berth Executions**, **Clearance**, and **Shipment Plans** list; values come from SI breakdown lines; multiple commodities within one SI appear on **separate lines** in the cell (**§2.21**).
- **Jetty – Vessel Report:** port-scoped reporting on jetty allocation and **utilization summary** with column-header tooltips; detail rows from live operations and incoming SIs assigned to a jetty (**§2.22**).
- **Inbound Shipping Instruction integration (partner API):** external systems (e.g. EOS Export/Import, KLIPS) submit vessel calls via a machine-to-machine API; operators review them through the existing **Shipment plan** approval flow; the plans list shows **External reference** and **Requested by** after **ETA** (**§2.23**).
- **Master Jetty — purpose-specific commodity capability:** each jetty maintains separate **Allowed for Unloading** and **Allowed for Loading** commodity lists; **Shipment Plans** jetty suggestions and save validation use the list that matches the plan **Purpose** (**§2.24**).

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
| **Legend** | Explains **Planned (known)** vs **Planned (open end)**, **Actual (known)** vs **Actual (open end)**, **Late (past ETC)**, **Now**, and **Sailed off** status color. |
| **Bar colours (planned vs actual)** | **Planned** segments use **orange** (`#ea580c`); **Actual** segments use **purple** (`#7c3aed`). These colours are **intentionally distinct** from **Loading** (green) and **Unloading** (blue) **purpose** badges on bars and elsewhere, so planners can read schedule layer vs cargo purpose at a glance. **Late (past ETC)** on an in-progress Actual bar transitions from purple toward **red** on the overdue portion (legend swatch matches). **Sailed off** bars remain **muted grey**. Tokens: **`--gantt-planned-*`**, **`--gantt-actual-*`** in **`design-tokens.css`**. |
| **Date range controls** | **From** / **To** use compact **`type="date"`** fields (~**9.25rem** wide, **32px** height) and a matching **Reset** button in the filter bar (shared styling with schematic **View as of**). |
| **Vessel icon** | Bars use an **inline SVG** ship icon (avoids emoji rendering issues on Windows). |
| **Click vessel** | Where configured, clicking a bar selects the vessel for details. |
| **Sailed visibility scope** | **Jetty Schedule** is a time-series surface and can include **SAILED** operation rows (bounded history from backend) when they intersect the selected date window. **Jetty Schematic** uses the same **`scheduleQueue`** dataset and **Actual · alongside** rules (**§17.8**): **past** days show vessels that were alongside on that calendar day (including **SAILED** rows within backend lookback); **today** uses **point-in-time** occupancy so **SAILED** vessels disappear from occupied lanes after cast-off and may appear under **Incoming** on a vacant lane. Not limited to live API **`berths.occupants`**. |
| **Actual open end (in progress)** | For **Actual · alongside** while the vessel is **still at berth** (no `actualCompletionDateTime`, no `castOffDateTime`, status not **SAILED**), the bar end is **`max(estimatedCompletionDateTime, now)`** (or **`now`** when estimate is missing)—not a fixed **+3-day** tail—so in-progress bars stay aligned with physical occupancy. Open-end Actual bars **recompute** on a ~**30s** tick with the red **Now** line. |
| **ETC past estimate (Actual bar)** | When **`now > estimatedCompletionDateTime`** and the vessel has not sailed, the Actual alongside segment uses **overdue** styling (distinct bar treatment), tooltip copy, and—when the bar is wide enough—a compact **ETC breached** indicator. Legend includes **Late (past ETC)** where applicable. **ETC breach** is suppressed when the vessel is **signed off** (`SIGNOFF_REQUESTED` / `SIGNOFF_APPROVED` or **`operationsCompletedDateTime`** set)—cargo work is finished even if still alongside. |
| **Purpose on bars** | Gantt bars may show a compact **purpose** badge (Loading / Unloading) when space permits; tooltips include **cargo** summary when present on the queue row. |
| **Removed segment** | The **planned “transit” sliver** from **ETA → planned ETB** was **removed** — it was visually confusing; the Gantt does not draw that segment anymore. |
| **Tooltip source context** | Hover tooltip shows source references for derived bars: **Planned refs** (`ETB`, `ETA`) and **Actual refs** (`TB`, `TA`). Start line indicates which source is used, e.g. **Start ... (from ETB/ETA/TB/TA)**. |
| **Status color source of truth** | Gantt bar status color treats a vessel as **Sailed off** when operation status is **`SAILED`** only (`isSailedRow` in **`jettyScheduleOccupancy.js`**). **`castOffDateTime`** alone does **not** mark sailed off (orphan cast-off on sign-off rows is cleared by migration **083**). **`operationsCompletedDateTime`** (sign-off) does **not** end alongside display or ETC-breach evaluation. **`actualCompletionDateTime`** is set at depart (`= cast_off_at`) when status becomes **`SAILED`**. |
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
| **Current Phase pipeline** | Four steps: **Shipping Instruction**, **Planned berthing**, **At-Berth**, **Clearance**. **Current:** shows the active step. When operation **`status === SAILED`**, all four steps render as complete and **Current: Sailed** (not **At-Berth**). **SAILED** is determined by **`status`** only — not by **`castOffDateTime`** alone — so Allocation stays aligned with **Clearance** after depart even if legacy or bad **`cast_off_at`** values exist in the database. |
| **Derived time labels (SAILED)** | **Time since berthing** ends at **`castOffDateTime`** (fallback **`actualCompletionDateTime`**), not live **now**. **Est. time remaining** shows **Sailed** instead of a duration. Plan-centric modal (**§2.14**) applies the same rules when **`planDetail.sailedAt`** is set or the representative operation is **SAILED**. The pipeline footer **Clearance** link is enabled when the vessel has **Sailed**. |
| **Last updated** | Between **Current Phase** and **Times & status**, the user sees a single secondary line: **Last updated on** the latest **date/time** across **`shipment_plans.updated_at`** and the linked **`operations.updated_at`** for that row’s vessel call, and when known **by** the **user display name** from whichever side changed most recently. For **incoming** queue rows that are **shipping instruction only** (no operation yet), the timestamp reflects **`shipping_instructions.updated_at`**; no “by” name is shown for those rows in this release. |
| **Edit (Times & status)** | Users whose role grants **Allocation & Berthing → Edit** see an **Edit** control (icon with tooltip **Edit**) on the **Times & status** card header. **View-only** users do not see Edit. Editing is available only when the row has an **operation** (not for SI-only incoming rows in this release). |
| **Fields in edit mode** | **ETA, TA, ETB, TB, POB, SOB, Est. completion** use the same **`datetime-local`** styling as **Log arrival update** / **Confirm Berthing**. **Operations completed** and **Actual completion** are **read-only** in all modes: **Operations completed** is stamped at sign-off approval; **Actual completion** is set only at **Record depart** (Clearance). **Time Since Berthing** and **Est. Time Remaining** stay **read-only**; they **do not** live-update while the user types—they refresh from saved data **after a successful Save**. |
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

**Note:** The live dashboard (`/`) is **Dashboard V2**. **Purpose** and **Commodity Type** multi-select filters (with date range) are documented in **§2.18**. Rows below describe KPI and chart behaviour; where Dashboard V2 differs (e.g. date-scoped performance KPIs, weekly trends server filters), see **§2.18** and TECH-SPEC **§0.29**.

| Area | Behaviour |
|------|------------|
| **Dashboard — slot occupancy** | The KPI labelled **Slot occupancy** shows **vessel positions in use / total positions** across jetties in the port: numerator **Σ min(occupiedCount, capacity)**, denominator **Σ capacity** for jetties whose master status is **not** **Out of Service**. (This replaces counting only “jetties with any occupant” vs “number of jetties”.) If data temporarily exceeds capacity, the bar may indicate **over capacity** visually. The card includes a shortcut link **View at‑berth →** to the At‑Berth Executions page. The caption includes a **Details** tooltip listing occupied slots as `<jetty>-<lane> — <vessel name>` (hover or keyboard focus). |
| **Dashboard — Port activity** | The **top row** (left of the KPI grid) shows a **Port activity** card with a toggle: **Operations** — grouped bars for **Loading** and **Unloading**, each with **Planned berthing** vs **Berthing** counts; percentages are **within that purpose** (planned vs berthing as shares of Loading-only or Unloading-only rows). Data is **allocation overview queue** for the selected port, aligned with pipeline **planned berthing** rules; **berthing** counts exclude rows in **shifting out**. **Shipping instructions** — three bars (**Approved**, **Submitted**, **Draft**) with counts and **percentage of all SIs** returned for the port. The chart shows a **Y-axis** of integer counts with **horizontal dashed grid** lines aligned to bar height. **Hover or keyboard focus** on a non-zero bar opens a **tooltip** (popover) with the count, labels, the same percentage rule as on the chart, and a **list of vessel names** in that segment (queue rows: vessel name, else vessel id, else em dash; SI mode: per instruction the same). Tooltips dismiss on leave, blur, scroll, or resize. Empty and loading states are explicit. |
| **Dashboard — weather** | The weather preview (mock data, “coming soon” overlay) appears at the **bottom** of the dashboard page, not in the top row. |
| **Dashboard — awaiting berth widget** | Removed. **Planned berthing** in the **Vessel pipeline** is the single indicator for “jetty assigned, not yet alongside” (see pipeline sublabel). |
| **Dashboard — jetty status** | The KPI grid includes a **Jetty status** card showing **Available** and **Out of Service** counts. Counts come from **`GET /jetties?port_id=…`**. Hover or keyboard focus on each status chip shows a tooltip listing the jetties in that bucket. |
| **Dashboard — SLA at risk** | The KPI **SLA at risk** shows a count of operations past estimated completion. Hover or keyboard focus on the KPI value shows a tooltip listing `Vessel Name, Jetty No, +Xh over ETC` for each risk item (same items as the “SLA & schedule risk” list). |
| **Dashboard — performance** | The Dashboard includes a **Performance** card (non‑SLA) with a toggle **24h / 7d** and three KPIs: **Waiting to berth** (median **TA→TB**, from allocation overview queue), **Turnaround** (median **TB→Cast‑off**, fallback **TB→Actual completion**; computed from operations so **sailed vessels are included**), and **On‑time berthing** (% where **TB ≤ planned ETB + 6h**, from allocation overview queue). Each KPI supports hover/keyboard tooltip drill‑down showing the worst/late cases in the selected window (vessel, jetty, duration). |
| **Master — Preferred Jetty** | Users set **Operational status** (**Available** / **Out of Service**) in the add/edit modal. Required physical specs: **Jetty Length (m)**, **Draft Jetty**, **DWT Jetty**. Commodity capability is configured as two optional multi-select lists — **Allowed for Unloading** and **Allowed for Loading** — sourced from **Master – Commodity** (**§2.24**). Optional **RTSP link (CCTV)** (max **512** characters) is stored per jetty for Jetty Live; empty means no CCTV on that jetty (**§2.15**). **Out of Service** cannot be saved while a **blocking** operation still uses that jetty (**non-SAILED**, **`shifting_out` false**); the API returns **409** and the UI explains planners must **reassign or complete** on **Allocation & Berthing** first. New jetties default to **Available**; non-default status on create is applied via a follow-up status call. |
| **Allocation — copy & validation** | Short intro under **Incoming vessel & berthing plan** states that **out of service** jetties cannot receive new allocations. **Log arrival update**, **Confirm Berthing**, and **Active Vessel Detail** saves that assign a **resolved** jetty whose overview berth is **Out of Service** are **blocked client-side** with RBAC-aware wording (users **with** master-jetty view are pointed to **Master – Preferred Jetty**; others to **contact an admin**). Server **409** on `PUT /allocation/arrival` enforces the same. |
| **Allocation — queue table** | Includes **Jetty Operation ID** before **Shipping Instruction** when the row has an operation; **Commodity Qty** immediately after **Shipping Instruction** (**§2.21**); see **§2.10** for Jetty Operation ID. Jetty column may show a small **OOS** badge when the row’s jetty maps to an out-of-service berth in overview (e.g. legacy assignment). |
| **Jetty schematic** | Stacks for **Out of Service** berths are **muted**, show an **OOS** badge, and tooltips state the jetty is **not available for new allocation**. When **View as of = today**, schematic **occupied** lane count aligns with **Slot occupancy** (same **`scheduleQueue`** alongside rules; excludes **SAILED**, **shifting-out**, and **OOS** denominator jetties). |

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
| **Modal content** | Shared SI detail modal shows: SI No, Status, Source, Vessel, Purpose, Jetty, ETA From, ETA To, ETB, TB, ETC, Term, Voyage, Destination, Freight terms, Document date, B/L clause, B/L split, Consignee, Notify party, BL indicated, **Shipper** (comma-separated distinct names when lines differ), Loading port, Surveyor, Agent, Note, Approver, Approval date, and **Contract / PO breakdown** (each line includes **Shipper** when set). |
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
| **Where shown** | Main data tables on **Allocation & Berthing**, **At-Berth Executions**, and **Clearance** include a **Jetty Operation ID** column **immediately before** **SI / Shipping Instruction**, then **Commodity Qty** (**§2.21**). **Incoming SI-only** rows (no operation yet) show **`—`** in the Jetty Operation ID column. |
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
| **Primary list UI** | The standalone **`/shipping-instruction`** list URL is **retired** (placeholder with links to **`/shipment-plans`**). Plan-backed SI creation and list management use **`/shipment-plans`** (and **`/shipment-plans/:id`**). The plans list table includes **Commodity Qty** after **Shipping instructions** (**§2.21**), then **External reference** and **Requested by** after **ETA** for integration and manual source tracing (**§2.23**). Deep links **`/shipping-instruction/view/:id`** and **`/shipping-instruction/approval/:id`** remain; access is governed by **`shipment-plan`** page permissions (not the retired **`shipping-instruction`** catalog key). |
| **Allocation queue** | **`GET /allocation/overview`** remains a **flat `queue`**: every row is still one SI (plus operation when present). Rows on the same plan share **`shipmentPlanId`** and the **same** plan-level timestamps and jetty (denormalised in SQL for display). |
| **Full details (Allocation)** | When more than one SI exists on the plan, **Full details** lists **SIs on this shipment plan** (read-only reference lines). |
| **Jetty Schedule (Gantt)** | Double-bank **bank lane** groups by **`shipmentPlanId`** when set so the call does not appear as two competing vessels on 01/02 (**§2.1**). |
| **At-Berth** | Table remains **one row per operation (per SI)**; client sort **tie-breaks** by **`shipmentPlanId`** then **TB** so sibling rows sit together. |
| **Loading / Unloading hub** | When multiple operations share a plan, a compact **Shipping instruction** selector switches the route’s **`op-<id>`** segment only; hub chrome is unchanged. |
| **Clearance** | **Ready to Sail** and **Sailed** lists **collapse to one row per shipment plan** (SI column summarises multiple references). **Record depart** uses the **plan depart** API when **`shipmentPlanId`** is present; **CAST Off** must pass validation in **§9.2** step **5** (future, TB, combined execution-log minimum). Document uploads still attach via a representative **operation id** (primary row). **Sailed** modal shows read-only **CAST Off** with **`formatDateTimeDisplay`** (**§10**). |
| **Dashboard — Port activity** | Operations-mode counts **deduplicate** queue rows by **`shipmentPlanId`** so a multi-SI call is not double-counted in **Planned berthing** / **Berthing** bars. **Performance** waiting / on-time metrics use the same dedupe rule for TA→TB and on-time berthing. |
| **Plan-linked SI form — shipper** | On **`/shipment-plans`**, each child **Shipping instruction** form places **Shipper** as the **first column** of the **Shipment breakdown** table (master dropdown per line). **Party & port** retains loading port, **surveyor** (per SI), trade term (Unloading), and agent (inherited from plan). One SI may list **different shippers** on different breakdown lines. See **§2.20**. |
| **Jetty selection (plan modal)** | Optional **Preferred jetty** on create/edit uses **purpose-aware** commodity capability, LOA/DWT fit, and ETA occupancy checks against master jetty data (**§2.24**). |
| **Adding SIs after approval or during operations** | **Normal UI — not supported:** On **`/shipment-plans/:id`**, **Add SI**, **Edit plan**, and **Submit for approval** are shown only when the plan **`approval_status`** is **Draft** or **Rejected**. On **Approved** or **Submitted** plans those controls are hidden; the plans list **Edit** modal is also disabled for non-Draft plans. **Intended workflow:** define all SIs before submit/approve, or use the **late SI** path (plan + arrival first, SI later — **§2.14**). **API exception:** **`POST /shipping-instructions`** with **`shipment_plan_id`** still creates a new SI on an **Approved** or **Submitted** plan and is **not** blocked when **`operations`** already exist. The plan is **reopened** to **Draft**, all existing child SIs reset to **Draft**, and the response includes **`planReopened: true`**. In-flight **`operations`**, allocation timestamps, and at-berth work are **not** deleted, but **Confirm Berthing** stays blocked until the plan is **re-approved** (**§2.14**). **UI gap:** the client does not yet surface **`planReopened`** feedback after API create. **Edge case:** deep link **`/shipment-plans?shipment_plan_id=<id>`** can open the add-SI flow without the hub approval gate — unsupported for routine production use. |

### 2.14 Allocation & Berthing — plan-centric queue (second page)

| Area | Behaviour |
|------|------------|
| **Where** | Route **`/allocation-plans`** is the primary **Allocation & Berthing** surface. The legacy list URL **`/allocation`** is **retired** (placeholder linking to **`/allocation-plans`** and **`/shipment-plans`**). RBAC page key **`allocation-plan`** replaces the retired catalog key **`allocation`** (migration **068**). |
| **Data** | **`GET /allocation/plan-overview`** and **`GET /allocation/overview`** return the **same JSON shape** (`queue`, `scheduleQueue`, `berths`) and both require **`allocation-plan`** **view** after migration **068**. Each flat queue row includes **`planReference`** and **`planPurposeLabel`** when the shipment plan and purpose master rows are present. Incoming SI rows without an operation use **`source`** = **`incoming-si`**. |
| **Queue table** | The **Incoming** table is **grouped by `shipmentPlanId`**: one **summary** row per plan (reference links to **`/shipment-plans/:id`**, vessel name, purpose badge when available, jetty summary, berthed vs total line count), then **nested child rows** per SI/operation with the **same columns, filters, sort, expand row, and actions** as the legacy Allocation page (including **Commodity Qty** after **Shipping Instruction** — **§2.21**). Rows with no plan id are listed in an **ungrouped** block after grouped plans (normally empty when all SIs are plan-backed). |
| **Actions on children** | **Log arrival update**, **Confirm Berthing**, **Re-dock**, berthing sequence controls, **Full details**, and SI / Jetty Operation ID links behave like the legacy page and target the **child** SI/operation only. |
| **Jetty schematic & Jetty schedule (Gantt) — data** | Both consume **`scheduleQueue`** (and plan-centric merges of the same rows) from **`GET /allocation/overview`** or **`plan-overview`**. **Jetty schedule** filters by its **From / To** range. **Jetty schematic** filters occupancy by **View as of** calendar day (**§17.8**). The incoming queue table still uses flat **`queue`**. |
| **Jetty schematic / Gantt — merged plan selection** | Slots keyed **`plan-<shipmentPlanId>`** open the **Active vessel call** modal in **plan-first** mode: title links to **`/shipment-plans/:id`**; **Time & status (shipment plan)** is read-only and sourced from **`GET /api/v1/shipment-plans/:id`** (plan-level ISO timestamps); **derived** rows (**Time since berthing**, **Est. time remaining**) use the same display rules as the operation modal but **inputs are plan fields**. Short **source / derivation** text appears on **`<dt>` tooltips** only (not in the value column). A **Shipping instructions on this plan** table lists every child row from the current **`queue`** ∪ **`scheduleQueue`** (deduped). If the plan fetch fails, an inline error appears in the plan **Time & status** block; the SI table still renders from the overview. **Phase A:** **Current Phase**, **Edit** (including operation **Times & status**), **NOR**, and **berthing photos** remain tied to the **representative** operation resolved for that merged slot, with a short explanatory subtitle in the modal; the operation-level **Times & status** card is **hidden in read-only plan mode** to avoid duplicate/conflicting numbers and **shown again when editing** so saves stay operation-scoped. |
| **Retired `/allocation` URL** | Schematic / Gantt clicks that resolve to a **single** `op-*` / `si-*` id keep the existing **Active Vessel Detail** behaviour (**§2.4**); no plan-detail fetch. The bookmark **`/allocation`** itself no longer renders the legacy list. |
| **Saving arrival / berthing** | **`PUT /allocation/arrival`** requires **`allocation-plan`** **edit**; activity log **`page_key`** is **`allocation-plan`**. |
| **Late SI (plan before SI)** | **Shipment plans** may be created with **vessel + ETA + purpose** only (no SI). Plans with **zero SIs** appear in **`/allocation-plans`** as **`source`** **`incoming-plan`**. **Log arrival update** accepts **`shipmentPlanId`** alone (jetty, ETA, ETB, priority, remark, No PKK on the plan — not TA/TB/ETC). **Berthing** is **disabled** until the **shipment plan** is **`Approved`** **and** has **at least one** shipping instruction (tooltip references plan approval); the API rejects alongside timestamps until then. Approving a plan cascades **`Approved`** to all child SIs; adding a new SI to an **Approved** or **Submitted** plan **reopens** the plan to **Draft** for re-approval. **Confirm Berthing** (TA, TB, ETC, vessel photo) uses the existing **Berthing** modal after the gate opens. |
| **Adding SIs mid-operation (limitation)** | The product UI does **not** support adding SIs once a plan is **Submitted** or **Approved**, including when sibling operations are already at berth (**§2.13**). API create remains possible and forces **re-approval** without removing existing operations or timestamps. |
| **Re-dock (shift-out clear)** | **`POST /operations/:id/shifting-out`** accepts **`activityLogPage`** **`allocation-plan`** for audit consistency when used from this page. |

### 2.15 Jetty Live CCTV (per-jetty RTSP)

| Area | Behaviour |
|------|------------|
| **Master data** | **Master – Preferred Jetty** add/edit modal includes optional **RTSP link (CCTV)** (placeholder example: `rtsp://user:pass@host:554/Stream1`). Value is trimmed on save; empty clears the link. Max **512** characters in the UI. |
| **RBAC — schematic & viewer** | No dedicated sidebar item. Schematic **camera** buttons and the **`/jetty-live`** popup require **View Jetty Live stream** — an **`can_approve`** sub-flag on **At-Berth Executions** in Admin → Roles (same pattern as **Approve shipment plan**). Migration **078** retires standalone **`jetty-live`** page permission (**072**). Users without the flag do not see camera controls. |
| **RBAC — master** | Configuring RTSP links uses existing **Master – Preferred Jetty** permissions (`master-jetty` view/edit); no separate CCTV master page. |
| **Jetty Schematic** | Each configured jetty **name band** (short id, e.g. **1A**) shows a small **camera** control beside the label. **Enabled** when that jetty has a non-empty RTSP link in master data. **Disabled** with tooltip *There's no CCTV on this jetty* when the link is missing. **Enabled** click opens a **new browser tab** to **`/jetty-live?rtsp=<url>&label=<berthId>`** (`label` is the short berth id for the page title). |
| **Jetty Live page** | Route **`/jetty-live`**. On load, if **`rtsp`** query param is present and valid (`rtsp://…`), the UI calls the stream helper **`POST /api/reconnect`** with that URL (stores/switches the shared RTSP source), then attaches **JSMpeg** to the WebSocket video feed (WebSocket connect **starts** FFmpeg when the first viewer is present). Optional **`label`** sets the page heading (e.g. *Jetty Live — 1A*). If the link has no **`rtsp`** param, the user sees guidance to configure master data or open from the schematic. |
| **Stream service** | Separate host process **`rtsp-stream-viewer`** (not inside API or frontend containers): FFmpeg pulls RTSP → MPEG1 over WebSocket at **1 fps** by default (configurable). **On-demand:** FFmpeg runs only while at least one viewer has an open WebSocket; when the **last** viewer closes the Jetty Live tab, FFmpeg stops after a **30 s** idle grace (tab refresh within that window avoids a cold start). **One active RTSP source at a time** on a given instance; opening CCTV for another jetty **replaces** the URL (**last opened wins**). Health card shows status, viewer count, last frame time, restart count, masked RTSP source; **Reconnect** repeats the current URL when a viewer is connected. |
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
| **Preferred Jetty** | Columns: **Port**, **Order**, **Jetty name**, **Capacity**, **Length (m)**, **Draft**, **DWT**, **Unloading commodities**, **Loading commodities**, **Status**, **Description** (full text for filter). Default sort: **Port** A→Z. Add/edit includes required length/draft/DWT, **Allowed for Unloading** / **Allowed for Loading** commodity multi-selects (**§2.24**), **RTSP link**, and operational status (**§2.15**). |
| **SI lookups** (Term, Shipper, Loading Port, Surveyor, Agent, Commodity) | Columns: primary **value** label for that page; **Commodity** also **Type** and optional **loading/unloading rate** columns when enabled. **Sort order is not shown** in the UI (no column, filter, or cell); backend **`sort_order`** still drives API list order and SI dropdown ordering. Default table sort: **value** A→Z. |
| **Freight Terms** | Read-only table: **Code**, **Label**; sort/filter on the four fixed enum rows. Default sort: code A→Z. |
| **Empty filters** | When rows exist but every row is excluded by filters, the page shows *No entries match the current filters.* |
| **Actions** | **Edit** / **Delete** (where RBAC allows) remain in the rightmost column; filter inputs do not intercept button clicks. |

### 2.18 Dashboard V2 — Purpose and Commodity Type filters

The live dashboard route **`/`** is implemented as **Dashboard V2** (`Frontend/src/pages/DashboardV2.jsx`). The filter bar sits in the page header, **to the left** of the existing date-range control (presets + From/To).

| Area | Behaviour |
|------|------------|
| **Purpose filter** | Multi-select **checkbox dropdown**. Options: **Loading**, **Unloading** (from plan **`purposeCode`** / operation **`purpose`**). **Empty selection** = all purposes. When one or more values are selected, the trigger shows **Purpose (n)** with a red count accent. |
| **Commodity Type filter** | Multi-select **checkbox dropdown**. Options come from **Master Commodity** (`GET /si-lookups` → **`commodities`**: Batu Bara Curah, CPKO, CPO, etc.), ordered by master **`sort_order`** then name. **Empty selection** = all commodities. Active trigger shows **Commodity Type (n)**. |
| **Date range** | Unchanged: **This month**, **Last month**, **Last 7 days**, **Last 30 days**, plus **From** / **To** date inputs. Changing the date range refetches dashboard data and repopulates commodity options; commodity selections that are no longer valid are cleared automatically. |
| **Apply behaviour** | **Instant** on each checkbox toggle (no separate Apply button). |
| **Filter logic** | **OR** within a category (e.g. Loading **or** Unloading). **AND** across categories (selected Purpose **and** selected Commodity Type must both match). |
| **Sections that update** | **Vessel pipeline** (all seven stages), **Slot occupancy**, **Waiting to berth**, **Turnaround**, **On-time berthing**, **SLA at risk**, **Ready to Sail** (clearance row), **At berth now** (Loading / Unloading summary cards and phase breakdown). |
| **Sections not filtered** | **Jetty status** (Available / Out of Service) — port infrastructure, not vessel-scoped. |
| **Weekly trends** | Refetched from the server when Purpose, Commodity, date range, or port changes. Charts and tooltips reflect the active filters. While refetching, the section shows **Updating charts…** and dims briefly; when filters are active, the hint reads that charts follow the selected Purpose and Commodity filters. |
| **Empty / no-match state** | When filters are active but nothing matches: a banner **No data available for selected filters** appears below the filter bar; KPI cards show the same message instead of **—** where there is no sample; **At berth now** shows the message instead of empty phase grids; pipeline cards show **0**. |
| **Responsive layout** | Filter bar wraps on narrow viewports (Purpose, Commodity, then date controls stack without breaking the page layout). |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.29**, **§2.3**, **§3.7**.

### 2.19 Uploaded document preview & download

Uploaded **images** (JPEG, PNG, GIF, WebP) and **PDFs** attached in operational workflows open in a **shared preview modal** instead of triggering an immediate browser download or navigating away in a new tab. Users can still **Download** the file or **Open in new tab** from the modal footer.

| Area | Behaviour |
|------|------------|
| **Trigger** | Click a **document file name** (hyperlink-style control) or a **berthing vessel photo** thumbnail. |
| **Preview modal** | Shows filename in the header; **images** render inline; **PDFs** render in an embedded viewer (iframe). **Escape**, overlay click, or **×** closes the modal. |
| **Loading / errors** | A loading state appears while the file is fetched. If preview fails (unsupported type or load error), a short message is shown; **Download** remains available. |
| **Unsupported types** | Office formats (e.g. `.doc`, `.docx`) and other non-previewable uploads show a message that the browser cannot preview the file; user may **Download** only. |
| **Download** | Footer **Download** saves the file using the authenticated download endpoint (attachment disposition). |
| **Open in new tab** | Footer **Open in new tab** opens the inline **`/view`** URL in a separate browser tab. |
| **Multi-port users** | Preview fetches files with the same session and **port scope** headers as other API calls (required when a user has more than one assigned port). |

**Modules / pages where preview + download is available**

| Module | Route / surface | What can be previewed |
|--------|-----------------|------------------------|
| **Allocation & Berthing (Plans)** | `/allocation-plans` — vessel detail modal | **NOR documents** (Arrival documents); **Berthing vessel photos** (thumbnail + click-to-expand) |
| | Confirm berthing / arrival-update modals | Pending **berthing photo** thumbnails; **NOR** document links |
| **Loading / Unloading** | `/loading`, `/unloading`, operation workspace | **Pre-Checking** and **Post-Checking** section documents (edit + read); **Detailed At-Berth Executions Log** document links |
| **Clearance** | `/verification` — depart modal (after sailed) | Recorded **clearance document** and **vessel photo** links |
| **Shipment Plans** | `/shipment-plans` — create/edit plan modal | **SI source document** uploads (OCR pipeline) |
| **SI Approval** | `/shipping-instruction/approval/:siId` | **Verified Attachments** sidebar (click name to preview; ⬇ to download) |
| **At-Berth Executions** | `/at-berth` → **SI Detail** modal → nested executions log | Sub-process documents on the activity timeline (same as Loading log) |
| **Allocation / Clearance / At-Berth** | **SI Detail** modal → **Detailed At-Berth Executions Log** | Sub-process documents per log row |

**Not in scope for preview (upload UI only, or generated exports)**

- Loading **C1/C2** step cards (filename list only, no open link).
- Clearance **depart** modal before submit (pending local files, names only).
- SI Approval **manual signing** upload (local state until persisted).
- **CSV / Excel** report downloads and **Print SI PDF** (browser print dialog) — not uploaded attachments.

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.30**, **§3.10**, **§3.10C**.

### 2.20 SI shipper per breakdown line

Shipper is no longer a single field under **Party & port** on a Shipping Instruction. Each **commodity / contract line** in the **Shipment breakdown** table may have its own shipper from the **Master – Shipper** list.

| Area | Behaviour |
|------|------------|
| **Create / edit (plan-linked)** | On **`/shipment-plans`** (create or edit plan modal), open a child **Shipping instruction** section. The breakdown table columns are, in order: **Shipper**, Commodity, Metric, Qty, Contract, PO, SO, Remarks. Shipper is **optional** per row (same as the former header dropdown). |
| **Party & port** | **Loading port**, **Surveyor** (per SI), **Term** (Unloading), and **Agent** (from plan) remain here. **Shipper is not shown** in this block. |
| **Multiple shippers on one SI** | When breakdown lines use different shippers, read-only views show a **comma-separated** list of distinct shipper names at SI level; the breakdown table shows **per-line** shipper. |
| **Allocation & Berthing queue** | The **Shipper** column on incoming / berthed rows shows the same aggregated label (distinct names from that SI’s breakdown lines). |
| **SI document view (Loading)** | Printed / preview document still uses the **company legal entity** as shipper on the header block (unchanged product rule); the breakdown section reflects line-level shippers where applicable. |
| **Unloading document view** | Breakdown table includes a **Shipper** column per line. |
| **OCR autofill** | When a source document is parsed, extracted shipper is applied to the **first breakdown row** that has no shipper yet. |
| **Existing data after upgrade** | Migration **079** copies each SI’s former header shipper onto **every** active breakdown line so behaviour matches the old single-dropdown default until users edit lines individually. |
| **Master delete guard** | A shipper master row cannot be deleted while any breakdown line still references it. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.31**, migration **`079_si_breakdown_shipper_id.sql`**. Deploy: run migration **079** before or with an API build that expects line-level shipper (see TECH-SPEC deploy note).

### 2.21 Commodity Qty column (overview tables)

Cargo declared on each **Shipping Instruction** is visible in the main queue tables without opening the SI document or detail modal. One column — **Commodity Qty** — replaces a separate **Commodity** and **Total Qty** pair because each displayed value already includes the commodity name (for example `REFINED POME OIL 5.000 MT` or, when several commodities exist on one SI, one line per commodity).

| Area | Behaviour |
|------|------------|
| **Column order** | **Jetty Operation ID** (when applicable) → **Shipping Instruction** → **Commodity Qty** → remaining columns (Purpose, Status, etc.). |
| **Data source** | Active **`shipping_instruction_breakdown`** lines on the SI tied to the row (`commodity`, `qty`, unit from **`metric`**). This is **SI-declared** cargo, not operational loaded quantity from at-berth increment lines. |
| **Single SI, one commodity** | One line, e.g. `RPO 5.000 MT`. |
| **Single SI, multiple commodities** | Multiple lines in the **same cell**, one per commodity group, e.g. `RPO 3.000 MT` on the first line and `CPO 2.000 MT` on the second (line breaks, not a middle dot). |
| **Same commodity, multiple breakdown lines** | Quantities for the same commodity and unit are **summed** (e.g. two lines of RPO → one `RPO 5.000 MT` line). |
| **Mixed units on one commodity** | Separate subtotals per unit within that commodity (rare). |
| **No breakdown** | **`—`**. |
| **Allocation & Berthing** (`/allocation-plans`) | Flat queue and **plan-centric** grouped table: **Commodity Qty** after **Shipping Instruction**. When one shipment plan row lists **multiple SIs** (stacked SI links), **Commodity Qty** is **stacked** in the same order — one block per SI. |
| **At-Berth Executions** (`/at-berth`) | Same column after **SI**. **Multi-SI plan group** header: one combined **Commodity Qty** (single distinct value) or localized **Mixed** when child operations differ. Child rows show each operation’s qty string. Mobile cards show **Commodity Qty** only (not a separate commodity field). |
| **Clearance** (`/verification`) | **SI** column shows **reference number only** (commodity is no longer appended after a middle dot). **Commodity Qty** is its own column. **Ready to Sail** / **Sailed** rows collapsed per shipment plan: qty strings from sibling operations are joined with **line breaks** when they differ. |
| **Shipment Plans** (`/shipment-plans`) | Main list table adds **Commodity Qty** after **Shipping instructions** (stacked SI reference links). Each child SI shows its own qty block, aligned vertically with its SI link. Column is **sortable** and **filterable** like other list columns. After **ETA**, **External reference** and **Requested by** show plan-level source tracing (**§2.23**). |
| **Interaction** | **Commodity Qty** is **read-only** in these tables. **Shipping Instruction** remains a hyperlink to the **SI document** modal where configured; **Jetty Operation ID** hyperlink behaviour is unchanged (**§2.9**, **§2.10**). |
| **Quantity format** | Numeric qty uses **Indonesian-style grouping** (e.g. `5.000`) with the **metric code** (e.g. `MT`, `KL`) from the breakdown line. |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.32** (`siBreakdownDisplay.js`, allocation/operations/shipment-plans APIs, `siCargoTableDisplay.jsx`).

### 2.22 Jetty – Vessel Report (Reporting)

Port-scoped report for **which vessel is on which jetty** and **jetty utilization** over a selected date window. Data is built client-side from live APIs (not mock contexts): **`GET /operations`**, **`GET /allocation/overview`** (queue), **`GET /shipping-instructions/:id`** (per operation SI), and **`GET /jetties?port_id=…`**.

| Area | Behaviour |
|------|------------|
| **Where** | **Reporting** hub → **Jetty – Vessel Report** (`/reporting/vessel`). Requires an active port in the header. |
| **Filters** | **Start date** / **End date** (default **last 7 days** through today). Optional **Jetty** multi-select (all jetties when empty). **Generate Report** loads data; **Download Excel** is enabled after a successful run. |
| **Row inclusion** | **Operations** with a **jetty** assigned. **Incoming shipping instructions** on the allocation **queue** that have a jetty but **no operation yet** are included. A row appears when any key timestamp overlaps the filter window, or when a **berth interval** (TB → cast-off) overlaps the window. |
| **Report layout** | Three blocks: **Jetty utilization (summary)** table; **By jetty** collapsible vessel lists; **Detail** sortable/filterable table (jetty, SI/ref, vessel, purpose, ETA/TA/ETB/TB/sailed, cargo and party fields). |
| **Utilization summary — columns** | **Jetty**, **Calls**, **Berth hours**, **Utilization %**. The former **Hours in window** column is **not shown** in the UI or Excel export (the window length is still used internally for **Utilization %**). |
| **Column header tooltips** | **Calls**, **Berth hours**, and **Utilization %** each show an **ⓘ** icon beside the header label. Hover or keyboard focus opens a short definition (shared **`InteractiveTooltip`**). Intro copy under the summary title points users to these icons. |
| **Calls** | Count of report rows (operations + incoming SIs) assigned to that jetty in the filtered set. Tooltip: *The total number of vessel arrivals or port calls recorded during the specified period.* |
| **Berth hours** | Sum of **clipped alongside hours** per call on that jetty within the filter window. Interval start = **TB** (berthed date time); end = **cast-off** when set, otherwise **end of the report End date** (UTC day boundary) for vessels still alongside. Hours outside Start/End dates are clipped. Rows with **no TB** contribute **0** berth hours but may still increment **Calls**. Tooltip: *The total duration (in hours) that vessels occupied the berth, from first line to last line.* |
| **Utilization %** | **Berth hours ÷ (hours in report window × jetty capacity) × 100**, rounded to one decimal, **capped at 100%** for display. **Hours in report window** = inclusive calendar span from start of **Start date** through end of **End date** (UTC), same value for every jetty row. **Jetty capacity** comes from master **`jetties.capacity`** (default **1**). Berth hours from overlapping calls are **summed** (not merged), so utilization can reflect stacked time when multiple calls overlap. Tooltip: *The percentage of time the berth was actively utilized relative to the available window hours.* |
| **Excel export** | Two sheets: **summary** (same four columns as the UI table; date range in header; **no** separate “hours in window” metadata row) and **detail** (full vessel rows). File via **`jettyVesselReportExcel.js`**. |

Technical contract: **`Frontend/src/data/jettyVesselReportFromApi.js`** (`computeJettyUtilizationSummary`, `clippedBerthHours`, `detailRowOverlapsRange`), **`Frontend/src/pages/VesselReport.jsx`**, **`Frontend/src/data/jettyVesselReportExcel.js`**.

### 2.23 Inbound Shipping Instruction integration (partner API)

External business systems can submit **Shipping Instructions** into JPS without manual re-entry. Operators review API submissions through the **same Shipment plan approval workflow** used for in-app plans. Partner-facing API contract and test steps: **Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md**, **Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-API-TEST-GUIDE.md**.

| Area | Behaviour |
|------|------------|
| **Integrating systems** | One API key per source system (e.g. **EOS-EXPORT**, **EOS-IMPORT**, **KLIPS**). The key identifies **which system** submitted the request; it is not shown as a separate column in the plans list. |
| **Source document** | Partner payload field **`external_reference`** — the document/order id in the source system (e.g. `EOS-EXPORT-2026-091`). Stored on **`shipment_plans.external_reference`** and shown in the plans list **External reference** column. Used for idempotency: resubmitting the same reference returns **409** without creating a duplicate. |
| **Requestor** | **`requested_by`** in the partner payload (optional) — person or service account in the source system. If omitted, JPS stores the API key **partner name** as the requestor. For **manual** plan creation in the app, **`requested_by`** is set once at create time from the logged-in user’s **display name** (or **username** if no display name). Shown in the plans list **Requested by** column. |
| **Submission outcome** | A successful API call creates a real **Shipment plan** (`approval_status` **Submitted**) with one linked **Shipping Instruction** (`status` **Submitted**) and cargo breakdown lines. Operators see status **Pending** when partners poll the integration API (mapped from internal **Submitted** awaiting review). |
| **Operator review** | No new approval screen: operators use **`/shipment-plans`**, notifications (**Approval request: SP-…**), and **`/shipment-plans/approval/:id`** to **approve** or **reject** as today. Approved plans follow the normal allocation path; when a jetty slot is assigned, partner status becomes **Allocated**. |
| **Plans list columns** | On **`/shipment-plans`**, after **ETA**: **External reference** and **Requested by**. Both are **filterable** (substring match). Empty **`—`** for older manual plans created before this feature or plans without integration metadata. |
| **What partners see** | Partners call **`POST /api/v1/integrations/shipping-instructions`** to submit and **`GET …/shipping-instructions/{id}`** (or **`?external_reference=`**) to poll **Pending** / **Approved** / **Rejected** / **Allocated**. They cannot see other partners’ submissions. |
| **Cargo lines** | Partner **`cargo[].cargo_type`** must match **`si_commodities.short_name`** (case-insensitive). Full display names are not accepted. Validation errors include **`valid_cargo_types`** with active short codes. See commodity mapping table below and **INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md §5.1**. |
| **Security (summary)** | HTTPS + **`x-api-key`** header per partner; rate limit **120 requests/minute** per key. Keys are **not** port-scoped; each request must include a valid **`port_id`** (unknown port is rejected). |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §0.33**. Migrations **084** (`integration_api_keys`, `integration_submissions`), **085** (`shipment_plans.external_reference`, `shipment_plans.requested_by`), **086** (`si_commodities.short_name`).

**Commodity mapping for partner `cargo_type`** (send **short_name**; operators see **display name** in the app):

| JPS short_name (`cargo_type`) | JPS display name | Type |
|-------------------------------|------------------|------|
| `CG` | CRUDE GLYCERINE | Liquid |
| `CPKO` | CRUDE PALM KERNEL OIL | Liquid |
| `CPO` | CRUDE PALM OIL | Liquid |
| `FAME` | Fatty Acid Methyl Ester | Liquid |
| `INS POME FAD` | INS PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE | Liquid |
| `INS RPOME` | INS REFINED PALM OIL MILL EFFLUENT | Liquid |
| `ISCC POMEPFAD` | ISCC PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE (POMEPFAD) | Liquid |
| `ISCC RPOME` | ISCC REFINED PALM OIL MILL EFFLUENT | Liquid |
| `METHANOL` | METHANOL | Liquid |
| `PFAD` | Palm Fatty Acid Distillate | Liquid |
| `PKE` | Palm Kernel Expeller | Solid |
| `PKM` | Palm Kernel Meal | Solid |
| `PKS` | Palm Kernel Shell | Solid |
| `POME` | Palm Oil Mill Effluent | Liquid |
| `RBD PO` | RBD PO | Liquid |
| `RG` | REFINED GLYCERINE | Liquid |
| `ROL` | Refined Olein | Liquid |
| `RPOME` | REFINED PALM OIL MILL EFFLUENT | Liquid |
| `SPLIT CPKO FA` | SPLIT CRUDE PALM KERNEL OIL FATTY ACID | Liquid |
| `SPLIT RBD PKO FA` | SPLIT RBD PALM KERNEL OIL FATTY ACID | Liquid |

*20 commodities as of master data export. Partners should use **`valid_cargo_types`** from API errors or **§5.1** of the partner guide if the list changes.*

### 2.24 Master Jetty — purpose-specific commodity capability

Each master jetty can restrict which **commodities** it accepts, separately for **Unloading** and **Loading** operational purposes. This replaces the former single undifferentiated commodity list on **`jetty_commodities`**.

| Area | Behaviour |
|------|------------|
| **Where configured** | **Master – Preferred Jetty** (`/master/jetty`) add/edit modal. RBAC page key **`master-jetty`**. |
| **Modal — physical specs** | **Jetty Length (m)**, **Draft Jetty**, and **DWT Jetty** are **required** positive numbers on create and update. Used with vessel **LOA** and computed **DWT** on **Shipment Plans** jetty advice (**below**). |
| **Modal — Allowed for Unloading** | Checkbox multi-select with **search** over **Master – Commodity** options. **Optional** — an **empty** list means the jetty accepts **any** commodity for **Unloading** purposes. |
| **Modal — Allowed for Loading** | Same UX pattern as unloading, bound to the **Loading** purpose list independently (a commodity may appear in one list, both, or neither). **Empty** = accepts any commodity for **Loading**. |
| **List table** | Two read-only columns — **Unloading commodities** and **Loading commodities** — show comma-separated commodity names (or **`—`** when unset). Sort/filter applies to the displayed name string. |
| **API — read** | **`GET /jetties`** and **`GET /jetties/:id`** return **`unloadingCommodities`** and **`loadingCommodities`**: arrays of **`{ id, name }`**, sorted by name. Legacy single **`commodities`** field is **removed**. |
| **API — write** | **`POST /jetties`** and **`PUT /jetties/:id`** accept **`unloading_commodity_ids`** and **`loading_commodity_ids`** (numeric id arrays). Omitting a field on **PUT** leaves that purpose’s links unchanged; sending **`[]`** clears that purpose’s list. |
| **Lookups for planners** | **`GET /si-lookups`** → **`jetties[]`** exposes **`unloadingCommodityIds`** and **`loadingCommodityIds`** (flat id arrays) for client-side jetty suitability on **Shipment Plans**. |
| **Activity log** | Changes to either commodity list are recorded in **`activity_logs`** (`page_key` **`master-jetty`**) with purpose-specific entries, e.g. **`Allowed for Unloading — added`**, **`Allowed for Loading — removed`**, listing commodity **names** added or removed. Create logs initial non-empty selections. |
| **Data migration** | Migration **090** adds **`operational_purpose`** (`Loading` \| `Unloading`) to **`jetty_commodities`** and expands the primary key to **`(jetty_id, commodity_id, operational_purpose)`**. Existing rows were copied to **both** purposes so no capability was lost at rollout. Rollback: **`Backend/rollback/090_rollback_jetty_commodities_operational_purpose.sql`**. |

**Shipment Plans — jetty suggestions and validation** (`/shipment-plans` create/edit modal):

| Rule | Behaviour |
|------|------------|
| **When advice runs** | After the user enters vessel **LOA**, **GT + capacity** (for computed DWT), **ETA**, and **Purpose**, the client evaluates each port jetty. |
| **Physical fit** | Vessel **LOA ≤ jetty length** and computed **DWT ≤ jetty DWT** when those master values are set. |
| **Commodity fit (purpose-aware)** | Uses **`unloadingCommodityIds`** when plan purpose is **Unloading**, **`loadingCommodityIds`** when purpose is **Loading**. If purpose is not yet selected, **no** commodity restriction is applied for suggestions. Commodities on draft SI **breakdown** rows must be a subset of the jetty’s list for that purpose. **Empty** jetty list for that purpose = **no** commodity restriction. |
| **ETA occupancy** | Jetties with an overlapping plan/operation at the entered **ETA** are marked occupied in the dropdown. |
| **Dropdown UX** | Unsuitable jetties are hidden unless already selected; suitable jetties may show **✓**; occupied jetties show an occupied hint; unsuitable saved selections show **✗ not suitable**. A hint line lists **suggested** jetties when any pass all checks. |
| **Save guard** | Saving with a selected jetty that fails LOA, DWT, or purpose-specific commodity rules is **blocked** with a toast explaining the reason. |

Technical contract: migrations **088** (jetty length/draft/DWT), **089** (`jetty_commodities`), **090** (operational purpose); **`Backend/src/routes/jetties.js`**, **`Backend/src/routes/si-lookups.js`**; **`Frontend/src/pages/MasterJetty.jsx`**, **`Frontend/src/api/jetties.js`**, **`Frontend/src/pages/ShipmentPlansList.jsx`**.

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
| Operations completed | `operationsCompletedDateTime` (set at sign-off) |
| Actual completion | `actualCompletionDateTime` (set at depart) |
| Cast-off (optional end proxy) | `castOffDateTime` |

**Display-only constants**

- **Default tail:** **+3 calendar days** from a reference start when an end is unknown (**planned · alongside** and **Actual · transit** only). **Actual · alongside** for **in-progress** berths does **not** use this tail (see **§5.2**).
- **“Known” vs “open end”** is expressed visually: **solid** bar vs **gradient** (faded tail).
- **Live “now” for open Actual alongside:** segment geometry uses **`Date.now()`** (refreshed ~every **30s** on the Gantt) when computing **`max(estimate, now)`** for vessels still at berth.

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
- **Actual completion** = `actualCompletionDateTime` parsed as time (`actComp`).
- **Cast-off** = `castOffDateTime` — ends alongside display only when **`status === 'SAILED'`** (**§5.2**); on non-**`SAILED`** rows it is cleared (migration **083**). Not used as a +3-day fallback for in-progress berths.

Invalid dates (e.g. end **not after** start) fall back to **+3 days** from the relevant start with an **open end** / indicative behaviour so bars never go “backwards” (**planned · alongside** and **Actual · transit**). **Actual · alongside** for in-progress berths uses **§5.2** instead of the +3-day fallback.

### 5.1 Planned · alongside (from planned ETB)

| Condition | Planned end | Style |
|-----------|-------------|--------|
| `estComp` set and **after** planned start | `estComp` | Known (solid) |
| Otherwise | planned start **+ 3 days** | Open end (gradient) |

Planned end **does not** depend on whether actual completion is filled; it reflects **plan** vs **planned-start + default** when estimate is missing or invalid.

### 5.2 Actual · alongside (only if **TB** is set)

**Sailed / completed** — treat as **Sailed off** when **`status === 'SAILED'`** only (same rule as **§2.1** status colour and schematic **`isSailedRow`**). **`operationsCompletedDateTime`** (sign-off) does **not** mark sailed off and does **not** end the alongside interval while the vessel awaits depart. **`castOffDateTime`** on non-**`SAILED`** rows is invalid legacy data (cleared by migration **083**).

| State | Alongside end | Style |
|-------|----------------|--------|
| **Sailed** (`status === 'SAILED'`) | **`actualCompletionDateTime`**, else **`castOffDateTime`**, when that instant is **after TB** | **Known** (solid); **Sailed off** muted styling |
| **Sailed** (invalid end ≤ TB) | Minimal open segment anchored at **TB** / **now** (display fallback) | Open end (gradient) |
| **Still at berth** (not **`SAILED`**, including **SIGNOFF_APPROVED**) | **`max(estimatedCompletionDateTime, now)`**; if estimate is **null**, **`now`** | **Open end** (gradient) — provisional until depart sets **actual completion** |

**`now`** for Gantt segment building is the live clock at render time (~**30s** refresh). Shared logic lives in **`Frontend/src/utils/jettyScheduleOccupancy.js`** (`resolveActualAlongsideEnd`).

**Previous behaviour (superseded):** in-progress Actual alongside used a **+3-day** tail when estimate was missing or past; that caused bars to **end prematurely** while the vessel was still alongside. That tail is **removed** for **still-at-berth** Actual · alongside.

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

## 6. API & database (estimated completion, operations completed, actual completion, last updated)

| Item | Detail |
|------|--------|
| **Endpoint** | `PUT /api/v1/allocation/arrival` (relative to API base; client wraps as `PUT /allocation/arrival`). |
| **Purpose** | Persist “Log arrival update” style **vessel-call** fields on **`shipment_plans`** (jetty, ETA/TA/ETB/NOR/POB/TB/SOB, estimated completion, remark, priority, `no_pkk`, etc.). Child **`operations`** rows are updated where the backend still mirrors fields for legacy consumers. |
| **Authorisation** | Caller must have **page** permission **`allocation-plan`** with **can_edit**; otherwise the API returns **403**. |
| **Request body (relevant)** | Includes `estimatedCompletionDateTime`. **`actualCompletionDateTime`** is accepted only when the targeted operation is already **`SAILED`**; otherwise the API **ignores** client edits and keeps the stored value (depart is the write path for actual completion). |
| **Table** | Primary write target: **`shipment_plans`**; **`operations`** may receive mirrored timestamps for the targeted operation / siblings per backend rules. |
| **Columns** | Plan: `estimated_completion_time`, `operations_completed_at`, `actual_completion_time`, and other vessel-level timestamps (`TIMESTAMPTZ`); `updated_at` / **`updated_by`** on the plan when present. Migration **082** adds **`operations_completed_at`** on **`operations`** and **`shipment_plans`** with backfill from mistaken sign-off **`actual_completion_time`** values. |
| **Operations completed** | Set on **`POST .../signoff`** approval (`operations_completed_at`); exposed as **`operationsCompletedDateTime`** on overview queue rows. Does **not** end berth occupancy. |
| **Actual completion** | Set on **`POST .../depart`** / **`POST /shipment-plans/:id/depart`** as **`actual_completion_time = cast_off_at`** and **`status = SAILED`**. |
| **Depart cast-off validation** | **`POST /operations/:id/depart`** and **`POST /shipment-plans/:id/depart`** reject **`cast_off_at`** that is **in the future** (beyond **15 minutes** after server **now**, clock-skew tolerance) or **before** resolved **TB** (`validateCastOffAt`, **`Backend/src/lib/validate-cast-off.js`**). The Clearance depart form applies the same future/TB rules plus **on or after latest Detailed At-Berth Executions Log** timestamp (`validateCastOffDepart`, **`Frontend/src/utils/validateCastOffDepart.js`**). |
| **Cast-off hygiene** | Migration **083** clears **`cast_off_at`** on **`SIGNOFF_REQUESTED`** / **`SIGNOFF_APPROVED`** rows (and matching plan rows) that are not yet **`SAILED`**, so schematic/Gantt do not treat sign-off vessels as departed. |
| **Overview fields** | `GET /allocation/overview` queue rows include **`shipmentPlanId`**, **`operationsCompletedDateTime`**, **`actualCompletionDateTime`**, **`castOffDateTime`**, **`recordLastUpdatedAt`** and **`recordLastUpdatedByDisplayName`** derived from **`GREATEST(shipment_plans.updated_at, operations.updated_at)`** (and SI `updated_at` for incoming rows without an operation). Operation-backed rows also include **`jettyOperationCode`** when migration **056** is applied (**§2.10**). |
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
| Shared schedule occupancy / Actual alongside end math | `Frontend/src/utils/jettyScheduleOccupancy.js` — used by Gantt (**§5.2**) and Jetty Schematic (**§17.8**); unit tests **`Frontend/src/utils/jettyScheduleOccupancy.test.js`** (`npm test`) |
| ETC breach eligibility (excludes sign-off / ops-completed) | `Frontend/src/utils/etcBreach.js` |
| Operations completed vs actual completion (DB + sign-off / depart) | Migrations **`082_operations_completed_at.sql`**, **`083_clear_orphan_cast_off_before_sail.sql`**; `Backend/src/routes/operations.js` (sign-off, depart); `Backend/src/lib/shipment-plan-depart.js` |
| Jetty Schematic (layout, **View as of**, date-filtered occupancy, lane content / purpose–RAG styling) | `Frontend/src/components/JettySchematic.jsx`, `Frontend/src/styles/jetty-schematic.css`, `Frontend/src/components/PurposeBadge.jsx`, `Frontend/src/components/EtcBreachBadge.jsx`; schematic **`materialDisplay`** / **`ragStatus`** on `Frontend/src/pages/Allocation.jsx` (`schematicMaterialDisplay`, `getEtcBreachRagStatus`) |
| Gantt bar colours (planned orange / actual purple) | `Frontend/src/styles/design-tokens.css` (`--gantt-planned-*`, `--gantt-actual-*`), `Frontend/src/styles/allocation.css`, `Frontend/src/styles/etc-breach.css` |
| Allocation page, modals, berthing confirm, **re-dock** modal | `Frontend/src/pages/Allocation.jsx` |
| Allocation pipeline phase + alongside duration labels (**SAILED**) | `Frontend/src/utils/allocationVesselPhase.js` — **`deriveCurrentPhaseIndex`**, **`currentPhaseLabelForVessel`**, **`getVesselAlongsideEndMs`**, **`getPlanAlongsideEndMs`**; unit tests **`Frontend/src/utils/allocationVesselPhase.test.js`** |
| At-Berth list, **shift-out** modal | `Frontend/src/pages/AtBerthExecutions.jsx` |
| Shift-out / re-dock API | `Frontend/src/api/operations.js` → `POST /operations/:id/shifting-out` |
| Allocation API client | `Frontend/src/api/allocation.js` |
| Arrival route | `Backend/src/routes/allocation.js` |
| Jetty Operation Id (DB + assign helper) | `Backend/migrations/056_jetty_operation_code.sql`, `Backend/src/lib/jetty-operation-code.js`, `Backend/src/routes/operations.js` (`POST /operations`), `Backend/src/routes/allocation.js` (new operation on arrival) |
| Jetty blocking queries (master status / allocation guard) | `Backend/src/lib/jetty-blocking.js` |
| Client jetty OOS messages | `Frontend/src/utils/jettyAvailability.js` |
| Master jetty status UI | `Frontend/src/pages/MasterJetty.jsx`, `Frontend/src/api/jetties.js` → `PUT /jetties/:id/status` |
| **Master Jetty — purpose-specific commodity capability** | **§2.24** — migrations **089**, **090**; `Backend/src/routes/jetties.js`, `Backend/src/routes/si-lookups.js`; `Frontend/src/pages/MasterJetty.jsx`, `Frontend/src/api/jetties.js`; Shipment Plans jetty advice **`Frontend/src/pages/ShipmentPlansList.jsx`** |
| Jetty Live CCTV (master RTSP, schematic camera, viewer) | `Backend/migrations/077_jetties_rtsp_link.sql`, `078_retire_jetty_live_page_permission.sql`, `Backend/src/routes/jetties.js`; `Frontend/src/pages/MasterJetty.jsx`, `Frontend/src/components/JettySchematic.jsx`, `Frontend/src/pages/JettyLive.jsx`, `Frontend/src/pages/AdminRoles.jsx`; `rtsp-stream-viewer/`; deploy **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md** |
| Master Menu list sort/filter | `Frontend/src/utils/sortableFilterableTable.js`, `Frontend/src/hooks/useSortableFilterableRows.js`, `Frontend/src/components/SortableFilterableTableHead.jsx`; `Frontend/src/pages/MasterPort.jsx`, `MasterJetty.jsx`, `MasterSiLookup.jsx`, `MasterFreightTerms.jsx`, hub `Frontend/src/pages/Master.jsx` |
| Self-service change password (header menu + modal) | `Backend/src/routes/users.js` — **`PUT /users/me/password`**; `Frontend/src/components/UserMenu.jsx`, `ChangePasswordModal.jsx`, `PasswordField.jsx`; `Frontend/src/api/usersApi.js` — **`changeMyPasswordApi`**; `Frontend/src/styles/user-menu.css`, `Frontend/src/styles/modal.css`; i18n **`common.json`** (`changePassword.*`); wired in **`Layout.jsx`** |
| Dashboard slot KPI, Port activity chart, weather footer | `Frontend/src/pages/Dashboard.jsx`, `Frontend/src/components/DashboardActivityChart.jsx`, `Frontend/src/utils/dashboardQueueClassification.js` |
| **Dashboard V2 — Purpose / Commodity filters, weekly trends refetch** | `Frontend/src/pages/DashboardV2.jsx`, `Frontend/src/utils/dashboardFilters.js`, `Frontend/src/components/DropdownMultiSelect.jsx`, `Frontend/src/components/DashboardV2WeeklyTrends.jsx`, `Frontend/src/api/dashboardV2.js`; styles **`Frontend/src/styles/dashboard.css`** (`.v2-filters`); backend **`Backend/src/routes/dashboard-v2-weekly.js`**, **`Backend/src/routes/shipment-plans.js`** (SI **`breakdown`** on list). See **§2.18**, TECH-SPEC **§0.29**. |
| Shift-out route | `Backend/src/routes/operations.js` |
| Demurrage Risk Calculator UI | `Frontend/src/pages/DemurrageRiskCalculator.jsx`, `Frontend/src/styles/demurrage-risk-calculator.css` |
| Shipment plan depart API + shared transaction | `Backend/src/routes/shipment-plans.js`, `Backend/src/lib/shipment-plan-depart.js`; mount in `Backend/src/index.js` — **`POST /shipment-plans/:id/depart`** |
| Plan timeline merge on `GET /operations/:id` (and list joins) | `Backend/src/routes/operations.js` — **`loadOperationJoined`**, **`toOp`**, **`PLAN_TIMELINE_SELECT`** |
| Clearance plan depart + multi-timeline validation | `Frontend/src/pages/Verification.jsx`, `Frontend/src/api/shipmentPlans.js` |
| Clearance depart cast-off validation (client) | `Frontend/src/utils/validateCastOffDepart.js`; unit tests **`Frontend/src/utils/validateCastOffDepart.test.js`** |
| Depart cast-off validation (API) | `Backend/src/lib/validate-cast-off.js`; **`POST /operations/:id/depart`**, **`POST /shipment-plans/:id/depart`**; unit tests **`Backend/src/lib/validate-cast-off.test.js`** |
| Dashboard queue dedupe by plan | `Frontend/src/pages/Dashboard.jsx`, `Frontend/src/utils/dashboardQueueClassification.js` — **`allocationQueueVesselCallKey`** |
| SI candidates + port/sailed rules | `Backend/src/routes/shipping-instructions.js` — `GET /shipping-instructions/candidates` |
| Shared SI detail modal (hyperlink trigger target) | `Frontend/src/components/SiDetailModal.jsx`, `Frontend/src/styles/si-detail-modal.css`; nested **Detailed At-Berth Executions Log** via `OperationActivityTimeline.jsx` |
| **Uploaded document preview & download** | **§2.19** — `Frontend/src/context/FilePreviewContext.jsx`, `Frontend/src/components/FilePreviewModal.jsx`, `FilePreviewLink.jsx`, `AuthenticatedFileImage.jsx`, `Frontend/src/utils/filePreview.js`, `Frontend/src/styles/file-preview.css`, i18n **`filePreview.json`**; backend **`GET .../view`** on operation, sub-process, and SI document routes — TECH-SPEC **§0.30**, **§3.10**, **§3.10C** |
| **SI shipper per breakdown line** | **§2.20** — `Backend/migrations/079_si_breakdown_shipper_id.sql`, `Backend/src/routes/shipping-instructions.js`, `allocation.js`, `shipment-plans.js`, `si-lookups.js`; `Frontend/src/components/ShippingInstructionSiLinkedFields.jsx`, `Frontend/src/utils/siPlanLinkedDraft.js`, `Frontend/src/api/shippingInstructions.js`, `siViewModel.js`, `SiDetailModal.jsx`, `SiDocumentView.jsx`, `SIApproval.jsx`, `siExtractMerge.js`; TECH-SPEC **§0.31** |
| **Commodity Qty overview columns** | **§2.21** — `Backend/src/lib/siBreakdownDisplay.js`, `Backend/src/routes/allocation.js`, `operations.js`, `shipment-plans.js`; `Frontend/src/utils/siCargoTableDisplay.jsx`, `allocationPlanPovMerge.js`, `Allocation.jsx`, `AtBerthExecutions.jsx`, `Verification.jsx`, `ShipmentPlansList.jsx`, `allocation.css`; i18n **`colCommodityQty`** / **`clearanceColCommodityQty`**. TECH-SPEC **§0.32** |
| **Jetty – Vessel Report** | **§2.22** — `Frontend/src/pages/VesselReport.jsx`, `Frontend/src/data/jettyVesselReportFromApi.js`, `Frontend/src/data/jettyVesselReportExcel.js`; APIs **`operations`**, **`allocation/overview`**, **`shipping-instructions/:id`**, **`jetties`**; summary header tooltips via **`InteractiveTooltip`**; styles **`allocation-table__th-label`**, **`allocation-table__th-info`** in **`allocation.css`** |
| **Inbound Shipping Instruction integration (partner API)** | **§2.23** — `Backend/src/routes/integrations.js`, `Backend/src/middleware/integration-auth.js`, `Backend/src/lib/resolve-requested-by.js`, migrations **084** / **085**; key provisioning **`Backend/scripts/create-integration-api-key.mjs`**; plans list columns **`Frontend/src/pages/ShipmentPlansList.jsx`**; partner docs **`Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md`**, **`Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-API-TEST-GUIDE.md`**. TECH-SPEC **§0.33** |
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
| **Detailed executions log** | In the Loading/Unloading operation workspace, the **Detailed At-Berth Executions Log** lists operational milestones, operational activities, and Pre-/Post-Checking sub-process rows. The table shows **Phase**, **Title**, **Status**, **Remark**, **Documents** (clickable file names for attachments on that sub-process step; operational rows show **—** when there are no attachments), **Start time**, **End time**, **Duration**, and **Actions**. **Status** is the sub-process status for Pre/Post rows; for **Operational** activity rows it is derived from timestamps (**Done** when an end time exists, **In Progress** when only a start exists). **Remark** holds free text (and sub-process **skip** reason on a second line when present). **Start time**, **End time**, and **Duration** use the same formatting rules for **operational activities** and **sub-process** rows when the backend supplies a closed interval (`start_at` / `end_at` on sub-processes, or activity start/end). If only a single instant is recorded (no end), **End** and **Duration** show **—**. Document names open the **shared preview modal** (**§2.19**); users may **Download** or **Open in new tab** from the modal. |

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
| **3. Approve (sign off)** | Users with **Approve operation sign-off** on **Loading / Unloading** (configured in **Admin → Roles**, same pattern as **Approve internal SI**) | Approval is performed from **Clearance** (not from the Loading/Unloading hub). On approval, the operation becomes **SIGNOFF_APPROVED**, **`operations_completed_at`** is stamped (**`operationsCompletedDateTime`** in API), and the row appears on **Clearance** under **Ready to Sail** (signed off, awaiting depart). The vessel **stays alongside** in schematic and slot occupancy until **Record depart**. |
| **4. Clearance** | Clearance users | **Clearance** (`/verification`) lists **Ready to Sail** (**SIGNOFF_APPROVED**) and **Sailed**. Rows that share a **`shipmentPlanId`** are **collapsed to one logical row** per plan for those two statuses (SI column lists multiple references when needed). A **Pending sign-off** filter still shows **one row per operation** awaiting step 3. Approvers can **Open operation** (deep link to the hub) or **Sign off** from the table. The main operations table includes **Jetty Operation ID** immediately **before** **SI**, then **Commodity Qty** (**§2.10**, **§2.21**). |
| **5. Depart** | Clearance users | **Record depart** after **every child operation on the plan** is **SIGNOFF_APPROVED** (server-enforced). **CAST Off** is required. Validation (client on submit; server on **`POST .../depart`**): **(a)** not in the **future** (allowed up to **15 minutes** after server **now** for clock skew); **(b)** **on or after** actual time of berthing (**TB**); **(c)** **on or after** the **latest** timestamp across the **combined** **Detailed At-Berth Executions Log** timelines of **all** operations on that plan (client only — helper text shows the minimum as **`DD/MMM/YYYY HH:mm`**). Depart sets **`actual_completion_time = cast_off_at`**, **`cast_off_at`**, and **`status = SAILED`**. When **`shipmentPlanId`** is present, the client calls **`POST /shipment-plans/:id/depart`**; otherwise **`POST /operations/:id/depart`**. **Ready to Sail** uses a **`datetime-local`** input for **CAST Off** entry. |
| **6. Sailed (read-only)** | Clearance users | **Sailed** filter rows open a **read-only** modal (**Sailed** in title). Copy states the operation has already sailed; **CAST Off**, documents, and **Record depart** are not editable. **CAST Off** is shown with **`formatDateTimeDisplay`** (**`DD/MMM/YYYY HH:mm`**, **§10**) — not browser-native **`datetime-local`** display. **Recorded departure** lists **Sailed at** (same formatter) and links to clearance document / vessel photo when present. |

**Product rules**

- **Request** and **approve** are separate permissions; operators can request without being able to approve.
- **Duplicate request** while one is already pending is blocked by the API.
- **Operations completed vs actual completion:** Sign-off stamps **`operations_completed_at`** only; the vessel **remains alongside** in schematic, slot occupancy, and Gantt until **Record depart** sets **`actual_completion_time`** / **`cast_off_at`** and **`SAILED`**. Users cannot edit either timestamp from **Active Vessel Detail**; actual completion is depart-only.
- **Status vs timestamps:** **`operations.status = SAILED`** is the authoritative post-depart state for **Clearance** and the Allocation **Current Phase** pipeline (**§2.4**). A **`cast_off_at`** value alone (including invalid future dates on non-**SAILED** rows) must **not** drive the Allocation pipeline to **At-Berth** while Clearance correctly shows **Sailed** — pipeline phase derives from **`status`**, not orphan cast-off timestamps.
- **Audit:** Activity log records request and sign-off (see **TECH-SPEC** for `pageKey` and fields).

Technical contract: **TECH-SPEC-Jetty-Planning-System.md §3.3** (routes, RBAC, `operations.signoff_*` columns). Detailed UX wireframes: **Docs/Plan/OPERATION-SIGNOFF-REQUEST-AND-APPROVAL-PLAN.md** §10.

## 10. Date and time display (user-facing)

| Rule | Behaviour |
|------|-----------|
| **No “LT” suffix** | Display strings do **not** append the literal **“ LT”** (previously suggested “local time” but was ambiguous). API-built ETA/ETB display strings also omit **LT**. |
| **Common format** | Where the app uses the shared **`formatDateTimeDisplay`** / **`formatDateDisplay`** helpers, users see **`DD/MMM/YYYY HH:mm`** (datetimes) or **`DD/MMM/YYYY`** (date-only) in **24-hour** time, based on the **browser’s local timezone** for parsed instants. Month abbreviations follow **`jps_locale`** (`en` → `en-GB`, `id` → `id-ID`). |
| **Legacy strings** | If old cached text still ends with **` LT`**, the helper **strips** that suffix when the value cannot be parsed as a date. |
| **Exceptions** | Operational UI tables, modals, tooltips, Gantt labels, activity log, reports, and Excel exports use the shared helpers. **Intentionally different:** printed SI sign-off dates (**`25 MARCH 2026`**), formal ETA ranges (**`1 - 5 MAR 2026`**), **`datetime-local`** / **`type="date"`** input values (ISO **`YYYY-MM-DDTHH:mm`** / **`YYYY-MM-DD`**) — including **Ready to Sail** **CAST Off** entry — relative times (e.g. notification bell **“2 hours ago”**), and duration labels (**`+45m`**, **`Xd Xh Xm`**). **Clearance — Sailed** read-only modal: **CAST Off** uses **`formatDateTimeDisplay`** (**`DD/MMM/YYYY HH:mm`**) even though the control looks like a text field in the modal layout. New user-facing date/time display should use **`formatDateTimeDisplay`** or **`formatDateDisplay`** (see TECH-SPEC). |

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
| 1.61 | 2026-07-09 | **§2.24 Master Jetty — purpose-specific commodity capability:** **Allowed for Unloading** and **Allowed for Loading** multi-selects on Master – Preferred Jetty; list columns **Unloading commodities** / **Loading commodities**; API **`unloadingCommodityIds`** / **`loadingCommodityIds`** (write: **`unloading_commodity_ids`** / **`loading_commodity_ids`**); activity log diffs per purpose; **Shipment Plans** jetty advice uses purpose-matched commodity list. Migration **090** (`jetty_commodities.operational_purpose`; existing rows copied to both purposes). **§1**, **§2.7**, **§2.17**, **§7** map updated. |
| 1.60 | 2026-06-22 | **Allocation pipeline (SAILED):** **Current: Sailed** when **`status === SAILED`**; **Time since berthing** / **Est. time remaining** use cast-off end and **Sailed** label (**§2.4**, **`allocationVesselPhase.js`**). **Clearance depart validation:** future **CAST Off** (15 min tolerance), before **TB**, before latest execution log (client); API rejects future and before **TB** on **`POST .../depart`** (**§6**, **§9.2**). **Status vs timestamps** product rule — pipeline follows **`status`**, not orphan **`cast_off_at`**. **Clearance — Sailed** modal: read-only **CAST Off** uses **`formatDateTimeDisplay`** (**§10**). **§7** map. |
| 1.59 | 2026-06-15 | **§2.23** partner API keys are no longer port-scoped (removed `FORBIDDEN_PORT`); each request must pass a valid **`port_id`**. Partner API guide v3.3; TECH-SPEC **§0.33** updated. |
| 1.58 | 2026-06-12 | **§2.23** commodity mapping table for partner **`cargo_type`** (short_name → display name → Solid/Liquid). Partner API guide **§5.1** / **§5.3**; test guide **§2.4**. |
| 1.57 | 2026-06-12 | **§2.23** partner **`cargo_type`** uses commodity **short name** (`si_commodities.short_name`), not full display name. Partner API guide v3.1. TECH-SPEC **§0.33** updated; migration **086**. |
| 1.56 | 2026-06-12 | **§2.23 Inbound Shipping Instruction integration (partner API):** external systems submit plans via **`x-api-key`**; operators use existing approval flow; plans list **External reference** and **Requested by** after **ETA**; manual creates capture requestor from logged-in user. **§1**, **§2.13**, **§2.21**, **§7** map. TECH-SPEC **§0.33**. Migrations **084**, **085**. Partner guides **`INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md`**, **`INBOUND-SHIPPING-INSTRUCTION-API-TEST-GUIDE.md`**. |
| 1.55 | 2026-06-05 | **Operations completed vs actual completion:** migration **082** (`operations_completed_at` on operations + shipment plans; backfill); migration **083** (clear orphan **`cast_off_at`** on sign-off rows). Sign-off stamps **`operations_completed_at`**; depart sets **`actual_completion_time = cast_off_at`** and **`SAILED`**. **§2.1** sailed = **`SAILED`** only; ETC breach excludes sign-off. **§2.4** modal: **Operations completed** / **Actual completion** read-only. **§2.7** schematic today aligns with slot occupancy. **§5.2**, **§6**, **§9.2** updated. **§17.8** schematic occupancy: **today** = point-in-time with **inclusive** interval end; **past** = full calendar-day overlap; sailed-after-cast-off shows under **Incoming**. **`jettyScheduleOccupancy.test.js`**, **`etcBreach.js`**. **§7** map. |
| 1.54 | 2026-06-05 | **§2.13–2.14 Adding SIs after approval / during operations:** document UI limitation (Add SI only on Draft/Rejected plans), API reopen + **`planReopened`** behaviour, berthing gate until re-approval, in-flight operations preserved, and deep-link edge case. **§1** version bump. |
| 1.53 | 2026-05-29 | **§2.22 Jetty – Vessel Report:** utilization summary table columns **Jetty**, **Calls**, **Berth hours**, **Utilization %**; **Hours in window** removed from UI and Excel (still used internally for **Utilization %**); **ⓘ** header tooltips on the three metric columns; live API data sources and berth-hour / utilization formulas documented. **§1**, **§7** map. |
| 1.52 | 2026-05-29 | **Jetty schedule Gantt:** **Planned** bars **orange**, **Actual** bars **purple** (distinct from Loading/Unloading purpose colours); **Late (past ETC)** overdue gradient from purple to red. Compact **From / To** date inputs (**§2.1**). **Jetty Schematic:** occupied-lane layout (vessel name → purpose line → plan ref / SI → material); bank suffix chip; **icon-only** ETC breach (today only); **on-track** left accent follows **purpose** (blue unloading / green loading); zone height **220px** and lane clipping fixes (**§17.7–17.8**). **`materialDisplay`** on schematic map. **§7** map. |
| 1.51 | 2026-05-28 | **Jetty schedule — Actual · alongside (in progress):** end is **`max(estimatedCompletionDateTime, now)`** (or **`now`** if estimate missing); removed **+3-day** tail for still-at-berth Actual bars; ~**30s** refresh with **Now** line. **§2.1**, **§3**, **§5.2**, **§7** (`jettyScheduleOccupancy.js`). **Gantt:** ETC overdue styling / purpose badge on bars (**§2.1**). **Jetty Schematic — View as of (**§17.8**): date picker (default today, **future dates disabled**); occupancy + **Incoming** from **`scheduleQueue`** using **§5.2** overlap; **ETC breach** styling **today only**; **§2.14**, **§17.5–17.7** updated (no longer live-`berths.occupants`-only). |
| 1.50 | 2026-05-26 | **§2.21 Commodity Qty column:** single **Commodity Qty** column after **Shipping Instruction** on Allocation & Berthing (`/allocation-plans`), At-Berth, Clearance, and Shipment Plans list; per-commodity lines with line breaks inside the cell; stacked blocks for multi-SI plan rows; Clearance SI column reference-only. **§1**, **§2.7**, **§2.10**, **§9.2**, **§7** map. TECH-SPEC **§0.32**; updates **§0.29** list breakdown fields (`qty`, `metric_code`). |
| 1.49 | 2026-05-25 | **§2.20 SI shipper per breakdown line:** shipper moved from SI header / Party & port to **first column** of Shipment breakdown table on plan-linked SI forms; optional per line; multi-shipper aggregation in Allocation queue, SI Detail modal, and list **`shipperNames`**. OCR autofill targets first empty breakdown row. Migration **079** backfills header shipper to all lines. **§1**, **§2.9**, **§2.13**, **§16**, **§7** map. TECH-SPEC **§0.31**, **§3.2**, **§3.5.1**, **§4**. |
| 1.49 | 2026-06-17 | **§2.15 Jetty Live — on-demand stream:** FFmpeg starts when the first **`/jetty-live`** WebSocket viewer connects and stops **30 s** after the last disconnect; default **1 fps** output (was 24/7 @ 25 fps). Reduces app-server CPU when CCTV is unused. TECH-SPEC **§0.26**, **§3.5.5**. Deploy **Docs/Guide/JETTY-LIVE-STREAM-DEPLOYMENT.md**. |
| 1.48 | 2026-05-25 | **§2.19 Uploaded document preview & download:** shared in-app preview modal for images and PDFs (click file name or berthing photo thumbnail); footer **Download** and **Open in new tab**; authenticated fetch for multi-port users. Covers Allocation (NOR, berthing photos), Loading/Unloading (Pre/Post documents, executions log), Clearance (sailed docs), Shipment Plans (SI source docs), SI Approval attachments, and nested log in **SI Detail** modal. **§9** executions log updated. **§7** map. TECH-SPEC **§0.30**, **§3.10**, **§3.10C**. |
| 1.47 | 2026-05-22 | **§2.18 Dashboard V2 — Purpose and Commodity Type filters:** multi-select filter bar (Purpose, Commodity from Master Commodity, date range); OR/AND logic; instant apply; filtered pipeline, KPIs, at-berth, weekly trends; jetty status unfiltered; empty-state banner. **§1**, **§7** map. TECH-SPEC **§0.29**, **§2.3**, **§3.7**. |
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
| **Loading vs Unloading field sets** | **Loading** shows Route/Freight + B/L fields; **Unloading** hides those and instead shows **Term** (trade term) under Party & Port. **Agent** is available under **Party & Port** for both Loading and Unloading forms. **Shipper** is **not** under Party & Port — it is selected **per breakdown row** (**§2.20**). Both use the same submit/approval pipeline. |
| **B/L split text** | Create/edit modal provides an editable **B/L Split** textarea (not auto-generated), persisted on the SI record and shown on the document view. |
| **NPWP (read-only)** | NPWP is **not** a free-text SI field. The UI shows NPWP as **read-only** from a **per-port master** (based on the active selected port). |
| **Submit for approval** | **Request approval** calls the API to set status **Submitted** (not only local UI state). |
| **Approve SI** | List action opens the approval page only if the user has **Approve shipment plan** / internal SI approve capability on the **`shipment-plan`** page (see Admin → Roles). |
| **Approval API** | Transition **Draft → Approved** requires prior **Submitted**; **PUT** with `status: Approved` checks **`can_approve`** for page **`shipment-plan`**. **403** if missing. |
| **Approver on document** | On approval, the system stores **approver name/title snapshots** (from `users.display_name` / `users.job_title`, default title **OPERATION HEAD** if job title empty). The **SI document view** shows these instead of a fixed name. |
| **Printed SI number** | Document **No.** prefers stored **`reference_number`** when set; otherwise legacy synthetic numbering. |
| **SI quick detail (list table)** | SI values in table rows are hyperlink-style and open a shared **SI Detail** modal (non-document view) with operational fields and Contract/PO breakdown (including **per-line shipper**). |

Technical contract: **TECH-SPEC-Jetty-Planning-System.md** (§2.2.1, §3.2, §4 `shipping_instruction_breakdown.shipper_id`, §6 RBAC, migration **`025_si_loading_document_and_approve_rbac.sql`**, **`079_si_breakdown_shipper_id.sql`** — **§0.31**).

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

Double-banking (multiple vessels per jetty, schedule `01`/`02` lanes, one-vessel-per-box schematic) is documented and implemented separately. Jetty **layout** only controls **which jetty** sits in which **schematic cell**; **capacity**, **Out of Service** status, and **CCTV** links still come from overview **`berths`**. **Occupants** shown in lane boxes are **derived from `scheduleQueue`** for the selected **View as of** day (**§17.8**), not from live **`berths.occupants`**. **Shifted-out** rows are excluded from schematic occupancy (`shifting_out`); they may still appear as **incoming** hints when date rules match (see **§2.5**, TECH-SPEC **§0.9**).

### 17.6 Schematic bank lanes (inner `01`, jetty name band)

On **Allocation → Jetty Schematic**, each configured jetty **top** or **bottom** cell is a **zone** containing: (1) a **jetty name band** showing the short **berth id** (e.g. **1A**, **1B**) flush against the central **pipeline** (black bar), plus an optional **CCTV camera** control when the user has **View Jetty Live stream** (`can_approve` on **At-Berth Executions**) and master data defines an RTSP link for that jetty (**§2.15**), and (2) **`capacity`** lane boxes. Each lane shows the **bank suffix** only (**`01`**, **`02`**, **`03`**, …); the full lane id **`{berthId}-NN`** appears on **hover** (e.g. tooltip **`1A-01`**). **Inner bank** is **`01`** (closest to the pipeline on **both** top and bottom); **`02`** is the next **outward**, **`03`** outward again for triple bank. The **top** lane stack uses reversed vertical order so **`01`** stays inner toward the pipeline (the **bottom** stack keeps natural order). Each box holds **at most one** displayed vessel (vacant otherwise). Occupants for the selected day are ordered like the Jetty schedule Gantt: **TB** ascending, then **operation id**, then **vessel id** (see TECH-SPEC **§0.6**). If more occupied vessels than **capacity**, the last lane shows **+N more** after the representative vessel for that lane. **Incoming** names are hinted on the **first vacant** lane only (**§17.8**).

### 17.7 Schematic layout & lane sizing (UX)

- **Pipeline alignment:** Each schematic **column** uses a **fixed-height** top band, **fixed** middle (pipeline) band, and **fixed-height** bottom band so the black **pipeline** segment stays **level across columns**, including columns whose top or bottom cell is a non-dockable placeholder (`—`). Each top/bottom band uses **`--jetty-schematic-zone-height: 220px`** (jetty name strip + lane stack).
- **Consistent lane box height:** Each lane’s height is derived from the **lane stack** area (the fixed band height **minus** the jetty name strip and spacing) divided by **max(jetty `capacity`, 2)**. A jetty with **capacity 1** therefore uses the **same lane band height** as a single lane on a double-bank jetty (the vessel card does not stretch to the full top/bottom band). Lane stacks use **`min-height: 0`** and **`overflow: hidden`** so top/bottom rows are not clipped when the schematic scrolls vertically.
- **Lane chrome:** The **bank suffix** (`01`, `02`, …) appears as a small **chip** in the lane’s **top-left** corner (full `{berthId}-NN` remains on hover/tooltip), freeing vertical space for vessel copy.
- **Readability:** Lane copy uses **compact** typography and padding; occupied lanes may **scroll vertically** inside the fixed lane height if content exceeds the band (edge case).

### 17.8 View as of — date-filtered occupancy

| Area | Behaviour |
|------|-----------|
| **Control** | **View as of** — single **`type="date"`** input below the schematic title, plus **Reset** (returns to **today**). Default on load: **today** (local calendar). **Future dates are disabled** (`max` = today; manual entry is clamped). |
| **Historical hint** | When the selected date is **not** today, a short status line shows *Showing allocation for &lt;date&gt;* (i18n). |
| **Data source** | Occupied lanes and **Incoming** hints are computed from **`scheduleQueue`** (plan-centric **`mergedSchedule`** on **`/allocation-plans`**) using the **same Actual · alongside interval** as **§5.2** (`resolveActualAlongsideEnd` in **`jettyScheduleOccupancy.js`**). Master **`berths`** still supplies **capacity**, **Out of Service**, and layout binding only. |
| **Reference time (`asOfMs`)** | **Today:** live clock from Allocation **`breachNowMs`** (~**30s** tick). **Past days:** end of the selected calendar day (local). |
| **Occupied lane — today** | When **D = today** (local calendar, same as **View as of** default): **point-in-time** occupancy using live **`asOfMs`**. A row occupies a lane when **`tbDateTime`** is set and **`startMs <= asOfMs <= endMs`** (inclusive end). The inclusive end is required because open-at-berth intervals use **`endMs = now`**—a strict **`<`** would hide active vessels whose **ETC is in the past**. **SAILED** rows stop occupying after cast-off / actual completion (`asOfMs > endMs`). **SIGNOFF_APPROVED** rows **remain** occupied until depart. |
| **Occupied lane — past days** | When **D** is a **past** calendar day: **full-day overlap** — interval intersects midnight–midnight of **D** (`startMs < endOfDay(D)` and `endMs > startOfDay(D)`), including **SAILED** vessels that were alongside on that day. |
| **Planned-only** | Rows with **ETB** but **no TB** do **not** fill occupied slots (they may appear under **Incoming**). |
| **Incoming hint** | On the **first vacant** lane per jetty, show **Incoming: …** when a **`scheduleQueue`** row is assigned to that jetty, is **not** alongside-occupied on **D** (per rules above), has **not** departed before **D**, and has **ETA / ETB / TA** on or before end of **D**. Includes **SAILED** vessels that have already cast off **today** (shown on a vacant lane, not as occupied). Sorted by earliest arrival. Source is **`scheduleQueue`** (not the separate incoming **`queue`** list). |
| **ETC breach on schematic** | **ETC breached** lane styling and an **icon-only** breach indicator (top-right corner) appear **only when View as of = today** (live operational signal). Past/future dates do not show breach styling even if the vessel was past ETC on that day. |
| **Lane content (occupied)** | Each occupied lane shows, in order: **vessel name**; **purpose** badge (**Loading** / **Unloading**, full label on its **own line** under the name); **Plan ref** or **SI No** (plan-centric Allocation uses **Plan ref:** + **`planReference`**; legacy path uses **SI No:**); **Material :** line from joined SI breakdown commodity names (fallback **commodity** on the queue row). Data comes from Allocation **`vesselById`** when available; occupant fallback supports historical rows not in the live map. |
| **Purpose / schedule-health styling** | Occupied lanes combine **purpose** tint (**Loading** → green family, **Unloading** → blue family) with a **left accent** for schedule health when **View as of = today**: **ETC breached** → **red** accent and breach background; **warning** → **amber**; **on-track** → accent matches **purpose** (**blue** for Unloading, **green** for Loading)—not a generic “all clear” green bar, so on-track unloading does not look like Loading. Historical dates use purpose tint only (no live RAG accent). **Operation type** for tinting uses explicit **`purpose`** / **`loadDischarge`** (not naive substring match on “Unloading”). |
| **Independence** | Schematic **View as of** and Jetty schedule **From / To** filters are **independent** tabs. |

---

*End of document.*
