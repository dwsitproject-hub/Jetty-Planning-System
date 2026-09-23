-- Master Vessel: local replica of the DataHub (DHM) vessel master, the DataHub
-- API credentials, and the staging tables that let a user review a sync before
-- it is applied. Nothing here is wired into shipment plans yet.

BEGIN;

CREATE TABLE IF NOT EXISTS master_vessels (
  id BIGSERIAL PRIMARY KEY,
  -- Hub linkage. Null until the row has been matched to a DHM record.
  hub_code TEXT,
  hub_record_id UUID,
  hub_version INT,
  hub_updated_at TIMESTAMPTZ,
  -- Canonical DHM vessel fields. `vessel_length_overall` is spelled correctly
  -- here; the hub contract misspells it as Vessel_Length_Overral and the client
  -- maps between the two.
  vessel_name TEXT NOT NULL,
  vessel_imo TEXT,
  vessel_mmsi TEXT,
  vessel_code_sap TEXT,
  vessel_capacity_mt NUMERIC(14,3),
  vessel_gross_tonnage NUMERIC(14,3),
  vessel_draft NUMERIC(10,2),
  vessel_length_overall TEXT,
  vessel_type TEXT,
  heater BOOLEAN,
  type_lambung TEXT,
  type_charter TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_vessels_name_active
  ON master_vessels (LOWER(vessel_name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_vessels_hub_code_active
  ON master_vessels (hub_code)
  WHERE deleted_at IS NULL AND hub_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_vessels_type_active
  ON master_vessels (vessel_type)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE master_vessels IS
  'Vessel master held in JPS as a reviewed replica of the DataHub (DHM) vessel golden records.';

-- Singleton DataHub API configuration. Same shape as smtp_config: the private
-- key is encrypted at rest and never returned to the client.
CREATE TABLE IF NOT EXISTS datahub_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  base_url TEXT,
  public_key TEXT,
  private_key_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  last_sync_ok BOOLEAN,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO datahub_config (id, enabled)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE datahub_config IS
  'DataHub client credentials and base URL. public_key is an identifier; private key is AES-256-GCM encrypted.';

-- One row per sync attempt. Staged rows live in datahub_vessel_sync_items until
-- the user applies or discards the run, so nothing touches master_vessels
-- without an explicit review.
CREATE TABLE IF NOT EXISTS datahub_vessel_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'applied', 'discarded', 'failed')),
  hub_record_count INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  changed_count INT NOT NULL DEFAULT 0,
  unchanged_count INT NOT NULL DEFAULT 0,
  applied_count INT NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  applied_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_datahub_vessel_sync_runs_status_started
  ON datahub_vessel_sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS datahub_vessel_sync_items (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES datahub_vessel_sync_runs(id) ON DELETE CASCADE,
  vessel_id BIGINT REFERENCES master_vessels(id) ON DELETE SET NULL,
  hub_code TEXT,
  vessel_name TEXT NOT NULL,
  diff_kind TEXT NOT NULL CHECK (diff_kind IN ('new', 'changed', 'unchanged')),
  payload JSONB NOT NULL,
  field_diff JSONB,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'rejected')),
  applied_at TIMESTAMPTZ,
  apply_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_datahub_vessel_sync_items_run
  ON datahub_vessel_sync_items (run_id, diff_kind);

COMMENT ON TABLE datahub_vessel_sync_items IS
  'Staged DataHub vessel records awaiting user review; only approved rows are written to master_vessels.';

-- RBAC page catalog
-- After pg_restore the permissions id sequence can lag behind MAX(id) and cause
-- "duplicate key value violates unique constraint permissions_pkey".
SELECT setval(
  pg_get_serial_sequence('permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM permissions), 0)
);

-- Revive a soft-deleted row instead of inserting a duplicate resource_key.
UPDATE permissions
SET
  deleted_at = NULL,
  can_view = FALSE,
  can_edit = FALSE,
  can_delete = FALSE,
  updated_at = NOW()
WHERE resource_type = 'page'
  AND resource_key = 'master-vessel'
  AND deleted_at IS NOT NULL;

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-vessel', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'master-vessel'
);

SELECT setval(
  pg_get_serial_sequence('role_permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM role_permissions), 0)
);

-- Mirror master-jetty grants onto master-vessel
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
JOIN permissions p_jetty
  ON p_jetty.id = rp.permission_id
 AND p_jetty.deleted_at IS NULL
 AND p_jetty.resource_type = 'page'
 AND p_jetty.resource_key = 'master-jetty'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL
 AND p_new.resource_type = 'page'
 AND p_new.resource_key = 'master-vessel'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_new.id
      AND x.deleted_at IS NULL
  );

-- Ensure JPS Full Access has full flags
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL
 AND p.resource_type = 'page'
 AND p.resource_key = 'master-vessel'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
