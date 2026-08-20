-- Label hand-entered cargo load quantities honestly as manual overrides.
--
-- Before this release nothing forced an atg_qty_mode = 'auto' line's qty to equal
-- the ATG delta, so an operator could type a number while ATG had no data and the
-- row was still stored as ATG-managed. Such a row shows the "ATG not available"
-- checkbox unticked with a read-only field holding a number ATG never produced.
--
-- A genuine auto line's save-time snapshot (atg_mass_delta, added 2026-08-03)
-- equals its stored qty, so a missing or differing snapshot means the number came
-- from a human. Scoped to rows created on/after 2026-08-06, when atg_qty_mode was
-- introduced; note that saving an activity recreates its load lines, so created_at
-- is effectively "last saved at".
--
-- Nothing in the ATG tables is touched, and operation_daily_cargo_progress is left
-- alone: those snapshots are unreachable for a manual line (getOperationalProgress
-- returns at the manual branch, the hourly sweeper skips manual lines) and they are
-- the only ATG record that survives the tank_gauging_samples retention window.
--
-- Review candidates before applying:
--   SELECT l.id, oa.operation_id, l.started_at, l.ended_at, l.qty, l.atg_mass_delta,
--          l.atg_mass_detail->>'error' AS atg_error, l.created_at
--   FROM operation_cargo_load_lines l
--   JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id
--   WHERE l.atg_qty_mode = 'auto' AND l.ended_at IS NOT NULL AND l.qty IS NOT NULL
--   ORDER BY l.created_at DESC;

CREATE TABLE IF NOT EXISTS public.operation_cargo_load_line_qty_mode_backfill (
  load_line_id BIGINT PRIMARY KEY
    REFERENCES public.operation_cargo_load_lines(id) ON DELETE CASCADE,
  prev_atg_qty_mode TEXT NOT NULL,
  qty NUMERIC,
  atg_mass_delta NUMERIC,
  backfilled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.operation_cargo_load_line_qty_mode_backfill IS
  'Rollback record for migration 109: load lines relabelled auto -> manual because their qty did not come from ATG.';

WITH candidates AS (
  SELECT l.id, l.atg_qty_mode, l.qty, l.atg_mass_delta
  FROM public.operation_cargo_load_lines l
  WHERE l.atg_qty_mode = 'auto'
    AND l.ended_at IS NOT NULL
    AND l.qty IS NOT NULL
    AND l.created_at >= TIMESTAMPTZ '2026-08-06T00:00:00Z'
    AND (l.atg_mass_delta IS NULL OR abs(l.qty - l.atg_mass_delta) > 0.001)
    AND EXISTS (
      SELECT 1
      FROM public.operation_cargo_load_line_tanks clt
      JOIN public.tank_gauging_tank_map m ON m.tank_id = clt.tank_id
      JOIN public.tank_gauging_sources s
        ON s.port_id = m.port_id
       AND s.base_url = m.source_base_url
       AND s.enabled = TRUE
      WHERE clt.load_line_id = l.id
    )
)
INSERT INTO public.operation_cargo_load_line_qty_mode_backfill (
  load_line_id, prev_atg_qty_mode, qty, atg_mass_delta
)
SELECT id, atg_qty_mode, qty, atg_mass_delta
FROM candidates
ON CONFLICT (load_line_id) DO NOTHING;

UPDATE public.operation_cargo_load_lines l
SET atg_qty_mode = 'manual'
WHERE l.atg_qty_mode = 'auto'
  AND EXISTS (
    SELECT 1
    FROM public.operation_cargo_load_line_qty_mode_backfill b
    WHERE b.load_line_id = l.id
  );
