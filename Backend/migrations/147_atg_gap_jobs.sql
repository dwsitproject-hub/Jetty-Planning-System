-- Background jobs for ATG gap preview / simulate / resync (long Tankvision calls).
-- One running job per operation (partial unique index).

BEGIN;

CREATE TABLE IF NOT EXISTS public.atg_gap_jobs (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'simulate', 'resync')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  gap_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress JSONB,
  result JSONB,
  error TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atg_gap_jobs_running_per_operation
  ON public.atg_gap_jobs (operation_id) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_atg_gap_jobs_operation_created
  ON public.atg_gap_jobs (operation_id, created_at DESC);

COMMIT;
