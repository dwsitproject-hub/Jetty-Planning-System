-- Jetty Planning System - Migration 033
-- User to port assignment mapping for port-scoped access.

BEGIN;

CREATE TABLE IF NOT EXISTS user_ports (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ports_active
  ON user_ports(user_id, port_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_ports_user_active
  ON user_ports(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_ports_port_active
  ON user_ports(port_id)
  WHERE deleted_at IS NULL;

COMMIT;
