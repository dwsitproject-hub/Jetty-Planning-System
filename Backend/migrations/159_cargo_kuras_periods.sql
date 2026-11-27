-- Mixed (Normal & Kuras) movement: while an entry keeps pumping, other palkas are cleaned (kuras)
-- into the same tank. Each cleaned palka is a period (palka, from, until, optional quantity) that
-- belongs to one cargo entry. The moved quantity still comes from ATG once; a period quantity only
-- says how much of it was cleaning.
-- Rollback: Backend/rollback/159_rollback_cargo_kuras_periods.sql

BEGIN;

-- movement_type gains 'mixed' (manual only; auto never picks it).
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.operation_cargo_load_lines'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%movement_type%'
      AND pg_get_constraintdef(con.oid) ILIKE '%kuras%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%movement_type_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.operation_cargo_load_lines DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_movement_type_check
  CHECK (movement_type IS NULL OR movement_type IN ('normal', 'kuras', 'mixed'));

CREATE TABLE IF NOT EXISTS public.operation_cargo_kuras_periods (
  id BIGSERIAL PRIMARY KEY,
  load_line_id BIGINT NOT NULL REFERENCES public.operation_cargo_load_lines(id) ON DELETE CASCADE,
  palka TEXT NOT NULL CHECK (palka ~ '^[A-Z0-9]{1,3}$'),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  qty NUMERIC(20, 6) CHECK (qty IS NULL OR qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_operation_cargo_kuras_periods_line
  ON public.operation_cargo_kuras_periods (load_line_id, started_at);

COMMENT ON TABLE public.operation_cargo_kuras_periods IS
  'Kuras (cleaning) of another palka while the entry keeps pumping into the same tank (movement_type = mixed).';

COMMIT;
