-- Operation sign-off: request (berth team) then approve (RBAC can_approve on loading page).

BEGIN;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS signoff_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signoff_requested_by BIGINT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS signoff_request_remark TEXT;

CREATE INDEX IF NOT EXISTS idx_operations_signoff_pending
  ON operations (port_id, signoff_requested_at)
  WHERE deleted_at IS NULL
    AND signoff_requested_at IS NOT NULL
    AND status IN ('DOCKED', 'IN_PROGRESS');

COMMIT;
