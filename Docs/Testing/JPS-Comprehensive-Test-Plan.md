# Jetty Planning System — Comprehensive Functionality Test Plan

**Target:** Staging `http://172.28.92.56:3080/`
**Scope:** Frontend + backend, positive & negative scenarios, validation, and cross-page data consistency.
**Legend:** Type **P** = positive (happy path), **N** = negative (validation / error / guard). Priority H/M/L.
**Result columns (filled at execution):** Status (PASS/FAIL/BLOCKED), Screenshot ref, Notes.

> Prerequisite data load (Master – Jetty) is defined in §M2 and must be entered before the Shipment-Plan suggestion cases (§SP) and the Schematic scaling cases (§SC).

---

## A. Authentication, Session & Access Control

| ID | Type | Pri | Scenario | Steps | Expected result |
|----|------|-----|----------|-------|-----------------|
| AUTH-01 | P | H | Login page renders | Open app URL while logged out | Login form with username/password fields shown |
| AUTH-02 | P | H | Valid login | Enter valid admin credentials → Sign in | Redirect into app; user shown top-right |
| AUTH-03 | N | H | Wrong password | Valid user + wrong password | Error message; stays on /login; no session |
| AUTH-04 | N | H | Empty fields | Submit with blank username/password | Client validation blocks; no request/soft error |
| AUTH-05 | N | M | Unknown user | Non-existent username | Generic auth error (no user-enumeration leak) |
| AUTH-06 | N | M | Rate limiting | Repeated failed logins from same IP | After threshold, requests throttled (429/backoff) |
| AUTH-07 | P | H | Logout | Trigger logout | Session cleared; protected routes redirect to login |
| AUTH-08 | N | H | Direct deep-link while logged out | Open `/shipment-plans` with no session | Redirected to login |
| AUTH-09 | P | M | Session persists on reload | Reload an inner page while logged in | Stays authenticated (cookie/session valid) |
| AUTH-10 | N | M | Expired/again after logout | Use browser Back after logout | Cannot see protected data; redirected |

## R. RBAC & Port Scope

| ID | Type | Pri | Scenario | Expected result |
|----|------|-----|----------|-----------------|
| RBAC-01 | P | H | View-only role sees pages read-only | Edit/create/approve buttons hidden or disabled |
| RBAC-02 | N | H | View-only cannot mutate | Direct API PATCH/POST returns 403 |
| RBAC-03 | P | H | Editor can create/edit but not approve | Approve action hidden; edit works |
| RBAC-04 | P | H | Approver can approve/reject | Approve & reject visible and functional |
| RBAC-05 | P | M | Port scope filters data | Only the selected port's plans/jetties/ops shown |
| RBAC-06 | N | M | Cross-port access blocked | API for another port's record → 403/404 |
| RBAC-07 | P | M | Port switch refreshes lists | Change port → all lists reload to that port |

## M. Master Data

### M1. Master – Port
| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| MPORT-01 | P | M | Create port | Saved, appears in list |
| MPORT-02 | N | M | Create with blank name | Validation error, not saved |
| MPORT-03 | P | M | Edit port | Change persists |
| MPORT-04 | N | L | Duplicate name (if enforced) | Rejected or allowed per rule (document) |

### M2. Master – Jetty  *(prerequisite data load + new fields)*
Data to enter (Max LOA m / Max DWT / commodities). Beam = No restriction (not a field).

| Jetty | Max LOA (m) | Max DWT | Commodities (from Master – Commodity; purpose prefix noted) |
|-------|-------------|---------|--------------------------------------------------------------|
| 1A | 120 | 6000 | Disch CPO, Disch CPKO |
| 1B | 120 | 6000 | Disch CPO, Disch CPKO |
| 2A | 155 | 10000 | Disch CPO, Disch CPKO, Disch POME |
| 2B | 155 | 10000 | Disch CPO, Disch CPKO, Disch POME, Load FAME, Disch METHANOL, Load CG, Load ROL, Load CPKO, Load RPOME, Load PFAD, Load RPKO |
| 3A | 155 | 30000 | Load FAME, Load RPOME, Disch METHANOL, Load CG, Load ROL, Load PFAD, Load FM, Load RPKO, Load CPKO, Load RG, Load SPKFA |
| 3B | 155 | 30000 | Load PKE, Load PKM, Load PKS, Load FAME, Load RPOME, Disch METHANOL, Load CG, Load ROL, Load PFAD, Load FM, Load RPKO, Load CPKO, Load RG, Load SPKFA |
| 5  | 180 | 4000 | Disch PK, Disch PKS, Disch COAL, Disch SAND, Load SBE |

> Note: "1C" appears in the DWT source list (6000) but has no LOA and is not a standard jetty in the layout — flag with user; not entered unless it exists. Jetty draft is a mandatory field on the form but not supplied in this data set — see MJETTY-11.

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| MJETTY-01 | P | H | Jetty list shows new columns | Length (m), Draft, DWT, Commodity columns present |
| MJETTY-02 | P | H | Edit jetty → set LOA/DWT/commodities (per §M2 table) | Saved; row shows values; commodities listed |
| MJETTY-03 | N | H | Save with blank Jetty Length | Blocked: "Jetty Length (m) is required…" |
| MJETTY-04 | N | H | Save with blank Draft | Blocked: "Draft Jetty is required…" |
| MJETTY-05 | N | H | Save with blank DWT | Blocked: "DWT Jetty is required…" |
| MJETTY-06 | N | H | Non-numeric / zero / negative in LOA/DWT/Draft | Blocked with "must be a number greater than 0" |
| MJETTY-07 | P | H | Commodity search filters list | Typing filters checkbox list by name |
| MJETTY-08 | P | H | Multi-select commodities | Multiple checked; summary line lists them; persists after save |
| MJETTY-09 | P | M | Deselect commodity | Unchecking removes link on save |
| MJETTY-10 | P | M | Empty commodity = accepts any | Jetty with no commodities treated as universal in suggestions |
| MJETTY-11 | N | M | Draft not supplied in dataset | Confirm value with user; cannot save without it (document assumption used) |
| MJETTY-12 | P | M | Capacity (double-bank) | Set capacity 2 → schematic shows 2 lanes |
| MJETTY-13 | N | H | Set Out of Service while active op uses jetty | Blocked 409 with reassign message |
| MJETTY-14 | P | M | Commodity name not in master (e.g. code missing) | Not selectable; flagged in report |

### M3. Master – Commodity / Agent / Surveyor / Shipper / Freight terms
| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| MCOM-01 | P | M | Commodity list renders | Master commodities listed |
| MCOM-02 | P | M | Create/edit commodity | Persists; appears in jetty & SI selectors |
| MCOM-03 | N | M | Blank name | Validation error |
| MAGT-01 | P | L | Agent CRUD | Create/edit/list works |
| MSRV-01 | P | L | Surveyor CRUD | Create/edit/list works |

## SP. Shipment Plans — New Plan (combined modal) & vessel data

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| SP-01 | P | H | List renders with tiles | Total/Draft/Pending/Approved counts + table |
| SP-02 | P | H | Open New Shipment Plan modal | Plan section + Shipping instructions section render |
| SP-03 | P | H | All plan fields visible after "Add shipping instruction" | Capacity MT/LOA/GT/Draft/DWT + Preferred jetty remain visible (no overflow-clip regression) |
| SP-04 | N | H | Submit with no Purpose | Blocked: purpose required |
| SP-05 | N | H | Blank Vessel name | Blocked: vessel required |
| SP-06 | N | H | Blank/0/negative Vessel capacity MT | Blocked: "must be a number greater than 0" |
| SP-07 | N | H | Blank/0/negative Vessel LOA | Blocked with LOA field message |
| SP-08 | N | H | Blank/0/negative Vessel GT | Blocked with GT field message |
| SP-09 | N | H | Blank/0/negative Vessel Draft | Blocked with Draft field message |
| SP-10 | P | H | Auto DWT = GT + Capacity MT | DWT field updates live; read-only |
| SP-11 | N | H | Blank ETA | Blocked: ETA required |
| SP-12 | P | H | Create plan only (no SI) | Plan created Draft; toast; appears in list |
| SP-13 | P | H | Create plan + 1 SI | Plan + SI created; count reflects |
| SP-14 | P | H | Create plan + multiple SIs | All SIs created under one plan |
| SP-15 | P | H | Plan reference generated | SP-YY-MM-##### format |
| SP-16 | P | H | Edit plan (Draft) | Fields editable; save persists incl. vessel dims |
| SP-17 | N | H | Edit plan not in Draft/Rejected | Blocked (only Draft/Rejected editable) |
| SP-18 | P | H | Submit plan | Status → Submitted; pending approval count +1 |
| SP-19 | P | H | Approve plan | Status → Approved |
| SP-20 | P | H | Reject plan with reason | Status → Rejected; reason stored |
| SP-21 | N | M | Approve without permission | 403 / action hidden |
| SP-22 | P | M | Delete Draft plan | Removed; guarded if has operations |
| SP-23 | N | M | Delete plan with operations | Blocked 409 |
| SP-24 | P | M | Filters (vessel, approval, purpose) | Table filters correctly |
| SP-25 | P | M | Vessel DWT persisted to DB | Reopen shows same DWT (generated column) |

## SPJ. Preferred-Jetty Suggestion & Validation *(depends on §M2 load)*

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| SPJ-01 | P | H | Suggestion appears when LOA+DWT+ETA+commodity set | Hint line lists fitting jetties |
| SPJ-02 | P | H | Dropdown excludes unsuitable jetties | Only jetties meeting LOA≤len, DWT≤jettyDWT, commodity shown |
| SPJ-03 | P | H | LOA filter | Vessel LOA 170 → 1A/1B(120)/2A/2B/3A/3B(155) excluded; only Jetty 5(180) offered |
| SPJ-04 | P | H | DWT filter | Vessel DWT 25000 → only 3A/3B(30000) offered |
| SPJ-05 | P | H | Commodity filter | SI commodity = POME → only jetties handling POME (2A/2B) offered |
| SPJ-06 | P | H | Combined filter | LOA 150 + DWT 9000 + CPO → 2A/2B (and others meeting all) |
| SPJ-07 | N | H | No jetty fits | "No jetty fits…" message; empty suggestion |
| SPJ-08 | N | H | Manually select unsuitable (kept selection) → submit | Hard block with reason (LOA/DWT/commodity) |
| SPJ-09 | P | M | Jetty with empty commodity list | Treated as accepting the commodity |
| SPJ-10 | P | M | Occupied-at-ETA note | Fitting-but-occupied jetty shows "occupied at ETA" (still selectable) |

## SI. Shipping Instructions (within plan)

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| SI-01 | P | H | SI required fields (SI no, doc date) | Required; block if empty |
| SI-02 | P | H | Breakdown line: commodity+qty+unit | Required per line; totals compute |
| SI-03 | N | H | Breakdown qty 0/blank | Blocked |
| SI-04 | P | M | Add/remove breakdown rows | Rows add/remove; ≥1 enforced |
| SI-05 | P | M | Loading purpose extras (freight terms, NPWP, consignee, BL) | Shown only for Loading |
| SI-06 | P | M | Unloading purpose extras (term) | Shown only for Unloading |
| SI-07 | P | M | Document upload | File attaches to draft SI |
| SI-08 | P | L | SI document OCR extract (if available) | Extract populates fields; conflict modal handled |
| SI-09 | P | H | SI inherits vessel/ETA/voyage from plan | Plan-linked; consistent |
| SI-10 | P | M | SI detail modal shows vessel dims | Capacity/LOA/GT/Draft/DWT rows present |

## VI. Vessel Information modal (clickable vessel name)

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| VI-01 | P | H | Vessel name clickable — Shipment Plans | Opens modal with name/capacity/LOA/GT/draft + auto DWT |
| VI-02 | P | H | Vessel name clickable — Allocation (berthed) | Opens modal |
| VI-03 | P | H | Vessel name clickable — At-Berth | Opens modal |
| VI-04 | P | H | Vessel name clickable — Clearance | Opens modal |
| VI-05 | P | H | Edit + save vessel info (any approval status) | Saved via vessel-info endpoint; toast |
| VI-06 | P | H | Auto DWT recompute in modal | DWT = GT + capacity live |
| VI-07 | N | H | Blank/0 numeric in modal | Blocked with field message |
| VI-08 | P | H | Cross-page consistency after edit | New values reflected on all 4 pages + schematic + SI detail |
| VI-09 | N | M | View-only role | Modal read-only; no Save |

## AB. Allocation & Berthing — Queue & actions

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| AB-01 | P | H | Queue renders (Incoming tab) | Approved-plan vessels listed |
| AB-02 | P | H | Berthed tab | Berthed vessels listed |
| AB-03 | P | H | Berth a vessel (assign jetty) | Vessel moves to berthed; jetty set |
| AB-04 | N | H | Berth onto Out-of-Service jetty | Blocked with message |
| AB-05 | P | H | Log arrival update (ETA/TA/ETB/TB/ETC) | Saved; reflected in row & schedule |
| AB-06 | N | M | Invalid time order (e.g. TB before TA) | Handled per business rule (document) |
| AB-07 | P | M | Berthing sequence swap (↑/↓) | Sequence reorders; persists |
| AB-08 | P | M | Re-dock flow | Re-dock modal; state updates |
| AB-09 | P | M | ETC breach indicator | Late vessels flagged (RAG/badge) |
| AB-10 | P | M | Shifting-out toggle | Reflected in queue & schematic |

## SC. Jetty Schematic *(depends on §M2 load)*

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| SC-01 | P | H | Schematic renders per admin layout | Columns/lanes per configured layout |
| SC-02 | P | H | White theme | Cards, name bands, trestle white with dark text |
| SC-03 | P | H | Purpose colors | Loading = green hull/chip; Unloading = blue |
| SC-04 | P | H | Column width ∝ jetty length | Jetty 5 (180) wider than 1A (120) |
| SC-05 | P | H | Ship length ∝ LOA/jetty length | Bigger LOA → longer ship |
| SC-06 | P | H | Info card content | Vessel name, agent, cargo done/total, balance, Time Since Berthing, ref |
| SC-07 | P | M | Vacant + incoming details | Vacant lane shows incoming ETA/ETB/commodity/qty |
| SC-08 | P | H | KPI chips (ETA/ETB/ETC not-yet) | Counts match queue on the as-of date |
| SC-09 | P | H | KPI drill-down | Click chip → queue filtered + banner; counts equal |
| SC-10 | P | M | Date picker (historical) | Past date shows that day's allocation |
| SC-11 | P | M | CCTV button | Present when RTSP configured; opens live view |
| SC-12 | P | M | Popout full view | Opens; same data |
| SC-13 | P | M | Tooltip fit info | LOA/Draft/DWT vs jetty spec with ⚠ when exceeding |

## GT. Jetty Schedule (Gantt)

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| GT-01 | P | H | Gantt renders with lanes/bars | Bars per vessel across dates |
| GT-02 | P | H | Drag reschedule (estimation) | ETA/ETB shift; confirm; saved |
| GT-03 | P | H | Drag reschedule (actual) | TA/TB shift when applicable |
| GT-04 | P | M | Resize-end = ETC | Completion moves; saved |
| GT-05 | P | M | Export JPEG | Full chart exported |
| GT-06 | N | M | Drag without permission | Disabled |

## ATB. At-Berth Executions

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| ATB-01 | P | H | List renders (grouped by plan) | Vessels grouped; phases shown |
| ATB-02 | P | H | Pre-Checking activities (Key meeting, NOR, Sampling) | Open/edit/save each |
| ATB-03 | P | H | Operational phase (cargo load lines/times) | Record start/qty; totals |
| ATB-04 | P | H | Post-Checking | Complete activities |
| ATB-05 | P | H | Sign-off request → approve | Status → SIGNOFF_APPROVED |
| ATB-06 | N | M | Sign-off without completing required steps | Blocked/guarded |
| ATB-07 | P | M | Embedded popup from Allocation pipeline | At-Berth opens in modal iframe |

## CL. Clearance / Verification

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| CL-01 | P | H | Clearance list renders | Ready/pending/sailed rows |
| CL-02 | P | H | Sign off operation | Moves to Ready to Sail |
| CL-03 | P | H | Depart / cast-off (plan) | All child ops SAILED; times set |
| CL-04 | N | M | Depart without cast-off time | Blocked/validated |
| CL-05 | P | M | Clearance document upload | Attached |
| CL-06 | P | M | Embedded popup from Allocation pipeline | Clearance opens in modal iframe |

## DEM / DASH / REP. Ancillary

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| DEM-01 | P | M | Demurrage calculator renders & computes | Inputs → result |
| DASH-01 | P | M | Dashboard loads KPIs/charts | Content renders, no errors |
| REP-01 | P | L | Reporting page renders | Reports/exports available |
| REP-02 | P | L | Daily activities / vessel report | Renders with data |

## X. Cross-page Data Consistency & Integrity

| ID | Type | Pri | Scenario | Expected |
|----|------|-----|----------|----------|
| X-01 | P | H | Plan vessel data consistent across SP list, Allocation, At-Berth, Clearance, Schematic | Same vessel name/qty/purpose everywhere |
| X-02 | P | H | Vessel-info edit propagates everywhere | LOA/GT/DWT change visible on all pages after refresh |
| X-03 | P | H | Commodity/jetty master change reflects in suggestions | Editing jetty commodities changes SP suggestion set |
| X-04 | P | H | DWT recompute consistency | GT or capacity change → DWT updates in modal, SI detail, schematic tooltip |
| X-05 | P | H | KPI counts equal drill-down row counts | Chip number == filtered queue rows |
| X-06 | P | M | Approval status cascade | Plan approval reflected on SI status where applicable |
| X-07 | P | M | Timezone display | ETA/ETB shown in port timezone consistently |
| X-08 | N | M | Concurrent edit / stale data | Second save handles gracefully (no silent overwrite) |

---

### Execution notes
- Backend coverage is exercised through the UI plus targeted API checks (validation 400s, RBAC 403s, generated-column DWT) captured via the network panel / direct calls.
- Every executed scenario gets a screenshot named `<ID>-<slug>.png` under `Docs/Testing/screenshots/`.
- Final results compiled to `Docs/Testing/JPS-Comprehensive-Test-Report.docx` (Summary table → per-module results with screenshots).
