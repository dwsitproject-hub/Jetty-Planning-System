-- IANA timezone for interpreting schedule/datetime-local fields (ETA, ETB, subprocess times).
-- Default aligns with JETTY_OPERATION_CODE_TIMEZONE / migration 056 backfill convention.
ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta';

COMMENT ON COLUMN public.ports.schedule_timezone IS 'IANA zone for port schedule wall times (e.g. Asia/Jakarta, Asia/Makassar).';
