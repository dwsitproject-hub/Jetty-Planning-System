-- RBAC pages `dashboard-analytics` and `management-dashboard`; mirror `dashboard` can_view grants.

BEGIN;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'dashboard-analytics', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'dashboard-analytics'
);

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'management-dashboard', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'management-dashboard'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp.role_id,
  p_new.id,
  rp.can_view,
  rp.can_edit,
  rp.can_delete,
  COALESCE(rp.can_approve, FALSE),
  NOW()
FROM role_permissions rp
JOIN permissions p_dash
  ON p_dash.id = rp.permission_id
 AND p_dash.deleted_at IS NULL
 AND p_dash.resource_type = 'page'
 AND p_dash.resource_key = 'dashboard'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL
 AND p_new.resource_type = 'page'
 AND p_new.resource_key IN ('dashboard-analytics', 'management-dashboard')
WHERE rp.deleted_at IS NULL
  AND rp.can_view = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_new.id
      AND x.deleted_at IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL
 AND p.resource_type = 'page'
 AND p.resource_key IN ('dashboard-analytics', 'management-dashboard')
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
