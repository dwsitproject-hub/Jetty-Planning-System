-- Jetty Planning System - Migration 013
-- Move per-role flags onto role_permissions (page-only RBAC for UI grid).

BEGIN;

ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE role_permissions SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
ALTER TABLE role_permissions ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE role_permissions ALTER COLUMN updated_at SET DEFAULT NOW();

-- Backfill flags from permissions at time of migration (only for active assignments).
UPDATE role_permissions rp
SET
  can_view = COALESCE(rp.can_view, p.can_view),
  can_edit = COALESCE(rp.can_edit, p.can_edit),
  can_delete = COALESCE(rp.can_delete, p.can_delete),
  updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND rp.deleted_at IS NULL
  AND p.deleted_at IS NULL;

COMMIT;

