-- Seed RBAC catalog entry for Jetty Live stream page (admin assigns per role).

BEGIN;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'jetty-live', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'jetty-live'
);

COMMIT;
