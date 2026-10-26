-- Master Company: DataHub organization/company replica, plus which companies
-- each operated port uses. Company is stored on the shipping instruction.

BEGIN;

CREATE TABLE IF NOT EXISTS master_companies (
  id BIGSERIAL PRIMARY KEY,
  hub_code TEXT,
  hub_record_id UUID,
  hub_version INT,
  hub_updated_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  short_name TEXT,
  company_code_sap TEXT,
  country TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  datahub_last_apply_source TEXT,
  datahub_last_apply_run_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_companies_hub_code_active
  ON master_companies (hub_code)
  WHERE deleted_at IS NULL AND hub_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_companies_name_active
  ON master_companies (LOWER(name))
  WHERE deleted_at IS NULL;

COMMENT ON TABLE master_companies IS
  'Operating-company directory. Identity is a reviewed replica of DataHub company/organization. Port use is local.';
COMMENT ON COLUMN master_companies.is_active IS
  'From DataHub. Inactive companies stay in the directory and drop out of port checklists and instruction pickers.';
COMMENT ON COLUMN master_companies.datahub_last_apply_source IS
  'webhook or manual_sync when the last apply came from DataHub; null otherwise.';

CREATE TABLE IF NOT EXISTS port_companies (
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES master_companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (port_id, company_id)
);

COMMENT ON TABLE port_companies IS
  'Which DataHub companies an operated port uses. Local to JPS; DataHub sync does not replace these rows.';

ALTER TABLE shipping_instructions
  ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES master_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_instructions_company_id
  ON shipping_instructions (company_id)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN shipping_instructions.company_id IS
  'Operating company for this instruction. One instruction has one company. Allowed values are the companies mapped to the plan port.';

ALTER TABLE datahub_vessel_sync_runs
  DROP CONSTRAINT IF EXISTS datahub_vessel_sync_runs_entity_type_check;

ALTER TABLE datahub_vessel_sync_runs
  ADD CONSTRAINT datahub_vessel_sync_runs_entity_type_check
  CHECK (entity_type IN ('vessel', 'incoterm', 'commodity', 'port_master', 'organization'));

UPDATE permissions
SET
  deleted_at = NULL,
  can_view = FALSE,
  can_edit = FALSE,
  can_delete = FALSE,
  updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key = 'master-company'
  AND deleted_at IS NOT NULL;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-company', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'master-company'
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
JOIN permissions p_src
  ON p_src.id = rp.permission_id
 AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page'
 AND p_src.resource_key = 'master-vessel'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL
 AND p_new.resource_type = 'page'
 AND p_new.resource_key = 'master-company'
WHERE rp.deleted_at IS NULL
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
 AND p.resource_key = 'master-company'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
