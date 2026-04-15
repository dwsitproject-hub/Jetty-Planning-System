# UAT rollout — commodity type, pre-check, operational (2026-04)

This document summarizes subprocess keys, migrations, and test focus for the UAT-aligned changes. Apply migrations in order (`051` → `054`) on each environment before relying on new columns or merged rows.

## 1. Master data & shipping instructions

- **Schema:** `si_commodities.commodity_type` — `Solid` | `Liquid` (migration `051_si_commodity_type.sql`).
- **Rule:** All breakdown lines on one shipping instruction must reference commodities of the **same** type; API returns **400** if mixed.
- **UI:** Master **SI Commodity** (`/master/si-commodity`) exposes type; **Shipping Instruction** form validates before submit.

## 2. Pre-Checking subprocess keys

| Legacy keys | New key | Notes |
|-------------|---------|--------|
| `tank_inspection`, `hold_inspection` | `inspection` | Merge migration `052`. Payload: `inspectionType`: `Tank` \| `Hold`. **Loading only** — API rejects inspection for **Unloading**. |
| `initial_sounding`, `initial_draft_survey` | `initial_cargo_checking` | Merge migration `053`. Payload: `cargoCheckingType`: `Sounding` \| `Draft Survey`. |

Activity log / deep links: legacy keys map to `inspection` and `initialCargoChecking` tabs in `Loading.jsx` / `atBerthActivityLogNav.js`.

## 3. Operational milestones

| Legacy key | New key | Notes |
|------------|---------|--------|
| `opening_h1_h2` | `opening_hatch` | Migration `054`. Label: **OPENING HATCH**. Multiple activity rows (e.g. H1, H2). **Start-only** by default (`end_at` nullable for `opening_hatch` and `cargo_pre_conditioning`). |

DB constraint `chk_operational_activity_entry_fields` updated in `054` to allow `NULL` `end_at` for those two milestone keys.

## 4. NOR Accepted (Pre-Checking)

- Sub-process `nor_accepted`: `end_at` cleared on save; **NOR Tendered** and **NOR Accepted** remain the primary user-facing datetimes (aligned with `operations` / allocation).

## 5. Test matrix (short)

| Area | Check |
|------|--------|
| Master commodity | Create/edit Solid and Liquid; list shows type. |
| SI | Two lines same type OK; mixed types blocked (API + UI). |
| Loading pre-check | Inspection shows Tank/Hold from SI; Initial Cargo Checking shows Sounding/Draft Survey from SI. |
| Unloading pre-check | No Inspection tab; other steps unchanged. |
| Operational | OPENING HATCH: multiple rows; start-only milestones do not require end time. |
| NOR | No duplicate Start/End row in NOR Accepted tab; save still updates operation NOR fields. |

## 6. Related specs

- **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** §12.2
- **TECH-SPEC-Jetty-Planning-System.md** §3.4A.4
