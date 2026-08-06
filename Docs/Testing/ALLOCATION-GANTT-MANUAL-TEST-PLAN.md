# Allocation & Jetty Schedule — Manual Test Plan

Consolidated manual test scenarios for **Allocation & Berthing** and the **Jetty Schedule Gantt**, merged from ad-hoc review notes and aligned with the current `sit` branch behaviour (unified schedule lane, drag-to-reschedule, dense bar layout, full-chart JPEG export).

**Related artifacts**

| Document | Purpose |
|----------|---------|
| [JPS-Test-Scenarios.docx](./JPS-Test-Scenarios.docx) | Broader functional scenarios (all modules) |
| [JPS-Test-Execution-Report.docx](./JPS-Test-Execution-Report.docx) | Prior execution report with screenshots |
| [execution-results.json](./execution-results.json) | Automated / semi-automated smoke results |
| [verify-results.json](./verify-results.json) | Post-fix verification results |

**Target branch:** `sit` (e.g. `10c73b7` — unified Gantt lane + drag-to-reschedule)

---

## 1. Prerequisites

| Item | Local dev | Staging |
|------|-----------|---------|
| App URL | http://localhost:5173/ | App server (e.g. `.56:3080`) |
| API | http://127.0.0.1:3000 (Vite proxy) | Via nginx `/api/v1` |
| Login | Local admin from `Backend/.env` / seed | Staging credentials |
| Primary route | `/allocation` | Same |
| Port scope | Select the port under test in the header | Same |

**Environment notes**

- Example vessel names in informal test notes (e.g. *BG As Warrior 2*, *MT Bintang Mas HSB 6*, jetty *1B-01*) are **environment-specific**. Use any local row that satisfies the **condition** described in each case (long name, late ETC, free jetty, etc.).
- Default date range after **Reset** follows the port schedule timezone and current month (e.g. July 2026 → roughly `01/07/2026` – `31/07/2026`). Confirm exact values in the UI rather than assuming fixed strings.

---

## 2. Gantt legend (current `sit`)

| Visual | Meaning |
|--------|---------|
| Orange / estimate styling | Planned bar — *Estimate (no actual yet)* |
| Blue / actual styling | Actual milestones (berthing → ops → clearance) |
| Red / breach styling | Late past ETC (`LATE +Xd Xh`) |
| Grey / muted | Sailed off |
| Red vertical line | **Now** |

**Removed:** separate Planned / Actual **layer toggle**. The chart uses a **unified lane** — one bar per vessel state (estimate hidden once actual milestones exist).

Locale keys: `Frontend/src/locales/en/allocation.json` (`ganttLegend*`).

---

## 3. Test cases

### Section A — Jetty Schedule Gantt (visual + time)

#### A1 — “Now” line accuracy

**Objective:** The red **Now** line aligns with the current system date and time.

**Steps**

1. Open **Allocation & Berthing**.
2. Set **From** / **To** so today falls inside the window.
3. Locate the red vertical **Now** line on the Gantt.

**Pass**

- Line visible when today is in range.
- Horizontal position matches current clock time (spot-check: midday ≈ mid-day column on a day-scale view).

**Fail**

- Line missing while today is in range, or offset by hours/days.

---

#### A2 — Status color-coding

**Objective:** Bars match the legend (estimate, actual, late, sailed).

**Steps**

Find (or closest available) one example of each:

| Type | How to find |
|------|-------------|
| Estimate only | Approved plan, no TA/TB |
| Actual | Vessel with TA or TB logged |
| Late | Active alongside, ETC in the past |
| Sailed off | Completed / sailed vessel in range |

**Pass**

- Colors match Section 2 legend.
- Sailed bars greyed/muted.
- Late bars show breach chip (`LATE +…`).

**Fail**

- Wrong styling for state, or duplicate conflicting bars for the same vessel.

---

#### A3 — Dense block text and overflow

**Objective:** Long vessel names, dates, and commodity/qty lines render without breaking layout.

**Steps**

1. Pick a bar with a long vessel name and cargo line.
2. Test at wide and narrow bar widths (zoom date range or pick short-duration berth).

**Pass**

- Vessel name truncates with ellipsis; no overlap with jetty label column.
- Date lines readable at medium width; truncated gracefully when narrow.
- Hover tooltip shows full milestones and cargo detail.

**Fail**

- Text overlaps adjacent rows, clips jetty column, or breaks bar height.

---

#### A4 — Late duration calculation

**Objective:** `LATE +Xd Xh` reflects time past ETC.

**Steps**

1. Select a vessel flagged late on the Gantt or queue.
2. Compare chip duration to ETC vs current time.

**Pass**

- Duration approximately correct (±30 minutes acceptable; drag logic snaps to 30-minute steps).

**Fail**

- Missing late flag when ETC passed, or grossly wrong duration.

---

#### A5 — Unified lane (no duplicate estimate + actual)

**Objective:** Vessels with actual milestones show a single actual bar, not stacked estimate + actual.

**Steps**

1. Find a vessel with plan dates **and** logged TA/TB.
2. Find a transit-only row (TA, no TB).

**Pass**

- One **actual** bar when milestones exist; estimate bar suppressed.
- Transit-only shows actual transit bar, not estimate.

**Fail**

- Duplicate bars for the same vessel/jetty lane.

---

#### A6 — Drag-to-reschedule — move

**Objective:** Horizontal drag updates the correct date fields with confirmation.

**Steps**

1. Drag an **estimate** bar → confirm dialog offers **Estimation (ETA / ETB)**.
2. Drag an **actual** bar → dialog offers **Actual (TA / TB)**; jetty change if dropped on another row.
3. Apply a small shift (e.g. +1 hour) and save.
4. On a **plan-only** row, confirm actual choice is disabled or explained.

**Pass**

- Drag badge shows snapped delta (30-minute steps).
- After save, bar and grid dates update; no duplicate bars.
- Cancel leaves chart unchanged.

**Fail**

- Drag ignored, silent save failure, or wrong fields updated.

**Code reference:** `Frontend/src/utils/ganttDragProposal.js`, `JettyScheduleGantt.jsx`.

---

#### A7 — Drag-to-reschedule — resize

**Objective:** Resize bar edges maps to the correct milestone fields.

**Steps**

1. **Alongside bar:** drag **left** edge (start) and **right** edge (end).
2. **Transit bar:** drag start edge.

**Pass**

- Start resize on alongside bar → ETB/TB (or ETA/TA on transit).
- End resize → new estimated completion from bar end.
- Confirmation modal labels match chosen operation before save.

**Fail**

- Resize changes unrelated fields or saves without confirmation.

---

#### A8 — Full-view / popout

**Objective:** Popout visualization shows the same schedule with usable scroll/zoom.

**Steps**

1. From Allocation, open **full-view / popout** (if control visible).
2. Compare data with inline Gantt.

**Pass**

- Larger viewport; same vessels/jetties/dates; scroll works.

**Fail**

- Empty popout, stale data, or broken layout.

---

### Section B — Date filtering and export

#### B1 — Date boundary constraints

**Objective:** From/To filters drive the chart; invalid ranges handled safely.

**Steps**

1. Set range to current month → note vessels shown.
2. Set future-only range → empty or future rows only.
3. Set historical range → past sailed/at-berth rows as applicable.
4. Set **From** later than **To**.

**Pass**

- Chart updates immediately for valid ranges.
- Invalid range shows error or empty state; no browser crash.

**Fail**

- Stale chart, JS error, or silent wrong data.

---

#### B2 — Reset

**Objective:** Reset restores default month view.

**Steps**

1. Change **From** / **To** away from default.
2. Click **Reset**.

**Pass**

- Filters return to default month for the active port/timezone.

**Fail**

- Partial reset or wrong month boundaries.

---

#### B3 — JPEG export fidelity

**Objective:** Export captures the **full** chart, not only the visible viewport.

**Steps**

1. Load a multi-jetty chart with several rows (scroll if needed).
2. Click **Export JPEG**.
3. Open downloaded image.

**Pass**

- Full width and height of schedule (all jetty rows and time columns).
- Legend and filters visible; text readable.
- File downloads without error.

**Fail**

- Cropped to viewport only, blurry unusable text, or export error.

**Note:** Full-chart export fix landed on `sit` (`fix(gantt): JPEG export now captures the full chart`).

---

### Section C — Shipment plans queue

Route: **Allocation** incoming / planned tables and/or **Allocation Plans** (`/allocation-plans`) as applicable.

#### C1 — Sequence reorder (↑ / ↓)

**Objective:** Berthing sequence changes persist.

**Steps**

1. Use **↑** or **↓** on an incoming/planned row.
2. Refresh the page.

**Pass**

- Sequence numbers swap; order unchanged after refresh.

**Fail**

- Visual-only reorder without API persist.

---

#### C2 — Inline column filtering

**Objective:** Vessel and jetty filters work with partial matches.

**Steps**

1. Filter vessel with partial string (e.g. `"Mel"`).
2. Filter jetty similarly.
3. Clear filters.

**Pass**

- Real-time filtering; partial match; clear restores all rows.

**Fail**

- Case-sensitive breakage or filter stuck after clear.

---

#### C3 — Hyperlink navigation

**Objective:** Plan ref and SI links open correct detail views.

**Steps**

1. Click a **Plan ref** (e.g. `SP-26-…`).
2. Click a **Shipping Instruction** number.

**Pass**

- Correct modal or detail page; no 404; back navigation OK.

**Fail**

- Wrong record or broken route.

---

### Section D — Operational workflow actions

#### D1 — Log arrival update

**Objective:** TA (and related fields) save and reflect on Gantt.

**Steps**

1. Click **Log arrival update** on an incoming vessel.
2. Enter **Actual Time of Arrival (TA)**; save.

**Pass**

- Validation on required fields; save succeeds.
- Gantt shows actual/transit bar; row phase updates.

**Fail**

- Modal error, no Gantt update, or wrong timestamps.

---

#### D2 — Berthing transition

**Objective:** Berthing moves vessel to berthed state and creates Gantt block.

**Steps**

1. Click **Berthing** for a vessel on an **available** jetty.
2. Complete TB and any required photos/remarks; save.

**Pass**

- Row moves to berthed / at-berth.
- Gantt shows actual bar on correct jetty row.
- Jetty schematic occupancy updates.

**Fail**

- Stuck in incoming queue or bar on wrong jetty.

---

#### D3 — Berthing blocked (negative paths)

**Objective:** Invalid berthing shows explicit feedback.

**Steps**

Try berthing when:

- Jetty is **Out of Service**, or
- **Late SI** gate applies (if such a row exists).

**Pass**

- Button disabled with reason, or clear error message.

**Fail**

- Silent failure or berth saved despite block.

---

### Section E — Edge cases and business logic

#### E1 — Double-booking block

**Objective:** Two vessels cannot occupy the same sub-jetty at overlapping times.

**Steps**

1. Berth vessel A on sub-jetty X at time T.
2. Attempt vessel B on the same sub-jetty overlapping T.

**Pass**

- Validation error / conflict message; second berth not saved.

**Fail**

- Both shown alongside on same jetty without warning.

---

#### E2 — Zero cargo state

**Objective:** Zero or empty cargo does not break UI or math.

**Steps**

Use a plan/SI with **0 MT** or empty breakdown.

**Pass**

- Grid and Gantt render; qty shows empty or em dash; no console errors.

**Fail**

- `NaN`, layout break, or failed save.

---

#### E3 — Massive date range

**Objective:** Very wide ranges do not freeze the browser.

**Steps**

Set **From** / **To** spanning ~2 years.

**Pass**

- UI remains responsive; horizontal scroll acceptable; loading indicator if slow.

**Fail**

- Tab hang or crash.

---

#### E4 — Drag cancel / no-op

**Objective:** Cancelled or zero-move drags do not call the API.

**Steps**

1. Start drag; release with no movement.
2. Open confirm modal; cancel.

**Pass**

- Chart unchanged; no error toast unless user attempted invalid save.

---

#### E5 — Sailed / cast-off display

**Objective:** Sailed vessels display correctly in historical and today views.

**Steps**

1. Filter to a day when a vessel had cast-off.
2. View same vessel on **today** if applicable.

**Pass**

- Sailed bar greyed in history; not shown as active alongside after cast-off on today view.
- Tooltip end milestone matches cast-off / sailed time.

---

### Section F — Quick smoke (cross-module)

Run once per session before deep Allocation testing.

| ID | Check | Route |
|----|-------|-------|
| F1 | Login / logout | `/login` |
| F2 | Dashboard loads | `/` |
| F3 | Allocation page loads | `/allocation` |
| F4 | At-berth list loads | `/loading` or `/unloading` |
| F5 | i18n | Switch **ID** on Allocation — labels change |

Prior automated baseline: [execution-results.json](./execution-results.json).

---

## 4. Recommended execution order

1. F1–F3 — login and Allocation load  
2. B1–B2 — date filters  
3. A1–A5 — Gantt visual sanity  
4. C1–C3 — queue  
5. D1–D2 — arrival + berthing (creates data for drag tests)  
6. A6–A7 — drag-to-reschedule  
7. B3 — JPEG export  
8. D3, E1–E5 — negative paths and edge cases  

---

## 5. Pass/fail log template

Copy when executing:

```text
| ID  | Scenario              | Pass/Fail | Tester | Date       | Notes |
|-----|-----------------------|-----------|--------|------------|-------|
| A1  | Now line              |           |        |            |       |
| A2  | Colors                |           |        |            |       |
| A3  | Text overflow         |           |        |            |       |
| A4  | Late duration         |           |        |            |       |
| A5  | Unified lane          |           |        |            |       |
| A6  | Drag move             |           |        |            |       |
| A7  | Drag resize           |           |        |            |       |
| A8  | Popout                |           |        |            |       |
| B1  | Date boundaries       |           |        |            |       |
| B2  | Reset                 |           |        |            |       |
| B3  | JPEG export           |           |        |            |       |
| C1  | Sequence reorder      |           |        |            |       |
| C2  | Column filters        |           |        |            |       |
| C3  | Hyperlinks            |           |        |            |       |
| D1  | Log arrival           |           |        |            |       |
| D2  | Berthing              |           |        |            |       |
| D3  | Berthing blocked      |           |        |            |       |
| E1  | Double-booking        |           |        |            |       |
| E2  | Zero cargo            |           |        |            |       |
| E3  | Massive date range    |           |        |            |       |
| E4  | Drag cancel           |           |        |            |       |
| E5  | Sailed display        |           |        |            |       |
```

Store completed logs and screenshots under `Docs/Testing/` (e.g. append to execution report or add `allocation-gantt-results-YYYY-MM-DD.json`).

---

## 6. Automated unit test coverage (related)

Frontend unit tests (run from `Frontend/`):

```bash
npm test
```

Relevant suites for this plan:

- `ganttDragProposal.test.js` — drag move/resize proposals (A6, A7, E4)
- `ganttBarDisplay.test.js` — dense block models (A3)
- `jettyScheduleGanttLanes.test.js` — segment building, lane packing (A5)
- `actualGanttPhases.test.js` — phase strips and overdue (A2, A4)

These do **not** replace manual UI verification for export, drag UX, and berthing workflows.

---

## 7. Revision history

| Date | Author | Notes |
|------|--------|-------|
| 2026-07-06 | Consolidated from review + `sit` Gantt redesign | Initial markdown version |
