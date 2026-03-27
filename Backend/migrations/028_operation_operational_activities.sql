-- Operational milestone activities + N/A rows (merged entry_type).

CREATE TABLE IF NOT EXISTS operation_operational_activities (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('activity', 'milestone_na')),
  milestone_key TEXT NOT NULL,
  sub_step_title TEXT,
  remark TEXT,
  reason TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_operational_activity_entry_fields CHECK (
    (entry_type = 'activity' AND reason IS NULL AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at >= start_at)
    OR (entry_type = 'milestone_na' AND start_at IS NULL AND end_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_operational_activities_na_unique
  ON operation_operational_activities (operation_id, milestone_key)
  WHERE entry_type = 'milestone_na' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_operational_activities_op_activity
  ON operation_operational_activities (operation_id, start_at)
  WHERE entry_type = 'activity' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_operational_activities_op_all
  ON operation_operational_activities (operation_id)
  WHERE deleted_at IS NULL;
