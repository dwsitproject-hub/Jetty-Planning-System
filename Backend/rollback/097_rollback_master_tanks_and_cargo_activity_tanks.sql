-- Rollback companion for 097_master_tanks_and_cargo_activity_tanks.sql

BEGIN;

DROP TABLE IF EXISTS operation_cargo_activity_tanks;

DROP TABLE IF EXISTS master_tanks;

UPDATE role_permissions rp
SET deleted_at = NOW(), updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND rp.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key = 'master-tanks';

UPDATE permissions
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND resource_type = 'page'
  AND resource_key = 'master-tanks';

COMMIT;
