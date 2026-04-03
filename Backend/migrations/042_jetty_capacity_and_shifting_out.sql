-- Jetty capacity (double bank / multi-bank) + shifting-out flag for preemption.
--
-- Jetty capacity:
-- - capacity = number of vessels allowed concurrently on the same jetty (default 1).
--
-- Shifting out:
-- - shifting_out indicates the vessel temporarily leaves the berth and should NOT occupy the jetty capacity.
-- - shifting_out_at records when the shift-out was triggered (for audit + schedule rendering).

ALTER TABLE public.jetties
  ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'jetties'
      AND c.conname = 'jetties_capacity_min'
  ) THEN
    ALTER TABLE public.jetties
      ADD CONSTRAINT jetties_capacity_min CHECK (capacity >= 1);
  END IF;
END $$;

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS shifting_out boolean NOT NULL DEFAULT false;

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS shifting_out_at timestamptz NULL;

