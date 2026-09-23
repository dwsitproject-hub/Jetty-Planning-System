# Master Vessel push to shipment plans (future)

Not in v1. Documented for a later project.

## Goal

Allow operators to refresh plan vessel snapshots from the current master record when master data changes in DataHub (rename, LOA/GT/draft corrections).

## v1 behavior (current)

- New plans require `master_vessel_id`; vessel name/LOA/GT/draft are copied onto the plan at create/edit time.
- Legacy plans (`master_vessel_id IS NULL`) keep free-text vessel fields.
- Master renames do not retroactively change existing linked plan snapshots.

## Future options

1. **Single plan:** "Refresh from master" on plan edit / vessel info when linked.
2. **Bulk:** Admin action to push master updates to all plans referencing a given `master_vessel_id`.
3. **Partner API:** Optional `hub_code` on integration submissions (supported in v1 for resolution only).

## QA backfill (Project B — deferred)

```sql
-- Example only; do not run at go-live.
-- Match legacy plans to master by exact name (manual review required for duplicates).
SELECT sp.id, sp.vessel_name, mv.id AS master_vessel_id
FROM shipment_plans sp
JOIN master_vessels mv ON LOWER(mv.vessel_name) = LOWER(sp.vessel_name) AND mv.deleted_at IS NULL
WHERE sp.master_vessel_id IS NULL AND sp.deleted_at IS NULL;
```
