-- Retire RBAC catalog pages `allocation` and `shipping-instruction`:
-- mirror any remaining effective grants onto `allocation-plan` / `shipment-plan`, then soft-delete legacy rows.
-- RBAC tables only (`permissions`, `role_permissions`). Inverse / rollback: see `069_rollback_retire_allocation_si_page_permissions.sql`.

BEGIN;

-- Ensure canonical page permission rows exist (idempotent)
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'allocation-plan', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'allocation-plan'
);

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'shipment-plan', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'shipment-plan'
);

-- Roles that have `allocation` but no active `allocation-plan` row yet
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp.role_id,
  p_plan.id,
  rp.can_view,
  rp.can_edit,
  rp.can_delete,
  COALESCE(rp.can_approve, FALSE),
  NOW()
FROM role_permissions rp
JOIN permissions p_old
  ON p_old.id = rp.permission_id
 AND p_old.deleted_at IS NULL
 AND p_old.resource_type = 'page'
 AND p_old.resource_key = 'allocation'
JOIN permissions p_plan
  ON p_plan.deleted_at IS NULL
 AND p_plan.resource_type = 'page'
 AND p_plan.resource_key = 'allocation-plan'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_plan.id
      AND x.deleted_at IS NULL
  );

-- OR-merge `allocation` flags into existing `allocation-plan` rows
UPDATE role_permissions rp_plan
SET
  can_view = rp_plan.can_view OR rp_alloc.can_view,
  can_edit = rp_plan.can_edit OR rp_alloc.can_edit,
  can_delete = rp_plan.can_delete OR rp_alloc.can_delete,
  can_approve = COALESCE(rp_plan.can_approve, FALSE) OR COALESCE(rp_alloc.can_approve, FALSE),
  updated_at = NOW()
FROM role_permissions rp_alloc
JOIN permissions p_old
  ON p_old.id = rp_alloc.permission_id
 AND p_old.deleted_at IS NULL
 AND p_old.resource_type = 'page'
 AND p_old.resource_key = 'allocation'
JOIN permissions p_plan
  ON p_plan.deleted_at IS NULL
 AND p_plan.resource_type = 'page'
 AND p_plan.resource_key = 'allocation-plan'
WHERE rp_alloc.deleted_at IS NULL
  AND rp_plan.role_id = rp_alloc.role_id
  AND rp_plan.permission_id = p_plan.id
  AND rp_plan.deleted_at IS NULL;

-- Roles that have `shipping-instruction` but no active `shipment-plan` row (060 pattern)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp.role_id,
  p_sp.id,
  rp.can_view,
  rp.can_edit,
  rp.can_delete,
  CASE WHEN rp.can_edit THEN TRUE ELSE COALESCE(rp.can_approve, FALSE) END,
  NOW()
FROM role_permissions rp
JOIN permissions p_si
  ON p_si.id = rp.permission_id
 AND p_si.deleted_at IS NULL
 AND p_si.resource_type = 'page'
 AND p_si.resource_key = 'shipping-instruction'
JOIN permissions p_sp
  ON p_sp.deleted_at IS NULL
 AND p_sp.resource_type = 'page'
 AND p_sp.resource_key = 'shipment-plan'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_sp.id
      AND x.deleted_at IS NULL
  );

-- OR-merge SI → shipment-plan (approve mirrors 060)
UPDATE role_permissions rp_sp
SET
  can_view = rp_sp.can_view OR rp_si.can_view,
  can_edit = rp_sp.can_edit OR rp_si.can_edit,
  can_delete = rp_sp.can_delete OR rp_si.can_delete,
  can_approve = rp_sp.can_approve OR (CASE WHEN rp_si.can_edit THEN TRUE ELSE COALESCE(rp_si.can_approve, FALSE) END),
  updated_at = NOW()
FROM role_permissions rp_si
JOIN permissions p_si
  ON p_si.id = rp_si.permission_id
 AND p_si.deleted_at IS NULL
 AND p_si.resource_type = 'page'
 AND p_si.resource_key = 'shipping-instruction'
JOIN permissions p_sp
  ON p_sp.deleted_at IS NULL
 AND p_sp.resource_type = 'page'
 AND p_sp.resource_key = 'shipment-plan'
WHERE rp_si.deleted_at IS NULL
  AND rp_sp.role_id = rp_si.role_id
  AND rp_sp.permission_id = p_sp.id
  AND rp_sp.deleted_at IS NULL;

-- Soft-delete legacy role_permission rows
UPDATE role_permissions rp
SET deleted_at = NOW(), updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND rp.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key IN ('allocation', 'shipping-instruction');

-- Soft-delete legacy permission catalog rows
UPDATE permissions
SET deleted_at = NOW(), updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key IN ('allocation', 'shipping-instruction')
  AND deleted_at IS NULL;

COMMIT;
