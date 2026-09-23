-- Deferred QA / backfill stub (Project B). Not run at go-live.
-- List legacy plans that could be linked by exact vessel name match.
SELECT sp.id,
       sp.plan_reference,
       sp.vessel_name,
       mv.id AS suggested_master_vessel_id,
       mv.hub_code
FROM shipment_plans sp
JOIN master_vessels mv
  ON LOWER(mv.vessel_name) = LOWER(sp.vessel_name)
 AND mv.deleted_at IS NULL
WHERE sp.deleted_at IS NULL
  AND sp.master_vessel_id IS NULL
ORDER BY sp.id;
