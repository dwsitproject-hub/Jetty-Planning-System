# Plan: Slot occupancy, remove Awaiting berth, in-app jetty OOS + Allocation UX

**Status:** Implemented in code (2026-04-07). Exception pending / Clearance (#2) remains deferred.  
**Created:** 2026-04-07  
**Out of scope for this document:** Exception pending / Clearance workflow enhancements (#2) — defer until a separate pass.

This plan consolidates UAT feedback and implementation notes for:

1. **Dashboard — jetty occupancy** → slot-based (capacity-aware).
2. **Dashboard — remove** the **Awaiting berth** widget (redundant with pipeline “Planned berthing”).
3. **Master — Jetty** in-app **Out of Service** (and related statuses) + **backend guard Option A**.
4. **Allocation & Berthing** UI/UX and validation aligned with OOS + Option A.

---

## Scope summary

| # | Deliverable | In scope |
|---|-------------|----------|
| 1 | Dashboard **Jetty occupancy** uses **slots** (`capacity` / `occupiedCount`) | Yes |
| 3 | Remove Dashboard **Awaiting berth** widget | Yes |
| 4 | **Master – Jetty**: status control in UI; **backend** blocks marking **Out of Service** when jetty is “occupied” (Option A) | Yes |
| 4b | **Allocation & Berthing**: UX + client/server validation for OOS | Yes |
| 2 | Exception pending / Clearance tabs | **Deferred** |

---

## Shared definitions

### “Occupied jetty” (Option A — block OOS)

Use one **authoritative** rule in backend (and mirror in product copy):

- A jetty is **occupied** if there exists at least one **non-deleted** operation with that **`jetty_id`**, **`status ≠ 'SAILED'`**, and (align with allocation overview) exclude rows that are **shifting out** when deciding whether the jetty is still “tied up” — exact SQL should match `allocation` occupancy logic.

**Option A (strict):** treat **any** non-sailed operation with that `jetty_id` as blocking (including **ALLOCATED** without TB). That matches *“force planner to clear / reassign on Allocation before marking OOS.”*

### OOS in overview data

`GET /allocation/overview` already returns **`berths[].status`** from `jetties`. Allocation and Dashboard should treat **`status === 'Out of Service'`** as **not assignable** for **new** allocations.

---

## 1. Jetty occupancy — slot-based

### Goal

Replace **“occupied jetties / total jetties”** with a metric that respects **`jetties.capacity`** and **`berths.occupiedCount`**.

### Product decisions (confirm before build)

- **Numerator:** `Σ min(occupiedCount, capacity)` (safe if data overfills) **or** `Σ occupiedCount` if backend guarantees `occupiedCount ≤ capacity`.
- **Denominator:** `Σ capacity` for jetties in the selected port — **excluding** jetties **Out of Service** (recommended so OOS does not dilute the percentage).
- **Label:** e.g. **“Slot occupancy”** + subtitle **“Vessel positions in use / total positions (available jetties).”**
- **Progress bar:** same formula; consider visual treatment if occupied slots exceed total slots (data issue).

### Implementation outline

1. **`Frontend/src/pages/Dashboard.jsx`**: derive metrics from `berths`; treat missing `capacity` as `1` (match API default).
2. **Optional later:** same KPI on Allocation header (not required for first delivery).
3. **UAT cases:** all capacity 1; one jetty capacity 2 with 0/1/2 vessels; OOS excluded from denominator per decision above.
4. **Docs:** add a short paragraph to functional spec — slot vs jetty.

### Dependency

Denominator exclusion of **OOS** aligns with **#4** once jetty status is reliably maintained in master data.

---

## 3. Remove “Awaiting berth” widget

### Goal

Remove the Dashboard sidebar card **Awaiting berth**; **Planned berthing** in the vessel pipeline is the canonical pre-alongside indicator.

### Rationale

- **Awaiting berth** used: `operationId && taDateTime && !tbDateTime`.
- **Planned berthing** uses: jetty assigned, no TB, status not DOCKED / IN_PROGRESS / COMPLETED — **does not require TA**, so the two widgets diverged and confused testers.

### Implementation outline

1. Remove the **Awaiting berth** `<section>` from **`Dashboard.jsx`** (title, hint, list, footer link).
2. Remove **`awaitingBerth`** `useMemo` and **`hoursBetween`** if unused elsewhere in the file.
3. **`Frontend/src/styles/dashboard.css`**: remove rules only used by that block.
4. **QA:** sidebar layout with **Jetty status** + **Recent updates**; responsive checks.

### Optional follow-up

If “wait since TA” is still needed operationally, add a column or badge on **Allocation** queue rows (separate task).

---

## 4. In-app jetty “Out of Service” + backend guard (Option A)

### Backend

1. **`PUT /api/v1/jetties/:id/status`**  
   Before applying status **`Out of Service`**, check **occupied jetty** per definition above.  
   - If blocking operations exist → **`409 Conflict`** with JSON message, e.g. *“Cannot mark out of service: active operations still use this jetty. Reassign or complete them on Allocation & Berthing first.”*

2. **`PUT /allocation/arrival`** (and any route that sets **`operations.jetty_id`**)  
   After resolving jetty short name → `jetties.id`, if target row has **`status === 'Out of Service'`** → reject (**`400`** or **`409`**) with a clear message.  
   - **Reassign away** from a jetty to another valid jetty remains allowed (clear path for planners).

3. **Tests:** OOS with zero ops; OOS blocked with ALLOCATED only; blocked with DOCKED; `shifting_out` handling consistent with overview.

### Master – Jetty UI (`Frontend/src/pages/MasterJetty.jsx`)

- Add **Status** `<select>` in Add/Edit modal: `Available`, `Out of Service`.
- Persist via existing **`PUT /jetties/:id/status`** (`updateJettyStatus` in `Frontend/src/api/jetties.js`).
- On **409**, show toast + actionable copy (link to Allocation for operators who have access).

---

## 4b. Allocation & Berthing — UI/UX (incorporated)

### Goals

- Prevent assigning vessels to **OOS** jetties.
- Make **OOS** visible on schematic and schedule.
- Align with **Option A** on Master (planner clears jetty on operation before OOS).

### Surfaces to update

Use **`berthsState`** from `fetchAllocationOverview()` (`id`, `status`, `capacity`, `occupants`, `occupiedCount`).

1. **Client validation (before save)** — all paths that set or keep a **jetty** on an operation:
   - Log arrival / **save arrival** (`saveArrivalUpdate` and parallel validation in sequence save, vessel detail save, etc.).
   - **Vessel detail** modal jetty field.
   - **Berthing / re-dock** flows if they can change jetty.

   **Rule:** If resolved target jetty id (e.g. first segment of `jetty` string, as today) maps to a berth with **`status === 'Out of Service'`** → **block** with:  
   *“Jetty X is out of service. Select another jetty or restore service in Master – Preferred Jetty.”*  
   Run **after** “berth exists” check and **before** capacity/full logic.

2. **Jetty schematic (`JettySchematic.jsx`)**  
   - OOS berths: muted styling + **OOS** badge + tooltip *“Out of service — not available for new allocation.”*

3. **Jetty schedule Gantt (`JettyScheduleGantt.jsx`)**  
   - Consistent lane/strip styling for OOS so the time view matches the schematic.

4. **Queue / table**  
   - If row’s **jetty** matches an OOS berth in `berthsState`, show optional warning chip **“OOS jetty”** (legacy or race); primary prevention is validation + Master guard.

5. **RBAC-aware copy**  
   - Users without Master access: *“Contact an admin…”* instead of *“restore in Master.”*

6. **Edge cases**

   | Scenario | Behaviour |
   |----------|-----------|
   | Reassign A → B | Allow if B not OOS and capacity OK. |
   | Same jetty, jetty became OOS in another tab | Save that keeps OOS jetty should **fail** server-side; client should block when detected. |
   | Master returns 409 | Planner uses Allocation to reassign/clear, then retries OOS in Master. |

---

## Suggested implementation order

1. **Backend:** `jettyIsOutOfService`, `jettyHasBlockingOperations` (or equivalent queries); wire **`PUT /jetties/:id/status`** and **`PUT /allocation/arrival`**.
2. **Master Jetty** UI + `updateJettyStatus`.
3. **Allocation:** client OOS checks on all jetty save paths; schematic + Gantt + optional table chip.
4. **Dashboard #1** slot occupancy (denominator excludes OOS capacity per product decision).
5. **Dashboard #3** remove Awaiting berth widget.

---

## Deferred: #2 Exception pending

- Surface **exception `PENDING`** on **Clearance** (`/verification`): tabs or filter, fetch ops with `exceptionStatus === 'PENDING'`, approve/reject actions.
- Dashboard **Exceptions pending** card → link to that view.

**No work** in this document’s implementation batch until explicitly scheduled.

---

## References (code)

- Dashboard occupancy today: `Frontend/src/pages/Dashboard.jsx` (`occupancy` useMemo).
- Overview berths: `Backend/src/routes/allocation.js` (`router.get('/overview', …)`).
- Allocation jetty validation: `Frontend/src/pages/Allocation.jsx` (capacity / full checks before save).
- Jetty status API: `Backend/src/routes/jetties.js` (`PUT /:id/status`), `Frontend/src/api/jetties.js` (`updateJettyStatus`).
