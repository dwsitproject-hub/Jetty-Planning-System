# Jetty Planning System (JPS) — Mockup Plan & Proposal

**Version:** 0.1  
**Date:** 2026-03-03  
**Scope:** Front-end mockup only (no database, no backend)

---

## 1. Approach & Tech Stack

| Choice | Recommendation | Rationale |
|--------|----------------|-----------|
| **Framework** | **React + Vite** | Fast dev, component reuse, easy to add routing and mock state; single codebase for web + responsive mobile. |
| **Styling** | **CSS (with design tokens as variables)** | Tokens from `Assets/design-tokens.json` mapped to CSS custom properties; no heavy UI library so we keep full control over the industrial look. |
| **Routing** | **React Router** | Client-side navigation between all flows; no server required. |
| **Data** | **In-memory mock data (JS/JSON)** | Hardcoded or imported JSON for vessels, berths, nominations, line-up, quality, dry cert; state in React (e.g. `useState`/context) so the UI is interactive but nothing persists. |
| **Fonts** | **Inter + Merriweather** | Per design tokens: Inter for UI, Merriweather for key headings. |

**Deliverable:** One responsive web app that works in browser (desktop/tablet) and on mobile; no build-backend or DB.

---

## 2. Design Token Application

All UI will follow **KPN Downstream Design System** (`Assets/design-tokens.json`):

- **Colors:** Primary actions/CTAs = brand red `#C43A31`, hover `#9E2C25`; text charcoal `#2B2B2B` / steel `#6B6B6B`; backgrounds white / `#F4F4F4` / `#FAFAFA`; borders `#E0E0E0` / `#C4C4C4`.
- **Typography:** Inter (UI), Merriweather (headings); sizes h1 40px → xs 12px; weights 400/500/600/700 as in tokens.
- **Spacing:** 8pt rhythm — 4px, 8px, 16px, 24px, 32px, 40px, 64px for consistency.
- **Borders & elevation:** Prefer borders over heavy shadows; radius sm 6px, md 8px, lg 12px; shadows only sm/md/lg where needed (cards, modals).
- **Motion:** 150–250ms, ease-out only; no bounce or playful animation.
- **Principles:** Industrial clarity, red as accent not dominant, left-aligned layouts, no bright gradients or fintech aesthetic.

Implementation: one **global CSS file** (e.g. `Frontend/src/styles/design-tokens.css`) that defines `--color-*`, `--font-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--duration-*` and is imported at app root.

---

## 3. Responsive Strategy (Web & Mobile)

- **Breakpoints (align with tokens + common devices):**
  - **Mobile:** default (e.g. &lt; 640px)
  - **Tablet:** 640px–1024px
  - **Desktop:** &gt; 1024px

- **Layout:**
  - **Desktop/Tablet:** App shell with **top bar** (logo, nav, user) + **sidebar** (main nav: Dashboard, Nomination, Planning, Operations, Quality, Verification). Main content area scrolls.
  - **Mobile:** Same top bar (compact) + **hamburger menu** that opens a full-screen or drawer **sidebar**; main content full-width; lists/cards stack vertically; primary actions stay thumb-friendly.

- **Components:**
  - Tables → **cards** or **horizontal scroll** on small screens; critical columns kept, detail in expand/drill-down.
  - Forms → single column on mobile; labels above inputs; large tap targets (min 44px).
  - Dashboard berth map → **simplified block view** on mobile (e.g. 5 berths as rows); full “map-like” layout on larger screens.
  - Line-Up (Planning): drag-and-drop on desktop; on mobile, **reorder via up/down** or a simplified “priority” selector.

- **Touch:** Buttons and key controls sized for touch; no hover-only actions; mobile nav and modals use full-screen or bottom sheet where it fits the flow.

---

## 4. Flow Coverage (Nomination → Discharge)

The mockup will implement **one cohesive flow** that touches every stage, with mock data and clear navigation between steps.

| # | PRD stage / User story | Screen(s) | Purpose |
|---|------------------------|-----------|--------|
| 0 | **Dashboard** | **Dashboard** | One-pager: berth occupancy, wait alerts, loss/gain; entry point. |
| 1 | **Ship position / Nomination** | **Nomination** (list + create/view) | Agents submit vessel (Vessel ID, ETA, Qty, CPO Grade); timestamp shown; list of nominations. |
| 2 | **Jetty allocation / Planning** | **Planning (Line-Up)** | View tank levels (mock) + vessel ETAs; drag-and-drop (or mobile reorder) to set berth order; “Line-Up” board. |
| 3 | **Ship docking** | **Operations – Docking** (or part of Operations) | Record actual arrival and connection timestamps; link to a vessel/berth from Line-Up. |
| 4 | **Offloading** | **Operations – Offloading / Palka** | Log pumping + **Palka Cleaning** start/end for up to 15 palkas; mobile-friendly; total cleaning duration calculated. |
| 5 | **Quality** | **Quality** | Per-shipment CPO: FFA, DOBI, IV; **Loading vs Discharge** comparison view. |
| 6 | **Ship discharge / Dry cert** | **Verification (Dry Certificate)** | Surveyor view: mark tanks CLEAN and digitally “sign”; **Vessel Sailed** locked until Dry Cert CLEAN. |

**Navigation:** Sidebar items: **Dashboard | Nomination | Planning | Operations | Quality | Verification.** Optional: breadcrumbs or a “Vessel journey” strip (Nomination → Planning → … → Discharge) on detail views so the full flow is visible.

---

## 5. Dashboard — "Command Center" (Assessment & Specification)

### 5.1 Assessment of the Command Center Design

The proposed **CPO Downstream Jetty Operations Dashboard** is a strong fit for the PRD and for transitioning from Excel/WhatsApp:

| Aspect | Assessment |
|--------|------------|
| **Replaces Excel/WhatsApp** | The four sections map directly to "Line Up Jetty Private," Timesheet/Sounding/Dry Cert, MOM PPIC, and nomination queues—one place instead of many files and chats. |
| **Management visibility** | The **Pain Point Tracker** (Section 3) makes "invisible" issues visible: 8-day wait, demurrage risk, offloading SLA, refinery feedstock—exactly what the PRD asks for. |
| **Role clarity** | Clear value for Developers (data sources), Jetty Master (drag-and-drop in Section 1), and Management (Section 3). Good for stakeholder buy-in. |
| **Flow alignment** | Live Line-Up + Active Vessel Detail + Upcoming Queue cover Nomination → Planning → Operations → Discharge in a single view; aligns with end-to-end flow. |
| **Design token fit** | Industrial, left-aligned, table/card-based layout fits KPN Downstream tokens; alerts (e.g. 8-day wait, Loss/Gain) can use brand red as accent. |
| **Responsive** | Section 1 (5 berths) can stack or scroll horizontally on mobile; Section 2 as cards; Section 3 as compact alert list; Section 4 table → cards or horizontal scroll. |

**Recommendation:** Adopt this as the **canonical dashboard layout** for the mockup. Below is the formal specification.

---

### 5.2 Dashboard Layout: Four Sections

**Section 1: Live Line-Up (Top)** — Replaces "Line Up Jetty Private" Excel. One row per berth (or cards on mobile):

- **Jetty 1A | Jetty 1B | Jetty 2A | Jetty 2B | Jetty 3A**
- Each cell: **Current** (Vessel name or VACANT) + **Sub-line** (Next: &lt;vessel&gt; or Status: &lt;phase&gt;).
- **Interactivity:** Click/tap berth → Section 2 shows that berth's Active Vessel (or "No active vessel").

**Section 2: Active Vessel Detail** — From Timesheet, Sounding, Dry Cert (mock). For vessel selected in Section 1 (e.g. BG MULIA VII):

- Table: Operational Metric | Value / Status | Source Document.
- Rows: Current Phase, Total Quantity Discharged, Loss/Gain %, Avg. Pumping Rate, Tank Inspection (e.g. CLEAN).
- Loss/Gain alert → brand red styling.

**Section 3: Pain Point Tracker** — Visibility & SLAs for management:

- Arrival to Berth Wait Time (e.g. 8 Days, with demurrage alert).
- Offloading SLA Progress (e.g. 92% Complete; Target vs Actual hours).
- Refinery Feedstock Alert (e.g. Tank 5102 level + action note).
- Alert styling for wait time and demurrage.

**Section 4: Upcoming Queue** — Replaces MOM PPIC / WhatsApp. Table: Vessel Name | ETA | Product | Qty (MT) | Priority (e.g. HIGH / NORMAL). Responsive: horizontal scroll or cards on mobile.

### 5.3 Interactivity & Design

- Section 1 → Section 2: berth selection drives Active Vessel detail.
- Optional: "Last updated" timer (mock). Design: tokens, 8pt spacing, left-aligned; red for alerts only.

### 5.4 How to Use This Mock-Up with Your Team

- **For Developers:** Section 2 (Active Vessel Detail) shows that data is pulled from three logical sources: Time (Timesheet), Volume (Sounding Report), and Quality (Dry Cert)—useful when defining backend tables and APIs later.
- **For the Jetty Master:** Section 1 (Live Line-Up) replaces typing "After Mulia VII" in Excel; in the full app they would drag-and-drop vessel order in Planning, and the dashboard reflects it here.
- **For Management:** Point to the **"8-day wait"** and demurrage note in Section 3; the message is: *"The system will help us reduce this by optimizing the sequence in Step 2 (Planning)."*

---

- **Hero strip (optional):** Title “Jetty Planning System” + short status line (e.g. “5 berths • 3 vessels in line-up”).
- **Berth map (interactive):** Visual of **5 berths** (e.g. blocks or slots). Each berth shows:
  - Occupied / Available (and vessel name if occupied).
  - Click/tap → **tooltip or small panel** with vessel summary (name, ETA, status).
- **Alerts:** Dedicated **alert area** for:
  - Vessels waiting **&gt; 24 hours** (and optionally &gt; 8 days) with count and link to list.
  - Style: border-left or icon in brand red; clear, scannable.
- **Loss/Gain:** Card or small table: **Aggregated Loss/Gain % for last 10 shipments** (mock numbers); optional sparkline or trend.
- **Quick stats:** e.g. “Nominations today”, “Vessels at anchorage”, “Cleaning in progress” (all from mock data).
- **Interactivity (no backend):**
  - Hover/tap on berth → show vessel details.
  - Alert count/link → navigate to Nomination or Planning.
  - Optional: time-of-day or “Last updated” that updates on timer (mock “live”).
  - Subtle transitions (150–250ms ease-out) when switching views or opening panels.

---

## 6. Mock Data Strategy

- **Single source:** e.g. `Frontend/src/data/mockData.js` (or `.json` + import) containing:
  - **Berths:** 5 items (id, name e.g. Jetty 1A–3A; currentVesselId; nextVesselId for "Next:" in Live Line-Up).
  - **Vessels / Nominations:** id, vesselId, vesselName, ETA, product (CPO/POME/PKE), quantity (MT), priority (HIGH/NORMAL + reason), nominationTimestamp, status; phase label for "Status:" (e.g. Finalizing, Offloading, Loading FAME).
  - **Line-Up:** ordered list of vessel ids and assigned berth; "next" per berth for Section 1.
  - **Active Vessel metrics (Section 2):** currentPhase, totalQuantityDischarged (KG), lossGainPercent, avgPumpingRateMTPerHour, tankInspection (CLEAN/PENDING), source labels.
  - **Pain Point Tracker (Section 3):** arrivalDate, berthDate, waitTimeDays, demurrageAlert; offloadingSlaTargetHours, offloadingSlaActualHours, offloadingSlaPercent; shoreTankId (e.g. 5102), tankLevelCm, feedstockActionNote.
  - **Upcoming Queue (Section 4):** vessels with ETA, Product, Qty (MT), Priority for table.
  - **Tank farm (sounding):** mock tank levels for Planning.
  - **Operations:** docking timestamps, palka cleaning start/end (e.g. 15 palkas per vessel).
  - **Quality:** loading vs discharge specs (FFA, DOBI, IV) per shipment.
  - **Dry cert:** per-vessel status (e.g. CLEAN / PENDING); “signed” flag and timestamp (mock).
  - **Loss/Gain:** last 10 shipments with % (mock).
- **State:** React state (and optionally a small context) will **update in memory** when user:
  - Submits a nomination,
  - Reorders line-up,
  - Logs docking/offloading/palka times,
  - Uploads/saves quality (mock),
  - Marks Dry Cert CLEAN and “signs”.
- **No persistence:** Refresh or closing the tab resets to initial mock data (or a fixed “seed” state).

---

## 7. Step-by-Step Build Order

| Step | Task | Outcome |
|------|------|--------|
| **1** | Init React+Vite app; add React Router; create `design-tokens.css` from `design-tokens.json` and apply to `:root`. | Project runs; tokens available globally. |
| **2** | App shell: Top bar + Sidebar (nav links) + main content outlet; responsive sidebar (drawer on mobile). | Layout works on web and mobile. |
| **3** | Add mock data module (berths, vessels, nominations, line-up, tank levels, operations, quality, dry cert, loss/gain). | All screens can read/write mock state. |
| **4** | **Dashboard (Command Center):** Section 1 Live Line-Up (5 berths, current/next, status); Section 2 Active Vessel Detail (metrics table, driven by berth selection); Section 3 Pain Point Tracker (wait time, SLA, feedstock alerts); Section 4 Upcoming Queue (table); wire to mock data; click berth → update Section 2. | Dashboard matches Command Center spec; appealing and interactive. |
| **5** | **Nomination:** List view + “New nomination” form (Vessel ID, ETA, Qty, CPO Grade); timestamp on submit; list shows mock nominations. | Flow 1 covered. |
| **6** | **Planning (Line-Up):** Tank levels (mock) + vessel ETAs; Line-Up board with drag-and-drop (desktop) / reorder (mobile); assign berth. | Flow 2 covered. |
| **7** | **Operations:** Docking (arrival/connection timestamps) + Offloading (Palka Cleaning for 15 palkas, start/end, duration); mobile-friendly inputs. | Flow 3 & 4 covered. |
| **8** | **Quality:** Form/upload mock for FFA, DOBI, IV; Loading vs Discharge comparison view per shipment. | Flow 5 covered. |
| **9** | **Verification:** Dry Certificate view; mark tanks CLEAN; “Digital sign”; lock “Vessel Sailed” until Dry Cert CLEAN. | Flow 6 covered. |
| **10** | Polish: Responsive pass on all screens; ensure all flows navigable from sidebar; optional breadcrumbs/journey strip; accessibility (focus, labels). | Mockup complete and consistent. |

---

## 8. Out of Scope (This Mockup)

- Real database or API.
- Authentication (optional: simple “Login as Role” dropdown for demo only).
- Real AIS, real tank farm integration, or file upload (quality “upload” can be mock button + predefined values).
- Automated valve control or refinery machinery (per PRD out-of-scope).

---

## 9. Summary

- **What:** Single responsive React (Vite) app, design from `Assets/design-tokens.json`, full flow from Nomination to Discharge with interactive dashboard and in-memory mock data.
- **How:** Design tokens → CSS variables; responsive shell + 6 main sections; mock data + React state for interactivity; build in 10 ordered steps.
- **Result:** A presentable, web and mobile friendly mockup that demonstrates the entire JPS flow and an appealing, interactive dashboard without backend or database.

If you approve this plan, next step is **Step 1** (scaffold project and design tokens). Any changes you want (e.g. fewer/more screens, different dashboard widgets, or tech tweaks) we can adjust before building.
