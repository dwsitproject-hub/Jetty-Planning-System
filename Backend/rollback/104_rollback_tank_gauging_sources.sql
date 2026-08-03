-- Rollback companion for 104_tank_gauging_sources.sql

BEGIN;

DROP TABLE IF EXISTS tank_gauging_sources;

-- Restore tank-farm edit to view-only (098 initial state).
UPDATE role_permissions rp
SET can_edit = FALSE,
    updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND p.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key = 'tank-farm'
  AND rp.deleted_at IS NULL;

COMMIT;
