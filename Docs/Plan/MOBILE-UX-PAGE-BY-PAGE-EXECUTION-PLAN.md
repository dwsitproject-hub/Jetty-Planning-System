# Mobile UX Page-by-Page Execution Plan

## Objective

Improve mobile usability across the frontend without changing the existing visual identity (brand colors, typography, component style, or desktop information architecture).  
Execution is incremental, page-by-page, with validation at every step.

## Scope and Constraints

- Keep current UI language intact; only responsive behavior and layout adaptation are adjusted.
- Use hybrid responsive behavior:
  - tablet and desktop: existing table-first layout
  - narrow phone: card/list rendering for high-density tables
- Prioritize operational workflows first, then remaining modules.
- No backend schema/API changes are expected for this initiative.

## Definition of Done (Global)

- No horizontal clipping of critical actions on 390px and 430px widths.
- No overlap between content and fixed overlays (activity log, sticky controls, side tabs).
- Filter and action controls remain reachable and understandable with one-hand use.
- Data parity: mobile card rows show the same key information as desktop table rows.
- Desktop behavior remains unchanged.

## Target Viewports and Validation Matrix

- 390x844 (small phone)
- 430x932 (large phone)
- 768x1024 (tablet portrait)
- 1024x1366 (tablet landscape / small laptop)

For each page, validate:
- layout integrity (no overflow/cutoff)
- interaction integrity (buttons, filters, row actions)
- state integrity (loading, empty, populated, expanded rows, modals)
- accessibility basics (focus ring visibility, readable text hierarchy)

## Execution Order

1. Global foundation and shell safety
2. Allocation and Berthing
3. At-Berth Executions
4. Clearance
5. Pre-Checking / Operational / Post-Checking
6. Shipping Instruction
7. Berthing Allocation module
8. Dashboard / Reporting / Offloading
9. Final regression and polish

---

## Step 0 - Global Foundation and Shell Safety

### Files

- `Frontend/src/styles/app.css`
- `Frontend/src/styles/activity-log.css`
- `Frontend/src/components/ActivityLogPanel.jsx`

### Goals

- Standardize responsive tiers and utility behavior.
- Prevent activity log overlap on narrow viewports.
- Make topbar behavior predictable on mobile widths.

### Tasks

- Introduce shared breakpoint conventions in global stylesheet comments/utilities.
- Add content safe-area handling for right-edge fixed controls.
- Switch activity log trigger to a compact mobile pattern on narrow screens.
- Ensure topbar controls wrap with priority (critical actions first).

### Acceptance Criteria

- No content is hidden behind activity log trigger/panel.
- Topbar remains usable without truncated critical actions.
- No desktop regression in shell layout.

---

## Step 1 - Allocation and Berthing

### Files

- `Frontend/src/pages/Allocation.jsx`
- `Frontend/src/styles/allocation.css`
- `Frontend/src/components/JettyScheduleGantt.jsx`

### Goals

- Resolve schedule/filter crowding on phones.
- Apply hybrid table/card behavior to dense vessel plan rows.

### Tasks

- Improve date filter/control wrapping and spacing on small screens.
- Keep gantt/schedule readable with controlled horizontal behavior.
- Add narrow-phone card-row rendering for high-density row content.
- Preserve row actions and row status labels with compact action grouping.

### Acceptance Criteria

- Allocation screen is readable and operable on 390px without clipped controls.
- Mobile card rows preserve data clarity and action availability.
- Tablet and desktop still use existing table-first experience.

---

## Step 2 - At-Berth Executions

### Files

- `Frontend/src/pages/AtBerthExecutions.jsx`
- `Frontend/src/styles/allocation.css`

### Goals

- Make summary cards and vessel list actions mobile-safe.

### Tasks

- Stabilize summary card stacking and spacing.
- Rework filter/action group wrapping for thumb-friendly interaction.
- Introduce hybrid list behavior for vessel table rows on narrow phones.

### Acceptance Criteria

- No compressed/overlapping card blocks.
- Vessel actions remain visible and easy to tap.
- Filters can be used without horizontal panning.

---

## Step 3 - Clearance

### Files

- `Frontend/src/pages/Verification.jsx`
- `Frontend/src/styles/allocation.css`

### Goals

- Remove congestion in operation filter area and action table.

### Tasks

- Reflow operation filter chips/buttons into mobile-friendly groups.
- Apply hybrid row behavior for narrow phones.
- Tame sticky action column behavior below phone breakpoint.

### Acceptance Criteria

- Filter interactions are clear and reachable.
- Action controls never overlap data columns.
- Table/card parity is maintained for operational context.

---

## Step 4 - Pre-Checking / Operational / Post-Checking

### Files

- `Frontend/src/pages/Loading.jsx`
- `Frontend/src/components/OperationActivityTimeline.jsx`
- `Frontend/src/styles/allocation.css`

### Goals

- Improve master-detail workflow usability on mobile.

### Tasks

- Optimize stage tabs/rails for narrow widths.
- Improve checklist and workspace action spacing.
- Introduce mobile-friendly rendering for activity timeline where dense.
- Ensure sticky footer action blocks do not cover form fields.

### Acceptance Criteria

- User can move through stages without layout confusion.
- Checklist and action buttons remain obvious and tappable.
- Timeline data remains readable without excessive side-scrolling.

---

## Step 5 - Shipping Instruction

### Files

- `Frontend/src/pages/ShippingInstruction.jsx`
- `Frontend/src/styles/shipping-instruction.css`

### Goals

- Reduce heavy table width pressure and improve form grid stacking.

### Tasks

- Rebalance table min-width rules and wrapper behavior.
- Improve form/grid collapsing order for phone view.
- Ensure frequent actions remain visible while scrolling.

### Acceptance Criteria

- Critical SI workflows can complete on phone without zoom/pan friction.
- No horizontal overflow for primary form controls.

---

## Step 6 - Berthing Allocation Module

### Files

- `Frontend/src/styles/berthing-allocation.css`

### Goals

- Remove fixed-grid pressure and improve module-level mobile readability.

### Tasks

- Refine module grid split behavior at tablet/phone breakpoints.
- Reduce rigid min-width dependencies for high-frequency interactions.

### Acceptance Criteria

- Berthing module content stays readable on phone and tablet.
- No overlap between occupancy table and control panels.

---

## Step 7 - Dashboard / Reporting / Offloading

### Files

- `Frontend/src/styles/dashboard.css`
- `Frontend/src/styles/offloading.css`
- `Frontend/src/pages/DailyActivitiesReport.jsx`

### Goals

- Normalize remaining mobile inconsistencies outside core operational pages.

### Tasks

- Tune card-grid and table wrappers for small screens.
- Improve report filter panel stacking and action grouping.
- Ensure secondary pages follow same responsive baseline.

### Acceptance Criteria

- Consistent mobile behavior across non-operational modules.
- No outlier page with major clipping/overlap issues.

---

## Step 8 - Final Regression and Polish

### Scope

All touched pages and shared components.

### Tasks

- Run full viewport matrix across all steps.
- Verify no visual regressions on desktop and tablet.
- Fix residual spacing, overflow, and sticky behavior edge cases.
- Document final known limitations (if any).

### Exit Criteria

- All step acceptance criteria pass.
- Remaining issues are only low-severity cosmetic items.
- Team can proceed to release/UAT with confidence.

---

## Cross-Cutting UX Rules (Applied in Every Step)

- Preserve hierarchy: primary action is always visually dominant.
- Keep touch targets comfortable and separated on narrow screens.
- Prefer progressive disclosure for dense metadata.
- Avoid deep horizontal scrolling for primary workflows.
- Keep status chips/tags readable and not truncated.

## Risk Register and Mitigation

- Risk: card/table divergence in data labels.
  - Mitigation: centralize row field mapping and reuse in both views.
- Risk: sticky elements conflict with overlays.
  - Mitigation: simplify or disable sticky behavior under phone breakpoint.
- Risk: fragmented legacy breakpoints cause inconsistencies.
  - Mitigation: align touched areas to shared breakpoint tiers as part of each step.

## Suggested Delivery Cadence

- One step per mini-PR (or mini-batch) with screenshots for 390px and 768px.
- Each step includes:
  - implementation
  - viewport verification notes
  - short regression checklist

This cadence keeps risk low and makes review/UAT faster.

