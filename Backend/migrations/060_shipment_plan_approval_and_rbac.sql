-- Shipment plan approval workflow + plan reference + RBAC page `shipment-plan`.

BEGIN;

-- --- shipment_plans: approval + audit ---
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS approval_status TEXT;
UPDATE shipment_plans SET approval_status = 'Approved' WHERE approval_status IS NULL;
ALTER TABLE shipment_plans ALTER COLUMN approval_status SET NOT NULL;
ALTER TABLE shipment_plans ALTER COLUMN approval_status SET DEFAULT 'Draft';

DO $$
BEGIN
  ALTER TABLE shipment_plans
    ADD CONSTRAINT shipment_plans_approval_status_check
    CHECK (approval_status IN ('Draft', 'Submitted', 'Approved', 'Rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS plan_reference TEXT;
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE shipment_plans ADD COLUMN IF NOT EXISTS approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

UPDATE shipment_plans
SET plan_reference = 'SP-LEG-' || id::text
WHERE plan_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_plans_port_plan_reference
  ON shipment_plans (port_id, plan_reference)
  WHERE plan_reference IS NOT NULL;

-- --- RBAC catalog ---
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'shipment-plan', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'shipment-plan'
);

-- Mirror Shipping Instruction role grants onto Shipment Plan (view/edit/delete + approve when SI role had edit).
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
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_sp.id
      AND x.deleted_at IS NULL
  );

-- JPS Full Access: grant new page (041 only backfilled pages that existed at migration time).
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL
 AND p.resource_type = 'page'
 AND p.resource_key = 'shipment-plan'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
