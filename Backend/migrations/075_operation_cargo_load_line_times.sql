-- Per load line: segment window (started_at, ended_at) for rate = qty / (ended - started).
-- Replaces legacy as_of_at (reading instant).

BEGIN;

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Backfill: ended_at = former reading time; started_at = previous line's ended_at or activity start_at.
WITH lined AS (
  SELECT
    l.id,
    oa.start_at AS act_start,
    l.as_of_at AS legacy_end,
    LAG(l.as_of_at) OVER (
      PARTITION BY l.operational_activity_id
      ORDER BY l.line_order, l.id
    ) AS prev_end
  FROM public.operation_cargo_load_lines l
  JOIN public.operation_operational_activities oa
    ON oa.id = l.operational_activity_id
)
UPDATE public.operation_cargo_load_lines l
SET
  ended_at = lined.legacy_end,
  started_at = COALESCE(lined.prev_end, lined.act_start)
FROM lined
WHERE l.id = lined.id;

-- Ensure ended > started (single-point legacy rows).
UPDATE public.operation_cargo_load_lines
SET ended_at = started_at + INTERVAL '1 second'
WHERE ended_at IS NOT NULL
  AND started_at IS NOT NULL
  AND ended_at <= started_at;

ALTER TABLE public.operation_cargo_load_lines
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN ended_at SET NOT NULL;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_segment_positive
  CHECK (ended_at > started_at);

ALTER TABLE public.operation_cargo_load_lines
  DROP COLUMN IF EXISTS as_of_at;

COMMENT ON TABLE public.operation_cargo_load_lines IS
  'Per-line qty + segment [started_at, ended_at) for cargo_operations (rate = qty / duration).';

COMMIT;
