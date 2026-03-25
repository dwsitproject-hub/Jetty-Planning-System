-- Hybrid persistence: documents for generalized operation sub-process rows.

CREATE TABLE IF NOT EXISTS operation_sub_process_documents (
  id BIGSERIAL PRIMARY KEY,
  sub_process_id BIGINT NOT NULL REFERENCES operation_sub_processes(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_operation_sub_process_documents_sub_process_active
  ON operation_sub_process_documents(sub_process_id)
  WHERE deleted_at IS NULL;

