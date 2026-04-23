# Pre-UAT training — test scripts (module by module)

**Purpose:** Step-by-step scripts for facilitator-led training and dry-run before UAT. Trainers execute or observe each step; trainees tick **Pass / Fail** and add notes.

**How to use this file**

- Complete modules in order when dependencies apply (e.g. Allocation later may need an **Approved** SI).
- Record **environment** (URL, build/date), **test user** names, and **port** if multi-port.
- **Pass** = behaviour matches expected result; **Fail** = log defect ID and screenshot.

**References**

| Document | Use for |
|----------|---------|
| [FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md](FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md) | §16 internal SI (Loading document, approval, RBAC); Gantt/arrival specs for other modules later |
| [TECH-SPEC-Jetty-Planning-System.md](TECH-SPEC-Jetty-Planning-System.md) | §2.2.1 SI workflow, §3.2 APIs, §6 RBAC (`shipping-instruction`, **Approve SI**) |
| [README.md](README.md) | End-to-end pipeline: SI → Allocation → At-Berth → … |
| Jetty PRD vRian - 1.0.pdf | Business context and stakeholder language (keep a copy alongside this repo if not under `Docs/`) |

---

## Module index

| # | Module | Script location |
|---|--------|-----------------|
| 1 | **Shipping Instruction** | §1 below |
| 2 | *To add:* Allocation & Berthing | — |
| 3 | *To add:* At-Berth Executions | — |
| 4 | *To add:* Loading / Unloading | — |
| 5 | *To add:* Clearance & Verification | — |
| 6 | *To add:* Reporting / Calculator | — |

---

## 1. Shipping Instruction module

**Route:** Sidebar → **Shipping Instruction** (`/shipping-instruction`).

**Related screens**

- **SI list + create/edit modal** — main page.
- **SI Approval Sign-off** — `/shipping-instruction/approval/:id` (after submit).
- **SI document view (printable)** — `/shipping-instruction/view/:id` (after approval).

**Roles (prepare before session)**

| Role capability | What to verify |
|-----------------|----------------|
| View + Edit on **Shipping Instruction** | List, expand row, create/edit **Draft** |
| **Approve SI** on **Shipping Instruction** (Admin → Roles) | **Approve** action and sign-off page |
| **Delete** on **Shipping Instruction** | Delete **Draft** / **Submitted** only |
| **Activity Log** (if enabled for user) | Panel on SI routes shows SI-scoped entries |

**Status labels**

- **Loading:** Draft → Submitted → Approved (internal).
- **Unloading:** Same lifecycle in DB; list may show **Received** / **Confirmed** for display (see UI badge **External** on Unloading).

**Preconditions**

1. Log in; select **port** if prompted.
2. Master data present: at least one **Purpose** (Loading / Unloading), **commodity**, **metric** (e.g. MT, KL), and optional shipper / agent / surveyor / loading port / trade term / jetty (from **Master Menu**).
3. Two browser profiles or users recommended: **(A)** creator without Approve SI; **(B)** approver with Approve SI.

---

### 1.1 Landing page & summary cards

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-01 | Open **Shipping Instruction** from sidebar | Page title **Shipping Instructions**; subtitle visible; table loads (or empty state) | ☐ | ☐ | |
| SI-02 | Observe summary cards (**Total SI**, **Pending approval**, **Upcoming arrivals**, **Approved this week**) | Four cards show numeric values consistent with **current filters** (see 1.3) | ☐ | ☐ | |
| SI-03 | If list is empty, note behaviour | No error toast; **Create New SI** still available | ☐ | ☐ | |

---

### 1.2 List table — columns, sort, expand

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-04 | Check table columns | Includes: Document date, SI No, Vessel, Agent, Material, Shipper, Surveyor, Purpose, ETA, Status, Approver, Approval date (+ Actions) | ☐ | ☐ | |
| SI-05 | Click a column header to sort | Sort indicator changes (↑ / ↓); row order updates | ☐ | ☐ | |
| SI-06 | Type in a column filter row | Rows filter to substring match for that column | ☐ | ☐ | |
| SI-07 | Click a row (not on action buttons) | Row expands/collapses; chevron ▶ / ▼ toggles | ☐ | ☐ | |
| SI-08 | In expanded **Full details** | See extended fields (voyage, destination, freight terms, B/L fields, note, approver, breakdown loading then table) | ☐ | ☐ | |
| SI-09 | Wait for breakdown in expanded row | **Contract / PO breakdown** table loads or shows “No breakdown lines” | ☐ | ☐ | |

---

### 1.3 Panel filters (Purpose, Status, Document date)

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-10 | Open **Filters** | Panel shows Purpose, Status, Document date from/to | ☐ | ☐ | |
| SI-11 | Set **Purpose** = Loading | Only Loading rows remain (if any) | ☐ | ☐ | |
| SI-12 | Set **Status** = Submitted | Only Submitted rows remain | ☐ | ☐ | |
| SI-13 | Set document date range | Rows outside range hidden; rows without document date excluded when range set | ☐ | ☐ | |
| SI-14 | Click **Reset** in filter panel | Purpose/Status/Document dates cleared to “all” | ☐ | ☐ | |
| SI-15 | Click **Export** | CSV downloads; open file — headers include Document date, SI No, Vessel, Agent, Material, etc. | ☐ | ☐ | |

---

### 1.4 Create new SI (Draft) — happy path

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-20 | Click **+ Create New SI** | Modal opens; form sections visible after lookups load | ☐ | ☐ | |
| SI-21 | **Vessel & trip:** fill **Vessel Name**, **Shipping Instructions No.** (unique ref), **ETA from** / **ETA to**, **Document date**, select **Purpose** (e.g. Loading) | Required fields accepted | ☐ | ☐ | |
| SI-22 | Optionally fill **Voyage no.**, **Term**, **Preferred jetty** | Saved with record | ☐ | ☐ | |
| SI-23 | **Route & freight:** fill **Destination**; choose **Freight terms** (PREPAID / COLLECT / AS PER CHARTER PARTY / OTHER) | Values visible in form | ☐ | ☐ | Aligns with FUNCTIONAL-SPEC §16 |
| SI-24 | **Party & port:** select Shipper, Loading port, Surveyor, Agent as available | Dropdowns populated from master data | ☐ | ☐ | |
| SI-25 | **Breakdown:** ensure one row has **Commodity**, **Qty** ≥ 0, **Unit** (metric) | **B/L split preview** text updates (e.g. quantity × unit pattern) | ☐ | ☐ | |
| SI-26 | **Add row**; second line with different commodity or contract fields | **Totals by unit** footer updates | ☐ | ☐ | |
| SI-27 | **B/L & consignee:** optional B/L clause, Consignee, Notify party, BL indicated | Accepts multi-line text | ☐ | ☐ | |
| SI-28 | **Document upload:** attach one or more files | File **names** listed; UI states names only (no file content upload) | ☐ | ☐ | |
| SI-29 | **Note:** free text | Saved with SI | ☐ | ☐ | |
| SI-30 | Click modal **Submit** (save) | Success toast; modal closes; new row appears in list as **Draft** (or Unloading equivalent label) | ☐ | ☐ | |
| SI-31 | Expand new row | Full details match entered data; breakdown matches | ☐ | ☐ | |

---

### 1.5 Validation (negative)

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-35 | Open create modal; clear **Purpose**; try submit | Error: select purpose | ☐ | ☐ | |
| SI-36 | Omit **Shipping Instructions No.** | Error message requiring SI number | ☐ | ☐ | |
| SI-37 | Omit **ETA from** or **ETA to** | Error requiring both | ☐ | ☐ | |
| SI-38 | Omit **Document date** | Error requiring document date | ☐ | ☐ | |
| SI-39 | Breakdown row: missing commodity or metric, or invalid qty | Error naming row index | ☐ | ☐ | |

---

### 1.6 Edit Draft

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-40 | On a **Draft** row, click **Edit** (pencil) | Modal opens with existing data | ☐ | ☐ | |
| SI-41 | Change vessel name and one breakdown qty; **Submit** | List and expanded details reflect changes; success toast | ☐ | ☐ | |
| SI-42 | On **Submitted** or **Approved** row, hover **Edit** | Control disabled; tooltip explains only Draft editable | ☐ | ☐ | |

---

### 1.7 Submit for approval

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-45 | On **Draft** Loading (or Unloading) row, click **Request approval** | Status becomes **Submitted** (list may show **Received** for Unloading); success toast | ☐ | ☐ | Persists via API |
| SI-46 | **Pending approval** summary card | Count updates when filters include that row | ☐ | ☐ | |
| SI-47 | On **Draft** row, **View SI document** (if visible) | Disabled until Approved — tooltip explains | ☐ | ☐ | |

---

### 1.8 Approve SI (RBAC)

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-50 | User **without** Approve SI: open **Submitted** row, hover **Approve** | Action disabled; tooltip references permission | ☐ | ☐ | |
| SI-51 | User **with** Approve SI: click **Approve** on **Submitted** row | Navigates to **SI Approval Sign-off** for that SI | ☐ | ☐ | |
| SI-52 | On sign-off page, review preview (Loading full form vs Unloading simplified layout) | Data matches SI; **Print** / **Download PDF** trigger print flow | ☐ | ☐ | |
| SI-53 | Without checking certification checkbox, try **Approve & Sign-off** | Button stays disabled | ☐ | ☐ | |
| SI-54 | Check certification; **Approve & Sign-off** | Status **Approved**; **approval id** generated; approver snapshots stored (per FUNCTIONAL-SPEC §16) | ☐ | ☐ | |
| SI-55 | Return to list | Row shows **Approved** (Loading) or **Confirmed** display for Unloading; **Approver** / **Approval date** populated | ☐ | ☐ | |
| SI-56 | **View SI document** on approved row | Opens printable **Shipping Instruction** document | ☐ | ☐ | **No.** uses **reference number** when set |
| SI-57 | On document view, verify **approver name/title** (if implemented) | Matches policy (snapshot from user profile) | ☐ | ☐ | |

---

### 1.9 View document & embed (cross-feature awareness)

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-60 | Open **View SI** for non-approved SI (direct URL if needed) | **View not available** message; link back to list | ☐ | ☐ | |
| SI-61 | *(Optional)* From **Allocation**, open context that embeds SI view (`?embed=1`) | Document renders in embedded mode without breaking parent page | ☐ | ☐ | |

---

### 1.10 Delete

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-65 | User without delete permission | Delete disabled with tooltip | ☐ | ☐ | |
| SI-66 | **Draft** row: **Delete** → confirm | Row removed; success toast | ☐ | ☐ | |
| SI-67 | **Submitted** row: **Delete** → confirm | Row removed (if policy allows) | ☐ | ☐ | |
| SI-68 | **Approved** row: **Delete** | Disabled; cannot delete approved | ☐ | ☐ | |

---

### 1.11 Activity Log (optional)

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-70 | After create/update/submit/delete, open **Activity Log** panel on SI page | Entries for **shipping-instruction** scope appear | ☐ | ☐ | Requires view permission for activity log |
| SI-71 | Expand an entry with **changes** | Before → after field list readable | ☐ | ☐ | |

---

### 1.12 Unloading-specific display

| ID | Step | Expected result | Pass | Fail | Notes |
|----|------|-----------------|------|------|-------|
| SI-75 | Create or filter to **Unloading** SI | Status column shows **External** badge where applicable | ☐ | ☐ | |
| SI-76 | Run submit → approve flow for Unloading | Display labels **Received** / **Confirmed** match list badges | ☐ | ☐ | |

---

### 1.13 Trainer wrap-up checklist

- [ ] All trainees can create a **Draft** SI with valid breakdown.
- [ ] Trainees understand **Submitted** vs **Approved** and who may approve (**Admin → Roles → Approve SI**).
- [ ] Trainees can open **printable SI** only after approval.
- [ ] CSV **Export** and **Filters** understood for reporting dry-runs.
- [ ] Known limitation documented: **Document upload** stores names only in current UI.

---

*Next document update: add **Module 2 — Allocation & Berthing** as a new §2 section following the same table format.*
