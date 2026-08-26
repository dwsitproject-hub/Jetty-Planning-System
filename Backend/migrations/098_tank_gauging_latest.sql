-- Tank farm gauging PoC: NXA external id → master_tanks map + latest readings snapshot.
-- RBAC page: tank-farm (view-only for PoC).

BEGIN;

CREATE TABLE IF NOT EXISTS tank_gauging_tank_map (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  external_tank_id INT NOT NULL,
  tank_id BIGINT NOT NULL REFERENCES master_tanks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tank_gauging_tank_map_port_external UNIQUE (port_id, external_tank_id),
  CONSTRAINT uq_tank_gauging_tank_map_tank UNIQUE (tank_id),
  CONSTRAINT chk_tank_gauging_tank_map_external_positive CHECK (external_tank_id > 0)
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_tank_map_port
  ON tank_gauging_tank_map (port_id);

COMMENT ON TABLE tank_gauging_tank_map IS
  'Maps Tankvision/NXA external tank ids to master_tanks for a port.';

CREATE TABLE IF NOT EXISTS tank_gauging_latest (
  tank_id BIGINT PRIMARY KEY REFERENCES master_tanks(id) ON DELETE CASCADE,
  product_name TEXT,
  level_mm NUMERIC,
  temperature_c NUMERIC,
  total_mass NUMERIC,
  flow_rate_tph NUMERIC,
  status_text TEXT,
  recorded_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB,
  source TEXT NOT NULL DEFAULT 'tankvision-gwt'
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_latest_fetched
  ON tank_gauging_latest (fetched_at DESC);

COMMENT ON TABLE tank_gauging_latest IS
  'Latest tank gauging snapshot polled from Tankvision (one row per shore tank).';

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'tank-farm', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'tank-farm'
);

-- Mirror master-tanks view grants onto tank-farm (view only)
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT
  rp.role_id,
  p_new.id,
  rp.can_view,
  FALSE,
  FALSE,
  FALSE,
  NOW()
FROM role_permissions rp
JOIN permissions p_src
  ON p_src.id = rp.permission_id
 AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page'
 AND p_src.resource_key = 'master-tanks'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL
 AND p_new.resource_type = 'page'
 AND p_new.resource_key = 'tank-farm'
WHERE rp.deleted_at IS NULL
  AND rp.can_view = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = p_new.id
      AND x.deleted_at IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, FALSE, FALSE, FALSE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL
 AND p.resource_type = 'page'
 AND p.resource_key = 'tank-farm'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions x
    WHERE x.role_id = r.id
      AND x.permission_id = p.id
      AND x.deleted_at IS NULL
  );

COMMIT;
