-- Jetty Planning System - Migration 015
-- Allocation/Berthing: allow pre-allocation operations and store arrival/berthing timestamps.

BEGIN;

-- Allow creating an operation before jetty is assigned.
ALTER TABLE operations ALTER COLUMN jetty_id DROP NOT NULL;

-- Allocation ordering + remarks
ALTER TABLE operations ADD COLUMN IF NOT EXISTS sequence INT;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS remark TEXT;

-- Ops-managed timestamps (distinct from SI planned ETA window)
ALTER TABLE operations ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS ta TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS etb TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS nor_tendered_at TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS nor_accepted_at TIMESTAMPTZ;

-- Berthing events
ALTER TABLE operations ADD COLUMN IF NOT EXISTS pob TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS tb TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS sob TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_operations_sequence_active
  ON operations(sequence) WHERE deleted_at IS NULL;

COMMIT;

