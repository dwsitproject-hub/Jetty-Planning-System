-- Seed RBAC permission catalog entry for the Demurrage Risk Calculator page.

BEGIN;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'demurrage-risk-calculator', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'demurrage-risk-calculator'
);

COMMIT;

