-- Term master: long display name (description column added in 124).

BEGIN;

ALTER TABLE si_trade_terms
  ADD COLUMN IF NOT EXISTS long_name TEXT;

COMMENT ON COLUMN si_trade_terms.long_name IS 'Full trade term name; DHM incoterm long_name when synced.';
COMMENT ON COLUMN si_trade_terms.code IS 'Short term code (FOB, CIF); maps to DataHub incoterm name.';

COMMIT;
