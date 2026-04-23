# Cargo Operations — Qty, balance, flow & informative ETA (draft)

**Status:** DRAFT — user requirement gathering (not implemented).  
**Module:** At-Berth → Operational → **Cargo Operations** (`cargo_operations` milestone activities).  
**Related:** [UAT-COMMODITY-PRECHECK-OPERATIONAL-PLAN.md](./UAT-COMMODITY-PRECHECK-OPERATIONAL-PLAN.md) (commodity type, Opening CHM). Current operational rows live in `operation_operational_activities` (see TECH-SPEC / migration `028`).

---

## 1. Purpose

Extend **Cargo Operations** so operators can:

- See **quantity context** aligned with the **shipping instruction commodity / breakdown** (correct **metric**, not assumed MT).
- **Capture** liquid-specific or solid-specific fields per activity row.
- See **balance** derived from inputs, with **no negative balance**.
- For **second and later** Cargo Op rows on the same operation, **QTY** shown for that row is the **previous row’s balance** (chained).
- See an **informative** estimate of **whole cargo move completion (option B)** — **display only**; **not persisted** anywhere for now.

---

## 2. Decisions already agreed (pending final sign-off)

| Topic | Decision |
|--------|-----------|
| **Commodity type** | **Liquid** vs **Solid** drives which fields appear (see §3). |
| **Metric / formatting** | Follow **metric from SI** (via `shipping_instruction_breakdown.metric_id` → `metric`), not a hard-coded MT label unless the line is actually MT. |
| **Loading vs Unloading** | **Same rules** for both purposes. |
| **Balance** | **Must not be negative** (validate before save). |
| **Edits / deletes** | **Recompute** displayed Qty basis and balance for **later** rows when an **earlier** Cargo Op row changes (ordering TBD in §6). |
| **ETA** | **Option B:** estimate **completion of whole cargo move**, **informative only** — **no DB column**, no persisted API field for ETA in the first iteration. |

---

## 3. Field matrix (per Cargo Operations activity row)

### 3.1 Liquid

| Field | Mode | Rule |
|--------|------|------|
| **QTY** | Display | From **commodity / SI breakdown** (see **open question** §5.1). Show numeric value with **metric from breakdown**. |
| **COB** (Commenced on board) | Capture | User enters quantity; **same metric family** as QTY for v1 unless product specifies conversion. |
| **Flow rate** | Capture | User enters rate (unit must align with product — e.g. MTPH when metric is mass-based; **open** if SI uses non-mass metric). |
| **Balance** | Display | `QTY − COB` (same unit as QTY); must be **≥ 0** at save. |

### 3.2 Solid

| Field | Mode | Rule |
|--------|------|------|
| **QTY** | Display | From **SI breakdown** + **metric** (same open question as liquid). |
| **QWB** | Capture | User enters quantity (with breakdown metric). |
| **Balance** | Display | `QTY − QWB`; must be **≥ 0** at save. |

### 3.3 Chaining (row 2+)

| Field | Rule |
|--------|------|
| **QTY** (display) | For the **second and subsequent** `cargo_operations` activity rows on the **same operation**, **QTY** = **Balance** of the **previous** Cargo Op row (after save ordering — see §6). |

---

## 4. Informative ETA (display only)

| Item | Spec |
|--------|------|
| **Intent** | **Option B:** rough **end of whole cargo move** for user awareness. |
| **Persistence** | **None** in v1 (no new columns, no stored snapshot on operation or activity for ETA). |
| **Computation** | **TBD** exact formula and anchor clock (e.g. start of current row vs “now”). Must respect **metric compatibility** (e.g. mass ÷ MTPH only when units align). **Solid:** define whether ETA is shown, hidden, or “N/A” until a rate rule exists. |
| **UX** | Clearly label as **informative / not saved** (e.g. muted panel under Balance). |

---

## 5. Open questions (user / stakeholder input)

### 5.1 Multiple breakdown lines on one SI

When an SI has **more than one** `shipping_instruction_breakdown` line (same commodity **type** per current product rules):

- [ ] **Sum** all line quantities (with unit harmonisation policy)?
- [ ] **First line** only (by `line_order`)?
- [ ] **User picks** line per operation or per Cargo Op row?
- [ ] Other: ____________________

**Owner:** business / jetty ops — record answer here when decided.

### 5.2 Flow rate unit vs breakdown metric

If breakdown uses **non-mass** metric (e.g. KL), how should **Flow rate** and **ETA** behave?

- [ ] Require mass-based secondary field  
- [ ] Hide ETA until compatible  
- [ ] Other: ____________________

### 5.3 Ordering for “previous row”

Confirm sort for chain:

- [ ] `start_at` ascending, then `id`  
- [ ] `created_at` ascending, then `id`  
- [ ] Other: ____________________

### 5.4 Rounding

Display decimals vs storage scale for **QTY / COB / QWB / Balance** (e.g. 3 vs 6 decimal places for solids).

---

## 6. Technical notes (for later implementation — not binding)

- **Persistence (future):** likely new nullable columns on `operation_operational_activities` for `cargo_operations` only (e.g. liquid: `cob_qty`, `flow_rate`; solid: `qwb_qty`) **or** a JSONB payload; **qty snapshot** optional for audit.
- **API:** extend GET operational activities + POST/PATCH validation; optionally extend `GET /operations/:id` with **aggregated breakdown qty + metric** for the form’s first-row QTY.
- **UI:** `OperationalMilestoneWorkspace` — Cargo Operations modal section; read-only controls similar pattern to **Initial Cargo Checking** read-only display (see Loading page pre-check cards).

---

## 7. Lo-fi wireframes (layout reference)

### 7.1 Liquid — first row

```
┌─────────────────────────────────────────────────────────────────┐
│  CARGO OPERATIONS                                                │
├─────────────────────────────────────────────────────────────────┤
│  Sub-step title (optional)   [___________________________]       │
│                                                                  │
│  QTY (from SI)     [ read-only: value + metric from breakdown ]  │
│  COB *             [ capture ]                                   │
│  Flow rate *       [ capture ]                                   │
│  Balance           [ read-only: QTY − COB ]   (≥ 0)            │
│                                                                  │
│  Est. completion of cargo move (informative, not saved)         │
│  ~ [derived datetime or —]                                       │
│                                                                  │
│  Remark *  …   Start * / End *  …   [ Save ] [ Save & add … ]   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Solid — first row

```
│  QTY (from SI)     [ read-only ]                                 │
│  QWB *             [ capture ]                                   │
│  Balance           [ read-only: QTY − QWB ]   (≥ 0)              │
│  (Informative ETA — TBD for solid)                               │
```

### 7.3 Second row (liquid or solid)

- Same as above, but **QTY (read-only)** = **previous row’s Balance** (label text can clarify: “QTY (from previous balance)”).

---

## 8. Revision log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-21 | JPS docs | Initial draft from consultation; awaiting stakeholder answers in §5. |
