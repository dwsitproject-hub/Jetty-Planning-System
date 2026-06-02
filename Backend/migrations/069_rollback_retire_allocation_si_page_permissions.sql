-- Rollback companion for `068_retire_allocation_si_page_permissions.sql`.
-- Revives soft-deleted catalog rows `allocation` and `shipping-instruction` and their role_permissions links.
-- WARNING: Only use when no conflicting active rows exist; prefer restoring `permissions` + `role_permissions`
-- from a snapshot if grants diverged after 068. Review in staging before production.

BEGIN;

UPDATE permissions
SET deleted_at = NULL, updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key IN ('allocation', 'shipping-instruction');

UPDATE role_permissions rp
SET deleted_at = NULL, updated_at = NOW()
FROM permissions p
WHERE rp.permission_id = p.id
  AND p.resource_type = 'page'
  AND p.resource_key IN ('allocation', 'shipping-instruction')
  AND rp.deleted_at IS NOT NULL;

COMMIT;
