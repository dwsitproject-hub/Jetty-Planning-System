-- Grant SI delete to roles that can already edit Shipping Instructions (tune in Admin → Roles if needed).

BEGIN;

UPDATE role_permissions rp
SET
  can_delete = TRUE,
  updated_at = NOW()
FROM permissions p
WHERE p.id = rp.permission_id
  AND rp.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND p.resource_type = 'page'
  AND p.resource_key = 'shipping-instruction'
  AND rp.can_edit = TRUE;

COMMIT;
