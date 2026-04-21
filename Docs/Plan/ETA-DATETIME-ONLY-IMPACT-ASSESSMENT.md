# ETA Datetime-Only Impact Assessment

## Objective

Assess the impact of simplifying Shipping Instruction ETA from three fields:

- `eta` (datetime)
- `eta_from` (date)
- `eta_to` (date)

to a single field:

- `eta` (datetime) only

This document is assessment-only and does not propose immediate code changes.

---

## Current State Summary

Current behavior uses mixed ETA semantics:

- SI form collects `eta_from` and `eta_to` (date range).
- Backend stores both range fields and also populates `eta` as a normalized datetime.
- Allocation and schedule queries fall back across operation ETA and SI ETA range fields.

As a result, ETA meaning differs by module:

- Planning-style modules often treat ETA as a range.
- Operation/allocation often treat ETA as a point-in-time datetime.

---

## Proposed Direction

Adopt a single ETA source for Shipping Instruction:

- `shipping_instructions.eta` as the only ETA field
- Deprecate and remove `eta_from` and `eta_to`

---

## Impact Assessment

## 1) Database and Data Migration

### Impact

- Schema change required to deprecate/remove `eta_from` and `eta_to`.
- Historical data may contain range-only rows where `eta` is null or less reliable.

### Considerations

- Backfill strategy needed for legacy rows:
  - Primary option: use existing `eta` if available.
  - Fallback option: derive from `eta_to`, else `eta_from`.
- Range semantics will be lost unless replaced by a different concept.

---

## 2) Backend API Contract

### Impact

- SI create/update validation must change from required `eta_from` + `eta_to` to required `eta`.
- Read APIs should stop returning range fields after transition.
- Candidate/schedule filters that currently rely on range overlap must be redesigned to point-in-time logic.

### Considerations

- Introduce compatibility window (accept old payload keys temporarily) to reduce rollout risk.
- Define new filter behavior clearly (exact datetime vs day bucket/tolerance).

---

## 3) Frontend UI/UX

### Impact

- Replace SI form inputs:
  - remove `ETA From` and `ETA To` date inputs
  - add single `ETA` datetime input
- Update SI detail/view/approval pages and labels/translations.
- Update sorting/filtering logic that references `etaFrom`/`etaTo`.

### Considerations

- Users lose explicit “window” visibility unless separately addressed.
- If business still needs uncertainty range, add another explicit mechanism later (not ETA field split).

---

## 4) Allocation and Schedule Behavior

### Impact

- Query fallback paths should become:
  - `COALESCE(o.eta, si.eta)`
  instead of mixing `si.eta_to`/`si.eta_from`.
- Schedule and list ordering logic should use single ETA consistently.

### Considerations

- Verify no regressions in incoming vessel ordering and candidate filtering.
- Confirm timezone display consistency after switching to datetime-only semantics.

---

## 5) Reporting and Downstream Consumers

### Impact

- Any report/export using `eta_from`/`eta_to` needs update.
- Integrations expecting date-range payload may require contract versioning.

### Considerations

- Keep compatibility adapters until downstream consumers migrate.

---

## Risks

1. Functional regression in SI search/filter behavior due to loss of range overlap logic.
2. Data interpretation mismatch for historical records originally entered as date ranges.
3. UI confusion during rollout if mixed payloads are partially supported.
4. Hidden dependency risk in reports or custom queries outside app code.

---

## Recommended Rollout Strategy (No-Code Plan)

### Phase A - Contract Alignment

1. Confirm business decision: ETA is exact datetime, not range.
2. Define final API payload/response contract (`eta` only).
3. Confirm filter semantics for candidate/schedule endpoints.

### Phase B - Compatibility Transition

1. Backend accepts both old and new inputs during grace period.
2. Frontend switches to `eta` datetime input only.
3. Monitoring period for regressions.

### Phase C - Cleanup

1. Remove `eta_from`/`eta_to` from APIs and frontend models.
2. Drop deprecated columns after validation and backup.
3. Update docs/specs to the finalized model.

---

## Acceptance Criteria for the Change (Future Implementation)

- All SI create/update flows use only `eta` datetime.
- No UI screen shows or depends on `ETA From`/`ETA To`.
- Allocation/schedule behavior remains correct and stable.
- Historical SI records still display valid ETA after migration.
- Functional and technical docs are updated to reflect single-field ETA model.

---

## Open Decisions

1. Should ETA be mandatory at SI Draft creation, or only before Submit?
2. What exact candidate filter behavior replaces range overlap?
3. How should historical records be interpreted when only range dates existed?
4. Do any external reports require preserving legacy range fields in export format?
