-- Jetty Planning System - Migration 014
-- Ensure all page permission catalog entries exist (so Pages grid works).

BEGIN;

WITH desired(resource_key) AS (
  VALUES
    ('dashboard'),
    ('shipping-instruction'),
    ('allocation'),
    ('at-berth'),
    ('loading'),
    ('quality'),
    ('verification'),
    ('reporting'),
    ('master'),
    ('master-port'),
    ('master-jetty'),
    ('master-jetty-layout'),
    ('activity-log'),
    ('admin')
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

