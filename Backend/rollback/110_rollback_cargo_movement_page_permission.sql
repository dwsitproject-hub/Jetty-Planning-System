-- Rollback companion for 110_cargo_movement_page_permission.sql

BEGIN;

DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.resource_type = 'page'
  AND p.resource_key = 'cargo-movement'
  AND p.deleted_at IS NULL;

UPDATE permissions
SET deleted_at = NOW()
WHERE resource_type = 'page'
  AND resource_key = 'cargo-movement'
  AND deleted_at IS NULL;

COMMIT;
