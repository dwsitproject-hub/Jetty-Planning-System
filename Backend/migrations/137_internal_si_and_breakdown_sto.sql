-- Internal SI numbers for children with no external shipping instruction, plus line-level STO.

BEGIN;

ALTER TABLE shipping_instructions
  ADD COLUMN IF NOT EXISTS no_external_si BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN shipping_instructions.no_external_si IS
  'When true, plan submit assigns an internal SI number if reference_number is empty.';

CREATE TABLE IF NOT EXISTS internal_si_counters (
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE RESTRICT,
  period CHAR(7) NOT NULL,
  last_value INT NOT NULL,
  PRIMARY KEY (port_id, period)
);

COMMENT ON TABLE internal_si_counters IS
  'Monthly per-port sequence for INT-SI-<port>-YYYY-MM-####. Gaps are not reused.';

ALTER TABLE shipping_instruction_breakdown
  ADD COLUMN IF NOT EXISTS sto_no TEXT;

COMMENT ON COLUMN shipping_instruction_breakdown.sto_no IS
  'Stock transfer order number (optional line-level reference).';

COMMIT;
