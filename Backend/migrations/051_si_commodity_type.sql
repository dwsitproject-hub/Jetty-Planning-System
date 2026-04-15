-- Solid / Liquid classification for SI commodities (UAT: one type per SI enforced in API).

BEGIN;

ALTER TABLE public.si_commodities
  ADD COLUMN IF NOT EXISTS commodity_type TEXT NOT NULL DEFAULT 'Liquid';

ALTER TABLE public.si_commodities
  DROP CONSTRAINT IF EXISTS chk_si_commodities_type;

ALTER TABLE public.si_commodities
  ADD CONSTRAINT chk_si_commodities_type CHECK (commodity_type IN ('Solid', 'Liquid'));

COMMENT ON COLUMN public.si_commodities.commodity_type IS 'Physical form: Solid or Liquid. All breakdown lines on one SI must share the same type.';

COMMIT;
