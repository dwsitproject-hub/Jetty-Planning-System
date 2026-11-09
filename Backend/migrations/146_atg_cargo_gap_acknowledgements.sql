-- ATG cargo gaps an admin has accepted as unrecoverable (archive has no data).
-- Acknowledged gaps stay listed on System Health but no longer drive the check status.

BEGIN;

CREATE TABLE IF NOT EXISTS public.atg_cargo_gap_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  gap_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  acknowledged_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atg_cargo_gap_ack_gap_key_uq UNIQUE (gap_key)
);

CREATE INDEX IF NOT EXISTS idx_atg_cargo_gap_ack_operation
  ON public.atg_cargo_gap_acknowledgements (operation_id);

COMMIT;
