# Dashboard layout & visualization spec (unified: operations + management)

One scrollable page. Sections below in order. All visualizations use CSS + minimal inline SVG or div-based charts (no chart library required unless you add one later).

---

## 1. Page header
- **Title:** "Dashboard" (remove "WIP").
- **Optional:** Short date/time or "Last updated" if data is fetched.

---

## 2. Weather strip (full width) — **keep current**
- **Visual:** Existing weather card: current condition + temp + wind/humidity; right side = forecast list (day, condition, temp range, rain %).
- **Enhancement:** If `berthingImpact` is true, keep the left-border alert strip (already good).
- **No layout change.**

---

## 3. KPI row (4 cards) — **visual**
- **Layout:** 4 equal-width cards in a row (grid), responsive: 2x2 on small screens.
- **Data:** 
  - **Vessels at berth** (total) — from at-berth operations count.
  - **Berth occupancy %** — existing metric (e.g. 76%). **Visual:** Horizontal bar (filled portion = 76%, rest empty) inside the card.
  - **Avg pumping rate** — existing (e.g. 118 MT/h). **Visual:** Big number + unit; optional small "vs last week" trend (↑ 5% or ↓ 3%) in muted text.
  - **Clearance: Ready to depart** — count. **Visual:** Number + label; link "View" to Clearance page.
- **Style:** Each card: light border, padding, title on top, main value prominent, bar or trend below. Use existing `metric-card` as base; add a `metric-card__bar` for occupancy.

---

## 4. Pipeline (vessel flow) — **strong visual**
- **Title:** "Vessel pipeline" or "From SI to clearance".
- **Data:** Counts per stage: SI (e.g. Draft/Pending) → Allocation (with ETB) → At-Berth (total) → Clearance (Departed).
- **Visual:** **Horizontal pipeline:**
  - One row: 4 stages. Each stage = a "pill" or box with **stage name** and **count** inside.
  - Between stages: arrow (→) or a small connector line.
  - Optional: make each pill clickable (e.g. SI → Shipping Instruction, At-Berth → /at-berth, Clearance → /verification).
- **Fallback:** If counts are hard to get, use placeholder numbers and still show the 4-stage layout so the concept is clear.
- **CSS:** Flexbox or grid; pills same height; use a light background per stage (e.g. SI = blue tint, At-Berth = green tint, Clearance = teal) to differentiate.

---

## 5. Two-column block

### 5a. Left column — **At-Berth & Clearance**
- **Title:** "At-berth now" (or "At-berth snapshot").
- **Data:** Same as At-Berth Executions: 6 counts (Loading Pre-Check / Operational / Post-Check, Unloading Pre-Check / Operational / Post-Check). Plus 2 for Clearance: Ready to depart, Departed.
- **Visual:**
  - **At-berth:** Reuse the **6-card** layout from At-Berth page (two groups: Loading, Unloading; each group 3 phases). Small cards with **phase label + number**. One "View all" button → link to `/at-berth`.
  - **Clearance:** Below the 6 cards, a small row of **2 cards**: "⚓ Ready to depart" (count) and "🚀 Departed" (count). "View" → `/verification`.
- **Result:** Dense but visual; ops sees who is where at a glance; management sees distribution.

### 5b. Right column — **Upcoming queue & Alerts**
- **Top: Upcoming queue**
  - **Title:** "Upcoming queue" or "Next to berth".
  - **Data:** Existing `upcomingQueue` (Vessel, ETA, Product, Qty, Priority).
  - **Visual:** Keep **table** for clarity. Optional: add a **mini timeline** above the table — a horizontal bar with 3–4 vessel names/blocks placed by ETA (e.g. "27/02", "01/03") so it’s visual at a glance. If no timeline, table alone is fine.
- **Bottom: Alerts / Visibility & SLAs**
  - **Title:** "Alerts & SLAs" or "Visibility & SLAs".
  - **Data:** Existing `painPointTracker` (wait time, offloading SLA, feedstock).
  - **Visual:** **List of alert cards** (not plain text):
    - Each item: left = **icon** (⚠️ or ℹ️) + **bold title**; right = value or short message.
    - Use background color by severity (e.g. red tint for demurrage, blue/gray for info).
  - Keep the same content; improve hierarchy and spacing so it’s scannable.

---

## 6. Quick links (optional)
- **Layout:** Full-width strip or a small row under the two-column block.
- **Content:** Buttons or links: "At-Berth Executions" → `/at-berth`, "Allocation & Berthing" → `/allocation`, "Clearance" → `/verification`, "Shipping Instruction" → `/shipping-instruction`.
- **Visual:** Pill buttons or text links with arrow; low emphasis so they don’t compete with the main content.

---

## Layout summary (order top to bottom)

| # | Section            | Width   | Visualization style                          |
|---|--------------------|--------|-----------------------------------------------|
| 1 | Page header        | Full   | Title (+ optional timestamp)                  |
| 2 | Weather            | Full   | Current + forecast (existing)                 |
| 3 | KPI row            | 4 cols | Cards with numbers + occupancy bar + trends   |
| 4 | Pipeline           | Full   | Horizontal 4-stage pills with counts + arrows |
| 5 | Two-column         | 50/50  | Left: 6 at-berth cards + 2 clearance cards; Right: Queue table (+ optional timeline) + Alert cards |
| 6 | Quick links (opt.) | Full   | Row of links                                 |

---

## Responsive
- **Desktop:** 4 KPI cards in one row; pipeline one row; two-column 50/50.
- **Tablet/small:** KPI 2x2; pipeline wrap or scroll horizontal; two-column stack (At-Berth + Clearance on top, Queue + Alerts below).
- **Mobile:** Single column; pipeline can be vertical (stages stacked) or horizontal scroll.

---

## Data sources (for implementation)
- **At-berth counts:** `getAtBerthOperations('Loading')` / `getAtBerthOperations('Unloading')` + phase from `LoadingContext` (same as AtBerthExecutions page).
- **Clearance counts:** Would need same logic as Verification page (Ready vs Departed); if state is only in Verification, use mock counts on dashboard until you lift state or use a shared store.
- **Pipeline:** SI count from mockData; Allocation count from allocation plan length; At-Berth = sum of at-berth vessels; Clearance Departed = from Verification or mock.
- **KPI:** `dashboardMetrics` (berth occupancy, avg pumping rate); vessel count from at-berth; Clearance ready from Verification or mock.
- **Queue & Alerts:** Existing `upcomingQueue`, `painPointTracker`.

---

## How we show the dashboard (visualization choices)

1. **Numbers:** Big and bold for KPIs and pipeline counts; unit and short label underneath.
2. **Proportions:** Berth occupancy = **horizontal progress bar** (e.g. 76% filled, 24% empty).
3. **Flow:** Pipeline = **horizontal stages with arrows**; color or tint per stage.
4. **Distribution:** At-berth = **6 small cards** (same grouping as At-Berth page); Clearance = **2 cards** with icons.
5. **Lists:** Queue = **table** (optionally with a **mini timeline**); Alerts = **icon + title + message** in colored cards.
6. **Trends (optional):** KPI cards can show a small "↑ 5%" or "↓ 3%" in muted text for management.
7. **Links:** "View all" / "View" on pipeline stages, at-berth, and clearance so the dashboard is a **launch pad** into the app.

This keeps everything on **one dashboard**, **maximizes visualization** (bars, pipeline, cards, icons, colors), and serves both **operations** (at-berth, clearance, queue, alerts) and **management** (KPIs, pipeline, occupancy, SLAs).
