-- Expand operations.status: POST_OPS, SIGNOFF_REQUESTED, SIGNOFF_APPROVED; remove COMPLETED (backfill to SIGNOFF_APPROVED).

BEGIN;

ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_status_check;

-- Legacy COMPLETED meant "signed off / ready for depart" in the old model.
-- Drop the legacy CHECK first, because it does not allow SIGNOFF_APPROVED.
UPDATE operations
SET status = 'SIGNOFF_APPROVED', updated_at = NOW()
WHERE deleted_at IS NULL AND status = 'COMPLETED';

ALTER TABLE operations
  ADD CONSTRAINT operations_status_check CHECK (
    status IN (
      'PENDING',
      'ALLOCATED',
      'DOCKED',
      'IN_PROGRESS',
      'POST_OPS',
      'SIGNOFF_REQUESTED',
      'SIGNOFF_APPROVED',
      'SAILED'
    )
  );

DROP INDEX IF EXISTS idx_operations_signoff_pending;

CREATE INDEX idx_operations_signoff_pending
  ON operations (port_id, signoff_requested_at)
  WHERE deleted_at IS NULL
    AND signoff_requested_at IS NOT NULL
    AND status = 'SIGNOFF_REQUESTED';

COMMIT;
