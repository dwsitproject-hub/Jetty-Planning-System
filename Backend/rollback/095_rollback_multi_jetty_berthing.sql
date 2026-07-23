BEGIN;

DROP INDEX IF EXISTS idx_operations_additional_jetties;
DROP INDEX IF EXISTS idx_shipment_plans_additional_jetties;

ALTER TABLE operations DROP COLUMN IF EXISTS additional_jetties;
ALTER TABLE shipment_plans DROP COLUMN IF EXISTS additional_jetties;
ALTER TABLE ports DROP COLUMN IF EXISTS allow_multi_jetty_berthing;

COMMIT;
