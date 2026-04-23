-- Jetty Planning System - Migration 007
-- Soft delete: deleted_at on all business tables; partial unique indexes for re-use after delete.

BEGIN;

-- ---------- users ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active ON users (username) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active ON users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;

-- ---------- roles ----------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_active ON roles (name) WHERE deleted_at IS NULL;

-- ---------- permissions ----------
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_resource_type_resource_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_resource_active
  ON permissions (resource_type, resource_key) WHERE deleted_at IS NULL;

-- ---------- role_permissions: surrogate PK + soft delete ----------
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permissions' AND column_name = 'id'
  ) THEN
    ALTER TABLE role_permissions ADD COLUMN id BIGSERIAL;
    ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_pkey;
    ALTER TABLE role_permissions ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_active
  ON role_permissions (role_id, permission_id) WHERE deleted_at IS NULL;

-- ---------- user_roles ----------
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'id'
  ) THEN
    ALTER TABLE user_roles ADD COLUMN id BIGSERIAL;
    ALTER TABLE user_roles DROP CONSTRAINT user_roles_pkey;
    ALTER TABLE user_roles ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_active
  ON user_roles (user_id, role_id) WHERE deleted_at IS NULL;

-- ---------- ports, jetties ----------
ALTER TABLE ports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE jetties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------- jetty_status_history ----------
ALTER TABLE jetty_status_history ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE jetty_status_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE jetty_status_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE jetty_status_history SET created_at = COALESCE(changed_at, NOW()), updated_at = COALESCE(changed_at, NOW())
  WHERE created_at IS NULL;
ALTER TABLE jetty_status_history ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE jetty_status_history ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE jetty_status_history ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE jetty_status_history ALTER COLUMN updated_at SET DEFAULT NOW();

-- ---------- sla_config ----------
ALTER TABLE sla_config ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sla_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE sla_config SET created_at = COALESCE(updated_at, NOW()) WHERE created_at IS NULL;
ALTER TABLE sla_config ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE sla_config ALTER COLUMN created_at SET DEFAULT NOW();

-- ---------- standard_rates ----------
ALTER TABLE standard_rates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE standard_rates DROP CONSTRAINT IF EXISTS standard_rates_material_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_standard_rates_material_active
  ON standard_rates (material_key) WHERE deleted_at IS NULL;

-- ---------- shipping_instructions, operations, operation_materials ----------
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE operation_materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_materials_op_key_active
  ON operation_materials (operation_id, material_key) WHERE deleted_at IS NULL;

-- ---------- qc_surveys, qc_documents, quantity_checks ----------
ALTER TABLE qc_surveys ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE qc_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE qc_documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE qc_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE qc_documents SET created_at = uploaded_at, updated_at = uploaded_at WHERE created_at IS NULL;
ALTER TABLE qc_documents ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE qc_documents ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE quantity_checks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMIT;
