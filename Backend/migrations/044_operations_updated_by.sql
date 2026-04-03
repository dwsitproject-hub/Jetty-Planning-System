-- Track who last updated an operation row (for Allocation Active Vessel Detail "Last updated by").

BEGIN;

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS updated_by BIGINT NULL REFERENCES public.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.operations.updated_by IS 'User who last updated this operation row (any module).';

CREATE INDEX IF NOT EXISTS idx_operations_updated_by ON public.operations (updated_by) WHERE deleted_at IS NULL AND updated_by IS NOT NULL;

COMMIT;
