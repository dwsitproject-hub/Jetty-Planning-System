-- Loading SI document fields, approval audit columns, optional user job title, RBAC can_approve.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;

ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS voyage_no TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS destination_text TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS freight_terms TEXT
  CHECK (
    freight_terms IS NULL
    OR freight_terms IN ('PREPAID', 'COLLECT', 'AS_PER_CHARTER_PARTY', 'OTHER')
  );
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS bill_of_lading_clause TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS consignee_text TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS notify_party_text TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS bl_indicated TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS document_date DATE;

ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS approver_name_snapshot TEXT;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS approver_title_snapshot TEXT;

ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_approve BOOLEAN NOT NULL DEFAULT FALSE;

-- Users who could already edit Shipping Instructions may approve (adjust in Admin → Roles if stricter control is needed).
UPDATE role_permissions rp
SET
  can_approve = TRUE,
  updated_at = NOW()
FROM permissions p
WHERE p.id = rp.permission_id
  AND rp.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key = 'shipping-instruction'
  AND rp.can_edit = TRUE;

COMMIT;
