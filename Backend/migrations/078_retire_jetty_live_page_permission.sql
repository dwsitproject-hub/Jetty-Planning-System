-- Retire RBAC page `jetty-live`: migrate can_view grants to at-berth can_approve (Jetty Live CCTV),
-- then soft-delete legacy permission rows. Rollback: 078_rollback_retire_jetty_live_page_permission.sql

BEGIN;

-- Roles with jetty-live view but no at-berth row yet
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp_jl.role_id,
  p_ab.id,
  FALSE,
  FALSE,
  FALSE,
  TRUE,
  NOW()
FROM role_permissions rp_jl
JOIN permissions p_jl
  ON p_jl.id = rp_jl.permission_id
 AND p_jl.deleted_at IS NULL
 AND p_jl.resource_type = 'page'
 AND p_jl.resource_key = 'jetty-live'
JOIN permissions p_ab
  ON p_ab.deleted_at IS NULL
 AND p_ab.resource_type = 'page'
 AND p_ab.resource_key = 'at-berth'
WHERE rp_jl.deleted_at IS NULL
  AND rp_jl.can_view = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    JOIN permissions p2 ON p2.id = rp2.permission_id AND p2.deleted_at IS NULL
    WHERE rp2.role_id = rp_jl.role_id
      AND rp2.deleted_at IS NULL
      AND p2.resource_type = 'page'
      AND p2.resource_key = 'at-berth'
  );

-- Roles with both jetty-live view and existing at-berth row: set can_approve
UPDATE role_permissions rp_ab
SET can_approve = TRUE, updated_at = NOW()
FROM role_permissions rp_jl
JOIN permissions p_jl
  ON p_jl.id = rp_jl.permission_id
 AND p_jl.deleted_at IS NULL
 AND p_jl.resource_type = 'page'
 AND p_jl.resource_key = 'jetty-live'
JOIN permissions p_ab
  ON p_ab.deleted_at IS NULL
 AND p_ab.resource_type = 'page'
 AND p_ab.resource_key = 'at-berth'
WHERE rp_jl.deleted_at IS NULL
  AND rp_jl.can_view = TRUE
  AND rp_ab.role_id = rp_jl.role_id
  AND rp_ab.permission_id = p_ab.id
  AND rp_ab.deleted_at IS NULL
  AND COALESCE(rp_ab.can_approve, FALSE) = FALSE;

-- Soft-delete legacy role_permission rows for jetty-live
UPDATE role_permissions rp
SET deleted_at = NOW(), updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND rp.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key = 'jetty-live';

-- Soft-delete legacy permission catalog row
UPDATE permissions
SET deleted_at = NOW(), updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key = 'jetty-live'
  AND deleted_at IS NULL;

COMMIT;
