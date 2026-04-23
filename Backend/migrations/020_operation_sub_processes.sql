-- Hybrid persistence: generalized operation sub-process records.

CREATE TABLE IF NOT EXISTS operation_sub_processes (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('Pre-Checking', 'Operational', 'Post-Checking')),
  sub_process_key TEXT NOT NULL,
  status TEXT CHECK (status IN ('Pending', 'In Progress', 'Done', 'N/A')),
  occurred_at TIMESTAMPTZ,
  remark TEXT,
  payload_json JSONB,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_sub_processes_unique_active
  ON operation_sub_processes(operation_id, phase, sub_process_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_sub_processes_operation_phase_active
  ON operation_sub_processes(operation_id, phase)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_sub_processes_key_active
  ON operation_sub_processes(sub_process_key)
  WHERE deleted_at IS NULL;

