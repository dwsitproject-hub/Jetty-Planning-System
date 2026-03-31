-- Agreed start of demurrage liability (often captured with NOR acceptance).

ALTER TABLE operations ADD COLUMN IF NOT EXISTS demurrage_liability_from_at TIMESTAMPTZ;

COMMENT ON COLUMN operations.demurrage_liability_from_at IS
  'Agreed date/time from which demurrage liability applies (consensus with shipper; often aligned with NOR acceptance).';
