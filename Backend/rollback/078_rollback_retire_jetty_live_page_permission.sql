-- Rollback 078: restore jetty-live catalog row (does not reverse at-berth can_approve grants).

BEGIN;

UPDATE permissions
SET deleted_at = NULL, updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key = 'jetty-live';

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'jetty-live', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.resource_type = 'page' AND p.resource_key = 'jetty-live'
);

COMMIT;
