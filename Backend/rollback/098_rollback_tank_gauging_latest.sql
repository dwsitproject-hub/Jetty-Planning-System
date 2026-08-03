-- Rollback companion for 098_tank_gauging_latest.sql

BEGIN;

DROP TABLE IF EXISTS tank_gauging_latest;
DROP TABLE IF EXISTS tank_gauging_tank_map;

DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.resource_type = 'page'
  AND p.resource_key = 'tank-farm';

DELETE FROM permissions
WHERE resource_type = 'page'
  AND resource_key = 'tank-farm'
  AND deleted_at IS NULL;

COMMIT;
