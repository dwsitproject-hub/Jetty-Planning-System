-- Tag each cargo load segment with SI commodity (CPO, POME, etc.) for per-product progress.

BEGIN;

ALTER TABLE operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS commodity_id BIGINT NULL
    REFERENCES si_commodities(id);

CREATE INDEX IF NOT EXISTS idx_cargo_load_lines_commodity
  ON operation_cargo_load_lines (operational_activity_id, commodity_id)
  WHERE commodity_id IS NOT NULL;

COMMENT ON COLUMN operation_cargo_load_lines.commodity_id IS
  'SI product moved in this segment; required for multi-commodity SIs from Phase 1 rollout.';

COMMIT;
