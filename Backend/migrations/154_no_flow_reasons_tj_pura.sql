-- Stop reasons from Tj Pura's timesheets and discharge rate report, merged into the shared list.
-- Adds the "kuras_crew" who-caused group (cleaning crew waited for / on break).
-- Kuras itself is cargo work (tracked by the Kuras movement type), not a stop, so KRS is deactivated.
-- Existing codes are kept as they are. Rollback: Backend/rollback/154_rollback_no_flow_reasons_tj_pura.sql

BEGIN;

ALTER TABLE public.master_no_flow_reasons
  DROP CONSTRAINT IF EXISTS master_no_flow_reasons_category_check;

ALTER TABLE public.master_no_flow_reasons
  ADD CONSTRAINT master_no_flow_reasons_category_check
  CHECK (category IN ('terminal', 'vessel', 'kuras_crew', 'external', 'other'));

CREATE TEMP TABLE tmp_tj_pura_reasons ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('OVT', 'Over tank (shore tank full)',        'Overtank (tangki darat penuh)',         'terminal',   200),
  ('WST', 'Waiting shore tank readiness',       'Menunggu kesiapan tangki darat',        'terminal',   210),
  ('CHL', 'Change line',                        'Ganti line',                            'terminal',   220),
  ('VAC', 'Vacuum',                             'Vakum',                                 'terminal',   230),
  ('LST', 'Discharge line stuck',               'Line bongkar macet',                    'terminal',   240),
  ('RSH', 'Repair shore line',                  'Perbaikan line darat',                  'terminal',   250),
  ('RHS', 'Repair hose',                        'Perbaikan hose',                        'terminal',   260),
  ('CTT', 'Circulation tank to tank',           'Sirkulasi tangki ke tangki',            'terminal',   270),
  ('TOP', 'Final topping off',                  'Pengepasan final (topping off)',        'terminal',   280),
  ('RSP', 'Repair ship pump',                   'Perbaikan pompa kapal',                 'vessel',     300),
  ('RSL', 'Repair ship line',                   'Perbaikan line kapal',                  'vessel',     310),
  ('CFP', 'Change ship pump filter',            'Ganti filter pompa kapal',              'vessel',     320),
  ('EOH', 'Ship engine overheat',               'Mesin kapal overheat',                  'vessel',     330),
  ('HPS', 'High pressure – solid cargo',        'Tekanan tinggi – kargo padat',          'vessel',     340),
  ('HSP', 'Heavy ship pump',                    'Pompa kapal berat',                     'vessel',     350),
  ('LKO', 'Licking oil',                        'Licking oil',                           'vessel',     360),
  ('WCC', 'Waiting cleaning crew on board',     'Menunggu tim kuras naik ke kapal',      'kuras_crew', 400),
  ('CCB', 'Cleaning crew on break',             'Tim kuras istirahat',                   'kuras_crew', 410),
  ('SFT', 'Shifting – berth used by another vessel', 'Shifting – kade dipakai kapal lain', 'external', 500),
  ('HOA', 'Waiting HO approval',                'Menunggu approval HO',                  'external',   510),
  ('FWT', 'Waiting fresh water',                'Menunggu fresh water',                  'external',   520),
  ('BRK', 'Prayer / meal break (ISOMA)',        'Istirahat ISOMA / sholat',              'other',      600)
) AS v(code, name_en, name_id, category, sort_order);

-- Re-apply after the rollback script: bring the deactivated rows back as they were seeded.
UPDATE public.master_no_flow_reasons r
SET is_active = TRUE, category = v.category, updated_at = NOW()
FROM tmp_tj_pura_reasons v
WHERE UPPER(r.code) = v.code AND r.deleted_at IS NULL;

INSERT INTO public.master_no_flow_reasons (code, name_en, name_id, category, requires_note, sort_order)
SELECT v.code, v.name_en, v.name_id, v.category, FALSE, v.sort_order
FROM tmp_tj_pura_reasons v
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_no_flow_reasons r WHERE UPPER(r.code) = v.code AND r.deleted_at IS NULL
);

UPDATE public.master_no_flow_reasons
SET is_active = FALSE, updated_at = NOW()
WHERE UPPER(code) = 'KRS' AND deleted_at IS NULL AND is_active;

COMMIT;
