-- Jetty Planning System - Migration 029
-- Remove Departments module support: drop department permissions and restrict resource_type.

BEGIN;

-- 1) Remove any existing department permissions (and their role links).
DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.resource_type = 'department';

DELETE FROM permissions
WHERE resource_type = 'department';

-- 2) Restrict permissions.resource_type to page/field only.
-- The original check constraint name defaults to: permissions_resource_type_check
ALTER TABLE permissions
  DROP CONSTRAINT IF EXISTS permissions_resource_type_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_resource_type_check
  CHECK (resource_type IN ('page', 'field'));

COMMIT;

