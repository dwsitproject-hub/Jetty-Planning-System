-- Source-level ATG recovery runs as a background job too: jobs are no longer tied to one operation.
-- One running job per source (partial unique index on source_key).

BEGIN;

ALTER TABLE public.atg_gap_jobs ALTER COLUMN operation_id DROP NOT NULL;

ALTER TABLE public.atg_gap_jobs ADD COLUMN IF NOT EXISTS source_key TEXT;

ALTER TABLE public.atg_gap_jobs DROP CONSTRAINT IF EXISTS atg_gap_jobs_kind_check;
ALTER TABLE public.atg_gap_jobs
  ADD CONSTRAINT atg_gap_jobs_kind_check
  CHECK (kind IN ('preview', 'simulate', 'resync', 'source_preview', 'source_recover'));

ALTER TABLE public.atg_gap_jobs DROP CONSTRAINT IF EXISTS atg_gap_jobs_target_check;
ALTER TABLE public.atg_gap_jobs
  ADD CONSTRAINT atg_gap_jobs_target_check
  CHECK (operation_id IS NOT NULL OR source_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atg_gap_jobs_running_per_source
  ON public.atg_gap_jobs (source_key)
  WHERE status = 'running' AND source_key IS NOT NULL;

COMMIT;
