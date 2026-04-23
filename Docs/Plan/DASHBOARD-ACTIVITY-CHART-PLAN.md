# Dashboard — activity chart & weather placement

**Overall status:** **Delivered** — core chart, weather placement, Y-axis + grid, hover tooltips with vessel names, and specs updated (**Functional 1.18**, **Tech 1.16**).

**Scope (original):** Replace the top-left weather slot with a data chart; move weather to the bottom.

---

## 0. Status: what is applied vs documented

Use this table for traceability to **product docs** and **code**.

| Deliverable | In codebase | In **Functional** spec | In **Tech** spec |
|-------------|-------------|-------------------------|------------------|
| Weather moved to **bottom** of dashboard; mock + “coming soon” overlay | Yes (`Dashboard.jsx`, `dashboard-weather-footer` in `dashboard.css`) | Yes — **§2.7** row *Dashboard — weather*; history **1.17** | Yes — **§2.3** (weather bullet); **§3.7** (mock until live API) |
| **Port activity** card: **Operations** / **Shipping instructions** toggle | Yes (`DashboardActivityChart.jsx`) | Yes — **§2.7** row *Dashboard — Port activity* | Yes — **§2.3** Port activity chart bullets |
| Mode A: queue rows, Loading/Unloading × Planned berthing/Berthing, per-purpose % | Yes | Covered by same **§2.7** row (behaviour) | Yes — classification via `dashboardQueueClassification.js` in **§2.3** |
| Mode B: SI status buckets Approved / Submitted / Draft, % of total SIs | Yes | Same **§2.7** row | Same **§2.3** |
| Shared queue classification (`isPlannedBerthingQueueRow`, `isQueueRowBerthing`, purpose normalisation) | Yes | Implied in **§2.7** (shifting out, pipeline alignment) | Yes — **§2.3** |
| Implementation map (file paths) | — | **§7** table (*Dashboard slot KPI, Port activity chart…*) | **§2.3** lists key files + `dashboard.css` classes |
| **Y-axis:** numeric scale + horizontal grid lines aligned to bar height | Yes (`DashboardActivityChart.jsx`, `dashboard.css`) | Yes — **§2.7** *Dashboard — Port activity*; history **1.18** | Yes — **§2.3** presentation bullet |
| **Hover tooltip:** popover with count + label + **list of vessel names** per bar | Yes (`createPortal`, focus + hover) | Same **§2.7** row | Same **§2.3** |

**Spec file pointers**

- **Functional:** `Docs/FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md` — **§2.7**; history **1.18** (2026-04-08).
- **Technical:** `Docs/TECH-SPEC-Jetty-Planning-System.md` — **§2.3**; header version **1.16** (Last updated 2026-04-08).

---

## 1. Goals

| Item | Decision |
|------|----------|
| **Chart** | One chart at a time; user picks the **dataset** via a toggle (not multiple datasets in one view). |
| **Counts + %** | Each segment shows **absolute count** and **percentage** (see §4 for % rules). |
| **Placement** | **Chart** occupies the current **weather** position (left column of top row, `dashboard-row1`). |
| **Weather** | **Moved to bottom** of the dashboard; remains mock / “coming soon” until live API exists. |
| **Right column** | Existing **KPI grid** (slot occupancy, at berth, ready to sail, SLA at risk) unchanged in role. |

---

## 2. Toggle modes

| Mode | Label (example) | What the chart shows |
|------|-----------------|----------------------|
| **A — Operations / pipeline** | “Operations (Loading / Unloading)” | Grouped bars: **Loading** and **Unloading** as main categories; **Planned Berthing** vs **Berthing** as series (§3). |
| **B — Shipping instructions** | “Shipping instructions” | **Approved** \| **Submitted** \| **Draft** — three categories (bars or equivalent) with counts and % (§5). |

---

## 3. Mode A — Operations (aligned with Vessel pipeline)

### 3.1 Data source and unit of count

- **Source:** Allocation overview **`queue`** (same payload the dashboard already loads via `fetchAllocationOverview`), **port-scoped**.
- **Unit:** **Queue rows** (same mental model as **Vessel pipeline**), not a separate ad-hoc definition.
- **Rationale:** Parity with pipeline counts and `isPlannedBerthingQueueRow` (or equivalent rules used there).

### 3.2 Classify each row

1. **Purpose** — **Loading** vs **Unloading** from the row (same field the pipeline / SI purpose uses).
2. **Stage** — **Planned Berthing** vs **Berthing**:
   - **Planned Berthing:** jetty assigned, not yet alongside — same logic as **planned berthing** in the pipeline (e.g. `isPlannedBerthingQueueRow`: has jetty, no TB, operation status not in alongside set).
   - **Berthing:** alongside / at berth — TB set or status in **DOCKED / IN_PROGRESS / COMPLETED** (and consistent with **shifting_out** handling used in overview / occupancy so shifted vessels are not counted as occupying a berth incorrectly).

**Edge cases:** Unknown purpose → **“Unknown”** bucket or exclude with a footnote; document if any queue row falls outside both stages.

### 3.3 Chart type — grouped bars (Option 2), **Loading vs Unloading as main POV**

- **Primary categories (X-axis / groups):** **Loading** \| **Unloading**.
- **Series (two bars per group):** **Planned Berthing** \| **Berthing**.
- **Visual:** For Loading: side-by-side bar “Planned Berthing”, bar “Berthing”. Same for Unloading.
- **Legend:** Series = Planned Berthing, Berthing (consistent colours across both groups).

### 3.4 Percentages (recommended)

- **Per purpose (main POV):** For **Loading**, % of Planned and % of Berthing are shares of **all Loading-classified rows** (Planned + Berthing = 100% for Loading). Same for **Unloading**.
- **Alternative (grand total):** Every bar’s % is share of **all four counts** — only if product explicitly wants a single denominator; label clearly.

**Display:** Show **count** on or beside each bar; show **%** per the chosen rule in subtitle or tooltip.

---

## 4. Shared implementation rules

- **Toggle** switches entire dataset; no mixing Mode A and Mode B in one chart.
- **Empty states:** e.g. “No queue data for this port” / “No shipping instructions for this port.”
- **Accessibility:** Meaningful title, `aria-label` or table fallback summarising counts.
- **Shared helper:** Extract **Planned Berthing** vs **Berthing** classification next to existing pipeline helpers so **Vessel pipeline**, KPIs, and this chart do not drift.

---

## 5. Mode B — Shipping instructions

### 5.1 Buckets

| Bucket | Rule |
|--------|------|
| **Approved** | `status === 'Approved'` |
| **Submitted** | `status === 'Submitted'` |
| **Draft** | `status === 'Draft'` |

### 5.2 Denominator and display

- **Denominator:** Total SIs returned for the **selected port** (same scope as `GET /shipping-instructions` with port context).
- **Chart:** Three bars (or three segments) with **count** and **% of total** (all three sum to 100%).
- **Zero counts:** Show 0 or omit bar with legend note — choose at build time for clarity.

---

## 6. Layout summary

```
[ Header / port chip / API banner ]

Row 1:
  [ Activity chart card — toggle + grouped/SI chart ]  [ KPI grid ]

[ Vessel pipeline ]
[ … rest of dashboard … ]
[ Sidebar if present ]

Bottom:
  [ Weather card — mock, coming soon ]
```

**CSS:** Repurpose `dashboard-row1__weather` width for the chart card; add a footer row class for weather; adjust `dashboard.css` for responsive behaviour.

---

## 6b. Weather widget — move to bottom (**mandatory — do not skip**)

Weather is **not** removed; it is **relocated** so the top row is reserved for operational KPIs + the new activity chart. This work is **part of the same delivery** as the chart (step 1 in §7).

### Objective

- **Remove** the weather card from **`dashboard-row1`** (it currently sits left of the KPI grid).
- **Render** the same weather UI **once**, at the **bottom** of the dashboard page (after pipeline, main grids, and sidebar content — order can match final visual priority; default: **last section before end of page**).
- **Preserve** current behaviour: mock data (`dashboardWeather`), **“Preview data — live API connection coming later.”**, and the **“Widget is in progress - Coming Soon”** overlay.

### Implementation checklist

- [x] In `Frontend/src/pages/Dashboard.jsx`, **cut** the weather block (`weather-card-wrap`, `weather-card`, overlay) from inside `section.dashboard-row1`.
- [x] **Paste** that block into a **new** wrapper at the **bottom** of the dashboard root (e.g. `section.dashboard-weather-footer` or `footer.dashboard-weather`) so it is **not** inside `dashboard-row1`.
- [x] Ensure **only one** weather instance exists (no duplicate in DOM).
- [x] In `Frontend/src/styles/dashboard.css` (and any row1 rules):
  - [x] **Row 1** grid: left column is for the **activity chart** only; remove or repurpose `dashboard-row1__weather` so it no longer reserves space for weather (rename class if useful, e.g. `dashboard-row1__chart`).
  - [x] **Footer weather**: full width (or max-width aligned with dashboard); sensible vertical spacing above/below; readable on **narrow** viewports (stack, no horizontal overflow).
- [x] **Regression:** With port selected, confirm KPI grid still lays out correctly; with no port, behaviour unchanged except weather at bottom.

### Acceptance criteria

- Weather appears **only** at the **bottom** of the dashboard.
- Top row left slot is ready for (or already contains) the **activity chart** card.
- Overlay and copy unchanged; no console errors.

---

## 7. Implementation order

1. **Weather → bottom** — complete **§6b** (move JSX + CSS); verify desktop and narrow layouts. **Done.**
2. Add **chart card** shell + **toggle** in the former weather / new left column (no data yet). **Done** (`DashboardActivityChart.jsx`).
3. Implement **Mode A**: queue → classify → grouped bars (Loading/Unloading × Planned/Berthing) + counts + per-purpose %. **Done.**
4. Implement **Mode B**: SI list → Approved / Submitted / Draft + counts + %. **Done.**
5. Tooltips, empty states, loading — initially native `title`; superseded by **§10** custom tooltip. Empty copy + dashboard `loading` unchanged. **Done.**
6. **TECH-SPEC / FUNCTIONAL-SPEC** — definitions and dashboard workflow updated for **§0** table above. **Done.**
7. Y-axis count scale + dashed grid lines (both modes). **Done.**
8. Custom hover/focus tooltip + vessel name lists per bar. **Done** (keyboard focus supported; `aria-label` on bar buttons).

---

## 8. Out of scope (this iteration)

- Live weather API (separate plan).
- Commodity breakdown (replaced by SI status mode).
- Operations-only counting without queue parity (explicitly not chosen — queue rows preferred for Mode A).

---

## 9. References (code)

- `Frontend/src/pages/Dashboard.jsx` — `queue`, `isPlannedBerthingQueueRow`, `PIPELINE_STAGES`, weather block.
- `Frontend/src/api/allocation.js` — `fetchAllocationOverview`.
- `Frontend/src/api/shippingInstructions.js` — list for Mode B.

---

## 10. Y-axis and interactive hover tooltips

**Status:** **Implemented**; described in **Functional §2.7** and **TECH §2.3** (versions **1.18** / **1.16**).

### 10.1 Y-axis (count scale + grid)

- **Integer** tick labels on the **left** with step derived from data max (~4 intervals).
- **Horizontal dashed** grid lines at each tick; bar height uses shared **`yMax`** scale.

### 10.2 Hover tooltip

- **Popover** (`react-dom` `createPortal` to `document.body`): large count, series label, context, % line, scrollable vessel list.
- **Mode A:** names from queue rows matching the bar (`vesselName` → `vesselId` → `—`).
- **Mode B:** names from SIs in each status bucket (same fallbacks).
- **Styling:** white card, shadow, triangular pointer (flips when tooltip would clip the left edge).
- **Zero-height bars:** not interactive; no tooltip.

### 10.3 Implementation checklist (§10)

- [x] Series builders return **name lists** per segment (`vessels` alongside `counts`).
- [x] Chart layout: Y-axis + grid + bars share one vertical scale (`BAR_MAX_PX` plot height).
- [x] Tooltip state + `getBoundingClientRect` positioning; CSS in `dashboard.css` (`.dashboard-activity-chart__tooltip*`).
- [x] **Functional §2.7** and **TECH §2.3** updated; spec versions / history bumped.

---

## 11. Document history (this plan file)

| Date | Notes |
|------|--------|
| 2026-04-08 | Core chart + weather (Functional **1.17**, Tech **1.15**); then **§10** Y-axis + hover tooltips + vessel lists (Functional **1.18**, Tech **1.16**). **§0** traceability table kept current. |
