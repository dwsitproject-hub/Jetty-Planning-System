-- Allow multiple standard_rates rows per commodity by replacing the legacy unique index
-- (idx_standard_rates_commodity_active) with the new composite unique index from migration 037.

BEGIN;

DROP INDEX IF EXISTS public.idx_standard_rates_commodity_active;

COMMIT;

