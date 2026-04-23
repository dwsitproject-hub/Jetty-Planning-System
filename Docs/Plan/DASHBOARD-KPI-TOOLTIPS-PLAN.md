# Plan — Dashboard KPI interactive tooltips

**Status:** planned  
**Last updated:** 2026-04-08  
**Owner:** Product + Engineering

---

## 1. Purpose

Add “Port Activity–style” interactive tooltips (portal + positioned popover) to key Dashboard widgets so users can drill into **what** drives a KPI without leaving the Dashboard.

Widgets in scope:

1) **Slot occupancy**  
2) **Jetty status** (Available / Out of Service)  
3) **SLA at risk** (KPI card)

---

## 2. UX requirements (must match Port Activity tooltip quality)

- **Mouse + keyboard**: hover and focus open; mouse leave and blur close.
- **Dismiss**: closes on **scroll**, **resize**, and **Escape**.
- **No clipping**: tooltip rendered using a **portal** to `document.body`.
- **Positioning**: anchored to the trigger via `getBoundingClientRect()`; clamps to viewport; flips left/right when needed.
- **Readable**:
  - max width ~280px
  - internal scroll when list is long (max height ~200px)
- **Non-intrusive**: tooltip should not block primary click navigation; triggers should be explicit (small “Details”/chip button) or the entire KPI can be the trigger only when it doesn’t conflict with an existing navigation link.

---

## 3. Tooltip content rules

### 3.1 Slot occupancy

Trigger: Slot occupancy KPI (recommended: small “Details” button next to label/value).

Tooltip shows a list of occupied slots:

- `<slotLabel> — <vesselName>`

Where:
- `slotLabel = <jettyId>-<lane>` e.g. `1A-01`, `1A-02`
- `vesselName` from berth occupant (fallback to vessel id if missing)

Data source: `GET /allocation/overview` → `berths[]` → `occupants[]` and `capacity`.

### 3.2 Jetty status

Triggers: Each chip in the KPI card:

- Available → list of available jetties
- Out of service → list of OOS jetties

Tooltip list item: `<jettyShortId>` (or `name` if needed).

Data source: `GET /jetties?port_id=...` (already loaded on Dashboard).

### 3.3 SLA at risk

Trigger: SLA at risk KPI.

Tooltip list items mirror the “SLA & schedule risk” card:

- `<vesselName>`
  - sub: `<jettyName>` · `+<overHours>h over ETC`

Data source: operations list (`fetchOperations()`), derived list `slaAtRisk`.

---

## 4. Implementation approach (recommended)

Create a shared tooltip component to avoid copy/paste:

- `Frontend/src/components/InteractiveTooltip.jsx`

Responsibilities:
- Manage open/close state (controlled or internal)
- Register scroll/resize listeners to close
- Handle Escape key
- Measure trigger rect and compute position + flip
- Render via `createPortal(document.body)`

Styling:
- Reuse the existing Port Activity tooltip CSS style (white card, shadow, arrow).
- Add new CSS classes under `Frontend/src/styles/dashboard.css`.

---

## 5. Acceptance criteria

- **Slot occupancy tooltip**
  - Shows slot labels (`<jetty>-01`) and vessel names for occupied slots.
  - Opens/closes correctly and is keyboard accessible.
- **Jetty status tooltip**
  - Available chip shows only Available jetties; OOS chip shows only OOS jetties.
  - Lists are sorted consistently (by master order if available, otherwise alphanumeric).
- **SLA at risk tooltip**
  - Shows vessel + jetty + “+Xh over ETC” for each item in the risky list.
- **UX quality**
  - No clipping; stable position; flip/clamp works.
  - Closes on scroll/resize/Escape.
  - No flicker when moving pointer between trigger and tooltip (small close delay allowed).

---

## 6. Spec updates (after implementation)

- **Functional spec**: describe new KPI tooltips and their content.
- **Tech spec**: document component reuse / portal tooltip pattern and data sources used.

