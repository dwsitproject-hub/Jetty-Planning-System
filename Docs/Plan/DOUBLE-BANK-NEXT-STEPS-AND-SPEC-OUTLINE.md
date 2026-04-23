# Double bank — 03 April 2026 checklist, plan, and spec outline

**Date context:** Prepared for follow-up work after review of double-banking (schematic + Jetty Schedule).  
**Note:** “Shifting out” has **not** been tested yet by the product owner.  
**Note:** **Master – Jetty Layout** (saved layout) has **not** been fully verified; save works, but the **Allocation / Dashboard Jetty Schematic** may still not reflect the persisted layout.

---

## What to check tomorrow (verification checklist)

### A. Master – Jetty

- [ ] Jetty **capacity** is set correctly (e.g. `2` for Jetty 1A) and persists after refresh.
- [ ] Activity Log shows jetty updates with sensible **from → to** values.

### B. Allocation – schematic (“one vessel = one box” expectation)

- [ ] With **two vessels** on the same jetty, confirm whether the UI matches **product expectation**: two **visually separate** boxes (not one box containing two vessels).
- [ ] Click each box: **correct** active vessel detail modal (name, docs, photo, remarks).
- [ ] After **Confirm berthing**, schematic refreshes without manual browser reload; both vessels visible.
- [ ] **Vacant** slots and styling still look correct when capacity &gt; 1 but only one occupant.

### C. Jetty Schedule (Gantt)

- [ ] For Jetty **1A** with capacity **2**, when **two different vessels** are berthed/planned, confirm:
  - [ ] One vessel appears under **1A-01** and the other under **1A-02** (not both under **01**).
- [ ] For a **single** vessel, confirm **Planned** vs **Actual** bars still make sense (may be two bars for the same vessel — that is different from “two vessels in one lane”).
- [ ] Filters, date range, and “NOW” line still behave as before.

### D. Shifting out (when you test it)

- [ ] From **At-Berth**, “Shifting out” moves the vessel back toward **incoming / queue** treatment, clears berth occupancy for allocation to another vessel, and shows a **Shifted** indicator where designed.
- [ ] **Re-dock** (or equivalent) restores berthed state without breaking history (per agreed rules).
- [ ] Activity Log entries for shifting actions.

### E. Regression smoke

- [ ] Single-capacity jetties behave as before (one vessel only).
- [ ] Reports / utilization if you rely on them for UAT.

### F. Master – Jetty Layout ↔ Jetty Schematic (not fully checked yet)

**Observed so far:** Layout saves correctly (backend / activity log as designed), but the **Jetty Schematic** on Allocation (and Dashboard if shared) **does not yet mirror** the saved layout—columns, jetty positions, or ordering may still follow a **fallback or local** layout instead of the **port-scoped persisted** layout.

**Tomorrow, verify:**

- [ ] In **Master – Jetty Layout**, change column order or jetty placement for the active port, **Save**, refresh the page — confirm the stored layout reloads in the editor.
- [ ] Open **Allocation** (same active port) → **Jetty Schematic** tab: confirm whether slots match the **saved** layout (same columns, same top/bottom jetty per column).
- [ ] Repeat on **Dashboard** if it embeds `JettySchematic` — behaviour should match product expectation (single source of truth per port).
- [ ] If schematic still ignores the saved layout, capture: active `port_id`, a screenshot of Master layout vs Schematic, and whether `GET /jetty-layout` returns the expected `layout_json` (for dev follow-up).

**Planned fix direction (for implementation session):**

- Ensure `JettySchematic` (and any other consumer) reads layout from the **same source** as Master – Jetty Layout (API: persisted `jetty_layouts` by **active `port_id`**), not only from legacy/local `getJettyLayout(portId)` helpers that may use a different key or stale data.
- After wiring, document the contract: layout JSON shape, port scoping, cache/refresh on navigation.

---

## Your three comments — interpretation and planned work

### 1) “One vessel = one box” (not one box for *n* vessels)

**Current behaviour (summary):** The schematic groups multiple occupants inside **one** jetty slot card (with sub-dividers inside).

**Target behaviour:** Each **occupied berth position** is its own **separate** box (same jetty, but **per-vessel / per-lane** UI), aligned with how the schedule labels **01, 02, …**.

**Planned implementation direction:**

- **UI:** Refactor `JettySchematic` so each jetty column renders **capacity** sub-slots (e.g. `1A-01`, `1A-02`), each either **Vacant** or **one vessel**.
- **Interaction:** Each sub-box is clickable; map clicks to the correct `vesselId` / operation for the detail modal.
- **Data:** Continue using `berths[].occupants[]` ordered list; define a **stable rule** for which occupant maps to **01** vs **02** (e.g. by `tbDateTime`, then `operationId`).

### 2) Jetty Schedule: both vessels still under **01** instead of **01** + **02**

**Likely cause (technical):** `JettyScheduleGantt` uses lane packing. **Planned** and **Actual** for the **same** vessel can consume two “rows” in one lane-group, or two vessels are both assigned **lane index 0** if the algorithm or segment keys treat them as overlapping in a way that doesn’t advance the lane index.

**Planned fix direction:**

- **Separate concerns:**
  - **Lane index 01 / 02:** reserved for **distinct operations / vessels** on that jetty (multi-bank).
  - **Planned vs Actual:** should be **sub-rows or sub-segments within the same lane** for one vessel, **not** consume a second multi-bank lane unless product confirms otherwise.
- **Code:** Revisit `JettyScheduleGantt.jsx` row definitions and packing: ensure **one vessel → one primary lane**; second vessel on same jetty → **next lane** (`02`).
- **Acceptance test:** Two vessels on 1A → bars on **1A-01** and **1A-02**; one vessel with planned+actual → still readable (define exact rule in spec).

### 3) Update functional spec + technical spec

**Planned deliverables:**

1. **Functional spec additions**
   - Double bank definition (capacity on master jetty).
   - **Schematic:** one box per berth position; labels `JettyId-NN`; vacant vs occupied rules.
   - **Schedule:** mapping rules for lanes `01..N`; how planned/actual display interacts with lanes.
   - **Shifting out:** user story, states, list/schematic/schedule behaviour (link to existing PRD notes).
   - **Acceptance criteria** and negative cases (over capacity, shifted vessel, etc.).

2. **Technical spec additions**
   - API: `GET /allocation/overview` — `berths[].capacity`, `occupants[]` shape and **ordering** contract for lane assignment.
   - DB fields: `jetties.capacity`, `operations.shifting_out`, timestamps (reference migrations).
   - Frontend components: `JettySchematic`, `JettyScheduleGantt`, `Allocation` modals — responsibilities after refactor.
   - **Risk / edge cases:** same jetty, same ETA, missing TB, refresh timing, document keys `op-*` vs `si-*` for photos.
   - **Jetty Layout:** `GET/PUT /jetty-layout` (or equivalent) scoped to active port; requirement that **Schematic** consumes persisted layout everywhere it is shown (Allocation, Dashboard); fallback when no layout row exists.

**Suggested filenames (when written):**

- Extend existing `Docs/FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md` **or** add `Docs/FUNCTIONAL-SPEC-Double-Bank-and-Shifting-Out.md`.
- Add or extend `Docs/TECH-SPEC-...` (or a short `Docs/TECH-NOTES-Double-Bank.md`) for API + UI contracts.
- Consider a short **Jetty Layout** subsection: editor saves → schematic renders — acceptance criteria and troubleshooting (port mismatch, empty layout).

---

## Open questions to confirm with you before implementation

1. **Lane assignment rule:** When two vessels share a jetty, should **01** always be “first berthed” (earliest TB) and **02** second, or fixed by operation id, or drag-order?
2. **Planned vs Actual on schedule:** Must they stay in the **same** lane as two thin rows, or is two stacked bars in one lane acceptable?
3. **Schematic empty slots:** Show **Vacant 01 / Vacant 02** explicitly when capacity is 2 and only one vessel is in?
4. **Jetty Layout:** Should Dashboard and Allocation always share **identical** schematic layout for the same port, with no separate “local” override?

---

## Status

| Item                         | Status        |
|-----------------------------|---------------|
| Schematic one-box-per-vessel | Planned       |
| Schedule 01 / 02 split      | Investigate + fix planned |
| Functional + tech spec      | Outline above; full doc next session |
| Shifting out                | Not tested yet |
| Jetty Layout → Schematic    | Save OK; schematic reflection not verified / likely wiring gap |

---

*End of summary — safe to continue from this document in the next working session.*
