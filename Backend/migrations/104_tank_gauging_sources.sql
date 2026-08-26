-- DB-backed Tankvision / ATG source configuration per port + tank-farm edit RBAC.

BEGIN;

CREATE TABLE IF NOT EXISTS tank_gauging_sources (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auth_type TEXT NOT NULL DEFAULT 'none',
  auth_user TEXT,
  auth_secret_encrypted TEXT,
  last_poll_at TIMESTAMPTZ,
  last_poll_ok BOOLEAN,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_tank_gauging_sources_port_base_url UNIQUE (port_id, base_url),
  CONSTRAINT chk_tank_gauging_sources_auth_type CHECK (auth_type IN ('none', 'basic', 'cookie'))
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_sources_port_enabled
  ON tank_gauging_sources (port_id, enabled);

COMMENT ON TABLE tank_gauging_sources IS
  'Tankvision/NXA ATG host configuration per port (credentials encrypted at rest).';

COMMENT ON COLUMN tank_gauging_sources.base_url IS
  'Base URL without trailing slash or /index.esp (e.g. http://172.16.246.12).';

-- Mirror master-tanks edit grants onto tank-farm (Configuration modal).
UPDATE role_permissions rp
SET can_edit = src.can_edit,
    updated_at = NOW()
FROM role_permissions src
JOIN permissions p_src
  ON p_src.id = src.permission_id
 AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page'
 AND p_src.resource_key = 'master-tanks'
JOIN permissions p_tf
  ON p_tf.deleted_at IS NULL
 AND p_tf.resource_type = 'page'
 AND p_tf.resource_key = 'tank-farm'
WHERE rp.role_id = src.role_id
  AND rp.permission_id = p_tf.id
  AND rp.deleted_at IS NULL
  AND src.deleted_at IS NULL
  AND src.can_edit = TRUE;

-- Optional Bontang seed (port 1): open hosts only — no credentials in SQL.
INSERT INTO tank_gauging_sources (port_id, base_url, label, enabled, auth_type)
SELECT v.port_id, v.base_url, v.label, v.enabled, 'none'
FROM (
  VALUES
    (1::bigint, 'http://172.16.11.77', 'NXA820 (open)', TRUE),
    (1::bigint, 'http://172.16.246.10', 'NXA820 OLEO 1', TRUE),
    (1::bigint, 'http://172.16.246.11', 'NXA820 OLEO 2 (pending)', FALSE)
) AS v(port_id, base_url, label, enabled)
WHERE EXISTS (SELECT 1 FROM ports WHERE id = v.port_id)
ON CONFLICT (port_id, base_url) DO NOTHING;

COMMIT;
