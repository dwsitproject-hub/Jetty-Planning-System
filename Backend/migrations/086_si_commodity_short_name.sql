-- Short abbreviation for SI commodities (e.g. CPO for Crude Palm Oil).

BEGIN;

ALTER TABLE public.si_commodities
  ADD COLUMN IF NOT EXISTS short_name TEXT;

-- Backfill all rows (including soft-deleted) before SET NOT NULL.
UPDATE public.si_commodities
SET short_name = name
WHERE short_name IS NULL AND name IS NOT NULL;

UPDATE public.si_commodities
SET short_name = 'COMMODITY-' || id::text
WHERE short_name IS NULL;

ALTER TABLE public.si_commodities
  ALTER COLUMN short_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_si_commodities_short_name_active
  ON public.si_commodities (LOWER(short_name)) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.si_commodities.short_name IS 'Abbreviation/code for the commodity (e.g. CPO for Crude Palm Oil). Unique among active rows.';

COMMIT;
