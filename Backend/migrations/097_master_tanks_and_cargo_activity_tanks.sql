-- Shore tanks master (per port) + cargo activity tank selections + RBAC page permission.

BEGIN;

CREATE TABLE IF NOT EXISTS master_tanks (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_tanks_port_code_active
  ON master_tanks (port_id, LOWER(code))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_master_tanks_port_id
  ON master_tanks (port_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE master_tanks IS
  'Shore tank master data per port; used for liquid Cargo Operations source/destination selection.';

CREATE TABLE IF NOT EXISTS operation_cargo_activity_tanks (
  operational_activity_id BIGINT NOT NULL
    REFERENCES operation_operational_activities(id) ON DELETE CASCADE,
  tank_id BIGINT NOT NULL
    REFERENCES master_tanks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (operational_activity_id, tank_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_cargo_activity_tanks_tank
  ON operation_cargo_activity_tanks (tank_id);

COMMENT ON TABLE operation_cargo_activity_tanks IS
  'Shore tanks selected on a cargo_operations activity (multi-select; liquid only).';

-- RBAC page catalog
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-tanks', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL
    AND p.resource_type = 'page'
    AND p.resource_key = 'master-tanks'
);

-- Mirror master-jetty grants onto master-tanks
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
 AND p_new.resource_key = 'master-tanks'
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
 AND p.resource_key = 'master-tanks'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

-- Seed 67 tank codes for every active port (idempotent)
INSERT INTO master_tanks (port_id, code, sort_order)
SELECT p.id, v.code, v.sort_order
FROM ports p
CROSS JOIN (
  VALUES
    (1, '5104'),
    (2, '3203'),
    (3, '3502'),
    (4, '3602'),
    (5, '3101'),
    (6, '5102'),
    (7, 'Bak 5-8'),
    (8, 'Bak 1-4'),
    (9, 'Bak 9-12'),
    (10, '501'),
    (11, '3102'),
    (12, '5101'),
    (13, '502'),
    (14, '5201'),
    (15, '5202'),
    (16, '5204'),
    (17, '5003'),
    (18, '5002'),
    (19, '5004'),
    (20, '5007'),
    (21, '310'),
    (22, '311'),
    (23, '301'),
    (24, '302'),
    (25, '5001'),
    (26, '1003'),
    (27, '151'),
    (28, '152'),
    (29, '5103'),
    (30, '1501'),
    (31, '1000'),
    (32, '3000'),
    (33, '3702'),
    (34, '5203'),
    (35, '3202'),
    (36, '1502'),
    (37, '3201'),
    (38, '505'),
    (39, '506'),
    (40, '2101'),
    (41, '2102'),
    (42, '5111'),
    (43, '503'),
    (44, '504'),
    (45, '2103'),
    (46, '2104'),
    (47, '101'),
    (48, '102'),
    (49, '304'),
    (50, '305'),
    (51, '306'),
    (52, '307'),
    (53, '54'),
    (54, '52'),
    (55, '59'),
    (56, '57'),
    (57, '5005'),
    (58, '5006'),
    (59, '303'),
    (60, '400'),
    (61, '1001'),
    (62, '1002'),
    (63, '53'),
    (64, '58'),
    (65, '51'),
    (66, '56'),
    (67, 'Tangki Tidur')
) AS v(sort_order, code)
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM master_tanks t
    WHERE t.port_id = p.id
      AND t.deleted_at IS NULL
      AND LOWER(t.code) = LOWER(v.code)
  );

COMMIT;
