-- Rollback migration 143: restore movement_status CHECK without direction_mismatch.
-- Fails if any rows still use direction_mismatch; update those rows before rollback.

BEGIN;

UPDATE public.operation_hourly_cargo_progress
SET movement_status = 'incomplete'
WHERE movement_status = 'direction_mismatch';

ALTER TABLE public.operation_hourly_cargo_progress
  DROP CONSTRAINT IF EXISTS operation_hourly_cargo_progress_movement_status_check;

ALTER TABLE public.operation_hourly_cargo_progress
  ADD CONSTRAINT operation_hourly_cargo_progress_movement_status_check
  CHECK (movement_status IN ('active', 'flat_movement', 'incomplete'));

COMMIT;
