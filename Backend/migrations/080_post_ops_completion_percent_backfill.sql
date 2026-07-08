-- POST_OPS means Post-Checking is complete; legacy rows may still have completion_percent = 0.
-- Aligns allocation overview and multi-SI sign-off peer checks with backend sign-off normalization.

UPDATE public.operations
SET completion_percent = 100,
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND status = 'POST_OPS'
  AND COALESCE(completion_percent, 0) < 100;
