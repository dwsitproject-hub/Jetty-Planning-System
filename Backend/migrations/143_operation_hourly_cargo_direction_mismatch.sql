-- Allow direction_mismatch in persisted hourly cargo progress (matches UI / classifyHourDisplayStatus).

ALTER TABLE public.operation_hourly_cargo_progress
  DROP CONSTRAINT IF EXISTS operation_hourly_cargo_progress_movement_status_check;

ALTER TABLE public.operation_hourly_cargo_progress
  ADD CONSTRAINT operation_hourly_cargo_progress_movement_status_check
  CHECK (movement_status IN ('active', 'flat_movement', 'incomplete', 'direction_mismatch'));

COMMENT ON COLUMN public.operation_hourly_cargo_progress.movement_status IS
  'Clock-hour movement label: active, flat_movement, incomplete, or direction_mismatch (reverse ATG vs cargo purpose).';
