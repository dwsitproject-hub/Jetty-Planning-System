-- Jetty Planning System - Migration 017
-- Store uploaded documents metadata for operations (NOR, photos, etc.).

BEGIN;

CREATE TABLE IF NOT EXISTS operation_documents (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_operation_documents_operation_id_active
  ON operation_documents(operation_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_documents_kind_active
  ON operation_documents(kind) WHERE deleted_at IS NULL;

COMMIT;

