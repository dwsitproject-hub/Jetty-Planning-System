-- Pre-flight review for export-vessels.sql. Run and read this BEFORE pushing
-- anything to DHM: once a vessel is a golden record, cleaning it up is a Data
-- Steward job in the hub portal, not a re-run here.
--
--   psql -f export-vessels-qa.sql -o vessels-qa.txt
--
-- Keeps the same cleaning and collapsing rules as the export, then reports what
-- those rules decided and which values look like data-entry errors.

WITH roman(roman, arabic) AS (
  VALUES ('I','1'), ('II','2'), ('III','3'), ('IV','4'), ('V','5'), ('VI','6'),
         ('VII','7'), ('VIII','8'), ('IX','9'), ('X','10'), ('XI','11'), ('XII','12')
),
plan_clean AS (
  SELECT
    btrim(regexp_replace(
      translate(
        sp.vessel_name,
        chr(160) || chr(8206) || chr(8207) || chr(8203) || chr(8204) || chr(8205) || chr(65279),
        ' '
      ),
      '\s+', ' ', 'g'
    ))                                     AS vessel_name,
    sp.vessel_name                         AS raw_name,
    sp.vessel_gross_tonnage,
    sp.vessel_draft,
    sp.vessel_loa_m,
    sp.vessel_capacity,
    COALESCE(sp.updated_at, sp.created_at) AS seen_at,
    (upper(sp.vessel_name) ~ '(SELF TEST|DUMMY|SMOKE|^DEMO-|^VAR-(ALLOC|PENDING))') AS is_test
  FROM shipment_plans sp
  WHERE sp.deleted_at IS NULL
    AND btrim(COALESCE(sp.vessel_name, '')) <> ''
),
plan_rows AS (
  SELECT
    c.*,
    (
      SELECT string_agg(COALESCE(r.arabic, t.tok), '' ORDER BY t.ord)
      FROM (
        SELECT regexp_replace(s.tok, '[^A-Z0-9]', '', 'g') AS tok, s.ord
        FROM regexp_split_to_table(
               regexp_replace(upper(c.vessel_name),
                              '^(SPOB|LCT|MT|MV|BG|OB|TB|TK|KM)[\.\s]+', ''),
               '\s+'
             ) WITH ORDINALITY AS s(tok, ord)
      ) t
      LEFT JOIN roman r ON r.roman = t.tok
    ) AS match_key
  FROM plan_clean c
),
grouped AS (
  SELECT
    match_key,
    count(*)                                          AS plan_calls,
    count(DISTINCT vessel_name)                       AS spellings,
    string_agg(DISTINCT vessel_name, ' | ' ORDER BY vessel_name) AS all_spellings,
    (array_agg(vessel_name ORDER BY seen_at DESC))[1] AS winning_name,
    (array_agg(vessel_gross_tonnage ORDER BY seen_at DESC)
       FILTER (WHERE vessel_gross_tonnage IS NOT NULL))[1] AS gross_tonnage,
    (array_agg(vessel_draft ORDER BY seen_at DESC)
       FILTER (WHERE vessel_draft IS NOT NULL))[1]         AS draft,
    (array_agg(vessel_loa_m ORDER BY seen_at DESC)
       FILTER (WHERE vessel_loa_m IS NOT NULL))[1]         AS loa_m,
    MAX(vessel_capacity)                                   AS capacity_mt
  FROM plan_rows
  WHERE NOT is_test
  GROUP BY match_key
)
SELECT * FROM (
  SELECT 1 AS sort, 'SUMMARY' AS check_name,
         count(*)::text AS vessel_name,
         'vessels will be exported' AS detail
  FROM grouped

  UNION ALL
  SELECT 2, 'EXCLUDED as test/seed data',
         vessel_name,
         count(*) || ' plan(s) -- confirm none of these are real'
  FROM plan_rows WHERE is_test GROUP BY vessel_name

  UNION ALL
  SELECT 3, 'MERGED spellings -- verify the name kept',
         winning_name,
         'kept from: ' || all_spellings
  FROM grouped WHERE spellings > 1

  UNION ALL
  SELECT 4, 'NON-ASCII characters in name',
         vessel_name,
         'first char code ' || ascii(left(raw_name, 1)) || ', invisible chars are stripped on export'
  FROM plan_rows WHERE raw_name ~ '[^[:ascii:]]' GROUP BY vessel_name, raw_name

  UNION ALL
  SELECT 5, 'VOYAGE number looks embedded in name',
         winning_name,
         'split the voyage out before pushing; the hub name should be the vessel only'
  FROM grouped WHERE winning_name ~* '\mV\.?\s*[0-9]'

  UNION ALL
  SELECT 6, 'CAPACITY implausible',
         winning_name,
         capacity_mt || ' MT -- this is max cargo carried, not vessel capacity; consider blanking'
  FROM grouped WHERE capacity_mt IS NOT NULL AND capacity_mt < 500

  UNION ALL
  SELECT 7, 'LOA implausible',
         winning_name,
         loa_m || ' m'
  FROM grouped WHERE loa_m IS NOT NULL AND (loa_m < 40 OR loa_m > 300)

  UNION ALL
  SELECT 8, 'DRAFT implausible',
         winning_name,
         draft || ' m'
  FROM grouped WHERE draft IS NOT NULL AND (draft < 1 OR draft > 20)

  UNION ALL
  SELECT 9, 'NO dimensions at all',
         winning_name,
         'GT, draft and LOA all empty'
  FROM grouped WHERE gross_tonnage IS NULL AND draft IS NULL AND loa_m IS NULL
) f
ORDER BY sort, vessel_name;
