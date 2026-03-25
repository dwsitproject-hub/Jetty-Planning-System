-- Persist Approval ID for approved SI sign-off and view rendering

ALTER TABLE shipping_instructions
  ADD COLUMN IF NOT EXISTS approval_id TEXT;

-- Backfill existing approved rows so SI View can display historical approval IDs.
UPDATE shipping_instructions
SET approval_id = CONCAT(
  'JPS-LEGACY-',
  TO_CHAR(COALESCE(updated_at, created_at, NOW()), 'YYYYMMDDHH24MISS'),
  '-SI',
  id::text
)
WHERE deleted_at IS NULL
  AND status = 'Approved'
  AND (approval_id IS NULL OR approval_id = '');

