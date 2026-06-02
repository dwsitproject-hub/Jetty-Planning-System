# Shipment Plan (multi-SI) implementation plan

**Status:** Living document — synced from approved planning session (2026-05-11).  
**Related CR:** [Docs/CR/Vessel-SI Change Process.md](../CR/Vessel-SI%20Change%20Process.md)

---

## Goal

Introduce a persisted **Shipment Plan** as the parent of multiple **Shipping Instructions**; **allocation / shared timestamps / berthing / one clearance** on the plan; **Pre-Checking, Operational, Post-Checking** and sign-off **per SI** via each SI’s `operations` row; **QC and quantities** SI-scoped; **exceptions** at plan and SI level; **search** emphasises vessel name with SI / purpose / other filters retained; **late SI** until sail-off or clearance completed; **clearance** only after **every** SI completes the full at-berth execution chain.

---

## Allocation overview API shape (decision)

**Chosen: flat `queue` + `shipmentPlanId` + plan-level fields denormalised on each sibling row.**

- `GET /allocation/overview` keeps a **`queue` array** like today.
- Rows that share a vessel call share the same **`shipmentPlanId`** and the same plan-owned timestamps / jetty (joined from `shipment_plans` in SQL).
- **Gantt / schematic:** group or key by `shipmentPlanId` so one vessel call does not produce duplicate competing bars.

---

## Implementation phases (summary)

1. **Database:** `shipment_plans` + `shipping_instructions.shipment_plan_id`; backfill 1:1; keep legacy `operations` columns during rollout (rollback-friendly).
2. **Backend:** allocation overview SQL + `PUT /allocation/arrival` → `shipment_plans`; plan-level depart; port scope and validation rules.
3. **Frontend:** reuse-first (same pages); bind plan APIs; minimal SI list / grouping; Gantt groups by `shipmentPlanId`.
4. **Seeds / tests / docs:** FUNCTIONAL-SPEC, TECH-SPEC, technical-architecture, CR stakeholder notes; dev seeds; API tests.

---

## UI/UX strategy (reuse-first)

- Same routes and components (Allocation, At-Berth, Loading/Unloading, Verification, SI modals).
- Necessary visible changes documented in FUNCTIONAL-SPEC + TECH-SPEC (version/history) before release.
- Avoid new component libraries or parallel “v2” shells.

---

## Rollback and recovery

1. **Redeploy** last known-good app build.
2. Prefer **dual-write / retained legacy columns** on `operations` until stable; optional `rollback-NNN.sql` in repo.
3. **Reverse data:** copy from `shipment_plans` back to `operations` / SI if needed, then drop FK/table when old app no longer needs them.
4. **Nuclear:** restore `pg_dump` / snapshot from before migrate.
5. Optional **feature flag** for legacy API paths (remove after sign-off).

---

## Documentation deliverables

- [Docs/FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md](../FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md) — Shipment Plan section + deltas to §2/3/5/6/9/9.2/2.6/7.
- [Docs/TECH-SPEC-Jetty-Planning-System.md](../TECH-SPEC-Jetty-Planning-System.md) — schema, overview, arrival, depart, rollback pointer.
- [Docs/technical-architecture.md](../technical-architecture.md) — addendum + data model note.
- [Docs/CR/Vessel-SI Change Process.md](../CR/Vessel-SI%20Change%20Process.md) — terminology “Shipment Plan”, stakeholder decisions.

---

## Risk notes

- **Jetty Operation ID:** multiple per plan (one per operation); table UX may show plan + op code.
- **Shift-out / re-dock:** coherent when one jetty serves multiple SIs on one plan.
- **Double-bank ordering:** sort by plan + representative TB.

---

## Execution progress (implementation)

| Step | Description |
|------|-------------|
| 059 migration | Done — `shipment_plans` + `shipping_instructions.shipment_plan_id` + 1:1 backfill ([Backend/migrations/059_shipment_plans.sql](../../Backend/migrations/059_shipment_plans.sql)). |
| Dev reset script | Done — seeds plans + `shipment_plan_id`; syncs plan from operations ([Backend/scripts/reset-and-seed-dev.sql](../../Backend/scripts/reset-and-seed-dev.sql)). |
| SI POST create | Done — creates shell `shipment_plans` row with new SI ([Backend/src/routes/shipping-instructions.js](../../Backend/src/routes/shipping-instructions.js)). |
| Allocation overview | Partial — `shipmentPlanId` on each queue row ([Backend/src/routes/allocation.js](../../Backend/src/routes/allocation.js)); arrival still updates `operations` only. |
| Next | `PUT /allocation/arrival` → `shipment_plans`; denormalised plan times on overview rows; Gantt group by `shipmentPlanId`; plan-level depart; FUNCTIONAL-SPEC / TECH-SPEC full pass. |

*Update this table as work lands on `main`.*
