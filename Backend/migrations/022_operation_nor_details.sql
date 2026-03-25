-- Hybrid persistence: NOR-specific note/metadata.

CREATE TABLE IF NOT EXISTS operation_nor_details (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  remark TEXT,
  payload_json JSONB,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_nor_details_operation_unique_active
  ON operation_nor_details(operation_id)
  WHERE deleted_at IS NULL;

