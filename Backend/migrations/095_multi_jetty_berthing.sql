-- Multi-jetty berthing: allow a vessel to span multiple physically-adjacent jetties.
BEGIN;

ALTER TABLE ports
  ADD COLUMN IF NOT EXISTS allow_multi_jetty_berthing BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS additional_jetties BIGINT[] NOT NULL DEFAULT '{}';

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS additional_jetties BIGINT[] NOT NULL DEFAULT '{}';

-- Fast containment lookups ("is jetty X used as a secondary berth anywhere active").
CREATE INDEX IF NOT EXISTS idx_operations_additional_jetties
  ON operations USING GIN (additional_jetties);
CREATE INDEX IF NOT EXISTS idx_shipment_plans_additional_jetties
  ON shipment_plans USING GIN (additional_jetties);

COMMENT ON COLUMN ports.allow_multi_jetty_berthing IS
  'When true, operators may span a vessel across the primary jetty_id plus adjacent jetties (additional_jetties).';
COMMENT ON COLUMN operations.additional_jetties IS
  'Secondary jetty ids (jetties.id) a berthed vessel spans into, in addition to jetty_id. Adjacent-only, validated on write.';
COMMENT ON COLUMN shipment_plans.additional_jetties IS
  'Secondary jetty ids (jetties.id) planned in addition to jetty_id for multi-jetty berthing.';

COMMIT;
