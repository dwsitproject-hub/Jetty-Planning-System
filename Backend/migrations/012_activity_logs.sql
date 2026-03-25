-- Jetty Planning System - Migration 012
-- Activity logs (DB-backed audit) + seed permission for viewing logs.

BEGIN;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  page_key TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  entity_label TEXT,
  summary TEXT NOT NULL,
  changes_json JSONB,
  meta_json JSONB,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_page_created
  ON activity_logs (page_key, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity
  ON activity_logs (entity_type, entity_id) WHERE deleted_at IS NULL;

-- Seed RBAC permission: page activity-log (view)
INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'activity-log', TRUE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.resource_type = 'page' AND p.resource_key = 'activity-log' AND p.deleted_at IS NULL
);

COMMIT;

