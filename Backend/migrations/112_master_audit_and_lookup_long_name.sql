-- Master row audit (created_by / updated_by) plus optional long names for Shipper, Surveyor, Agent.
-- Same FK pattern as 044_operations_updated_by.sql.

BEGIN;

ALTER TABLE public.si_shippers
  ADD COLUMN IF NOT EXISTS long_name TEXT;
ALTER TABLE public.si_surveyors
  ADD COLUMN IF NOT EXISTS long_name TEXT;
ALTER TABLE public.si_agents
  ADD COLUMN IF NOT EXISTS long_name TEXT;

COMMENT ON COLUMN public.si_shippers.long_name IS 'Optional full legal / long name. SI and plan dropdowns use name.';
COMMENT ON COLUMN public.si_surveyors.long_name IS 'Optional full legal / long name. SI and plan dropdowns use name.';
COMMENT ON COLUMN public.si_agents.long_name IS 'Optional full legal / long name. SI and plan dropdowns use name.';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ports',
    'jetties',
    'master_tanks',
    'jetty_layouts',
    'si_shippers',
    'si_trade_terms',
    'si_loading_ports',
    'si_surveyors',
    'si_agents',
    'si_commodities'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by BIGINT NULL REFERENCES public.users (id) ON DELETE SET NULL',
      t
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by BIGINT NULL REFERENCES public.users (id) ON DELETE SET NULL',
      t
    );
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.created_by IS %L',
      t,
      'User who created this row.'
    );
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.updated_by IS %L',
      t,
      'User who last updated this row.'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_created_by ON public.%I (created_by) WHERE deleted_at IS NULL AND created_by IS NOT NULL',
      t,
      t
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_updated_by ON public.%I (updated_by) WHERE deleted_at IS NULL AND updated_by IS NOT NULL',
      t,
      t
    );
  END LOOP;
END $$;

COMMIT;
