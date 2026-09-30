-- Staging items reuse vessel_id for any master local row id (vessel, trade term, commodity).
-- FK to master_vessels only worked for vessel runs; incoterm/commodity sync failed on insert.

BEGIN;

ALTER TABLE datahub_vessel_sync_items
  DROP CONSTRAINT IF EXISTS datahub_vessel_sync_items_vessel_id_fkey;

COMMENT ON COLUMN datahub_vessel_sync_items.vessel_id IS
  'Local master row id when matched (master_vessels.id, si_trade_terms.id, or si_commodities.id). Interpret using datahub_vessel_sync_runs.entity_type. No FK.';

COMMENT ON TABLE datahub_vessel_sync_items IS
  'Staged DataHub master records awaiting review; approved rows apply to the table indicated by the parent run entity_type.';

COMMIT;
