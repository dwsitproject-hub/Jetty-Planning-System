-- DHM hub linkage on SI master tables (incoterm → trade terms, commodity).

BEGIN;

ALTER TABLE si_trade_terms
  ADD COLUMN IF NOT EXISTS hub_code TEXT,
  ADD COLUMN IF NOT EXISTS hub_record_id UUID,
  ADD COLUMN IF NOT EXISTS hub_version INT,
  ADD COLUMN IF NOT EXISTS hub_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_source TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_run_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_si_trade_terms_hub_code_active
  ON si_trade_terms (hub_code)
  WHERE deleted_at IS NULL AND hub_code IS NOT NULL;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS hub_code TEXT,
  ADD COLUMN IF NOT EXISTS hub_record_id UUID,
  ADD COLUMN IF NOT EXISTS hub_version INT,
  ADD COLUMN IF NOT EXISTS hub_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hs_code TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_source TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_run_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_si_commodities_hub_code_active
  ON si_commodities (hub_code)
  WHERE deleted_at IS NULL AND hub_code IS NOT NULL;

COMMENT ON COLUMN si_trade_terms.datahub_last_apply_source IS
  'webhook or manual_sync when last apply from datahub sync; null for local-only edits.';
COMMENT ON COLUMN si_commodities.datahub_last_apply_source IS
  'webhook or manual_sync when last apply from datahub sync; null for local-only edits.';

COMMIT;
