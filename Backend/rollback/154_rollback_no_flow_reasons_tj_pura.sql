-- Rollback migration 154. Nothing is deleted: stops already recorded keep their reason.
-- The added reasons are deactivated (hidden from the stop form), KRS is active again, and any
-- reason in the kuras_crew group moves to vessel so the original category check can return.

BEGIN;

UPDATE public.master_no_flow_reasons
SET is_active = FALSE, updated_at = NOW()
WHERE deleted_at IS NULL
  AND UPPER(code) IN ('OVT', 'WST', 'CHL', 'VAC', 'LST', 'RSH', 'RHS', 'CTT', 'TOP',
                      'RSP', 'RSL', 'CFP', 'EOH', 'HPS', 'HSP', 'LKO',
                      'WCC', 'CCB', 'SFT', 'HOA', 'FWT', 'BRK');

UPDATE public.master_no_flow_reasons
SET is_active = TRUE, updated_at = NOW()
WHERE UPPER(code) = 'KRS' AND deleted_at IS NULL;

UPDATE public.master_no_flow_reasons
SET category = 'vessel', updated_at = NOW()
WHERE category = 'kuras_crew';

ALTER TABLE public.master_no_flow_reasons
  DROP CONSTRAINT IF EXISTS master_no_flow_reasons_category_check;

ALTER TABLE public.master_no_flow_reasons
  ADD CONSTRAINT master_no_flow_reasons_category_check
  CHECK (category IN ('terminal', 'vessel', 'external', 'other'));

DELETE FROM public.schema_migrations WHERE name = '154_no_flow_reasons_tj_pura.sql';

COMMIT;
