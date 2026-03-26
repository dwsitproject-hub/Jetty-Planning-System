-- Jetty Planning System - Migration 027
-- Seed RBAC page permission catalog for SI master dropdown management pages.

BEGIN;

WITH desired(resource_key) AS (
  VALUES
    ('master-si-term'),
    ('master-si-shipper'),
    ('master-si-loading-port'),
    ('master-si-surveyor'),
    ('master-si-agent'),
    ('master-si-commodity'),
    ('master-si-freight-terms')
)
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', d.resource_key, FALSE, FALSE, FALSE
FROM desired d
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = d.resource_key
);

COMMIT;

