-- RBAC page `operator-at-berth` (mobile Operator Mode); mirror `at-berth` grants.

BEGIN;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'operator-at-berth', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'operator-at-berth'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp.role_id,
  p_op.id,
  rp.can_view,
  rp.can_edit,
  rp.can_delete,
  COALESCE(rp.can_approve, FALSE),
  NOW()
FROM role_permissions rp
JOIN permissions p_src
  ON p_src.id = rp.permission_id
 AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page'
 AND p_src.resource_key = 'at-berth'
JOIN permissions p_op
  ON p_op.deleted_at IS NULL
 AND p_op.resource_type = 'page'
 AND p_op.resource_key = 'operator-at-berth'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_op.id
      AND x.deleted_at IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL
 AND p.resource_type = 'page'
 AND p.resource_key = 'operator-at-berth'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
