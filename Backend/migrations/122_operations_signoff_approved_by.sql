-- Who approved operation sign-off (Clearance "Signed off by").
-- Backfill from the activity log written by POST /operations/:id/signoff.

BEGIN;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS signoff_approved_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signoff_approved_at TIMESTAMPTZ NULL;

UPDATE operations o
SET
  signoff_approved_by = src.actor_user_id,
  signoff_approved_at = src.created_at
FROM (
  SELECT DISTINCT ON (al.entity_id)
    al.entity_id,
    al.actor_user_id,
    al.created_at
  FROM activity_logs al
  JOIN users u ON u.id = al.actor_user_id
  WHERE al.deleted_at IS NULL
    AND al.entity_type = 'Operation'
    AND al.summary = 'Signed off operation (SIGNOFF_APPROVED)'
    AND al.actor_user_id IS NOT NULL
    AND al.entity_id ~ '^[0-9]+$'
  ORDER BY al.entity_id, al.created_at DESC
) src
WHERE o.id = src.entity_id::bigint
  AND o.deleted_at IS NULL
  AND o.status IN ('SIGNOFF_APPROVED', 'SAILED')
  AND o.signoff_approved_by IS NULL;

COMMIT;
