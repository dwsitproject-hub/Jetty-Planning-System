-- Jetty Planning System - Migration 041
-- Grant `admin` full RBAC on all page permissions and assign every active port (fixes
-- "Access not configured" / "No port assigned" when login works but user_ports / roles are empty).
-- Idempotent.

BEGIN;

-- Page key used in Layout nav but missing from early seeds
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'e2e-console', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'e2e-console'
);

INSERT INTO roles (name, description, is_system_role)
SELECT 'JPS Full Access', 'Full access to all pages and all ports (system bootstrap)', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.deleted_at IS NULL AND r.name = 'JPS Full Access'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE
FROM roles r
CROSS JOIN permissions p
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND p.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.deleted_at IS NULL
  );

UPDATE role_permissions rp
SET
  can_view = TRUE,
  can_edit = TRUE,
  can_delete = TRUE,
  can_approve = TRUE,
  updated_at = NOW()
FROM roles r
JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL AND p.resource_type = 'page'
WHERE rp.role_id = r.id
  AND r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND rp.deleted_at IS NULL
  AND (
    rp.can_view IS DISTINCT FROM TRUE
    OR rp.can_edit IS DISTINCT FROM TRUE
    OR rp.can_delete IS DISTINCT FROM TRUE
    OR rp.can_approve IS DISTINCT FROM TRUE
  );

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE u.deleted_at IS NULL
  AND u.username = 'admin'
  AND r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role_id = r.id
      AND ur.deleted_at IS NULL
  );

UPDATE user_roles ur
SET deleted_at = NULL
FROM users u
JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.name = 'JPS Full Access'
WHERE ur.user_id = u.id
  AND u.deleted_at IS NULL
  AND u.username = 'admin'
  AND ur.deleted_at IS NOT NULL;

INSERT INTO user_ports (user_id, port_id)
SELECT u.id, p.id
FROM users u
CROSS JOIN ports p
WHERE u.deleted_at IS NULL
  AND u.username = 'admin'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_ports up
    WHERE up.user_id = u.id
      AND up.port_id = p.id
      AND up.deleted_at IS NULL
  );

UPDATE user_ports up
SET deleted_at = NULL, updated_at = NOW()
FROM users u
JOIN ports p ON p.id = up.port_id AND p.deleted_at IS NULL
WHERE up.user_id = u.id
  AND u.deleted_at IS NULL
  AND u.username = 'admin'
  AND up.deleted_at IS NOT NULL;

COMMIT;
