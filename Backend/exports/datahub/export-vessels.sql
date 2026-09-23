-- Export JPS vessels in DHM (Data Hub Management) vessel-master format.
-- Contract: Docs/Guide/DATAHUB_CLIENT_INTEGRATION.md (section 14, `vessel`).
--
--   psql --csv -f export-vessels.sql -o vessels-for-datahub.csv
--
-- Run export-vessels-qa.sql FIRST and review its findings. This query collapses
-- and filters rows, and a human should confirm those decisions before the data
-- becomes canonical golden records that TOS / KLIP will consume.
--
-- `Code` is omitted on purpose: DHM assigns VSL-NNNN on create.
--
-- JPS has no vessel master table -- vessel attributes live per vessel call on
-- shipment_plans -- so rows are collapsed onto one row per physical vessel to
-- satisfy DHM's unique Vessel_Name rule.
--
-- Vessel IMO / MMSI export blank: production holds neither. The only IMO source
-- in JPS is ais_poc_vessels, and migration 113 that creates it is not deployed
-- to production, so joining it here fails with "relation does not exist". Fill
-- IMO / MMSI afterwards from Docs/Vessel/IMO-lookup-wikidata.csv (497 vessels
-- with a confidence rating -- use the `high` rows only), which covers far more
-- of the fleet than the ~28-vessel AIS POC table ever did.
--
-- WARNING: shipment_plans.vessel_capacity is NOT vessel capacity. Migration 091
-- repurposed it to hold total cargo MT from the shipping instruction breakdown,
-- so the most it can tell you is the largest parcel a vessel has ever carried.
-- Vessel Capacity MT is therefore exported blank by design. To emit the derived
-- figure anyway, swap the NULL below back to j.capacity_mt.
--
-- Not held anywhere in JPS, left NULL for the data owner:
--   Vessel Code SAP, Vessel Type, Heater, Type lambung, Type Charter

WITH roman(roman, arabic) AS (
  -- Standalone Roman numerals are normalised to digits in the match key only, so
  -- "BARUNA MANDALA I" and "BARUNA MANDALA 1" resolve to one vessel.
  VALUES ('I','1'), ('II','2'), ('III','3'), ('IV','4'), ('V','5'), ('VI','6'),
         ('VII','7'), ('VIII','8'), ('IX','9'), ('X','10'), ('XI','11'), ('XII','12')
),
plan_clean AS (
  SELECT
    -- Production data contains a U+200E left-to-right mark on at least one name.
    -- Map NBSP to a space, delete zero-width / bidi marks, collapse whitespace.
    btrim(regexp_replace(
      translate(
        sp.vessel_name,
        chr(160) || chr(8206) || chr(8207) || chr(8203) || chr(8204) || chr(8205) || chr(65279),
        ' '
      ),
      '\s+', ' ', 'g'
    ))                                     AS vessel_name,
    sp.vessel_gross_tonnage,
    sp.vessel_draft,
    sp.vessel_loa_m,
    sp.vessel_capacity,
    COALESCE(sp.updated_at, sp.created_at) AS seen_at
  FROM shipment_plans sp
  WHERE sp.deleted_at IS NULL
    AND btrim(COALESCE(sp.vessel_name, '')) <> ''
    -- Seed / self-test / load-test artefacts. Comment out to export everything;
    -- the QA script lists exactly which names this removes.
    AND upper(sp.vessel_name) !~ '(SELF TEST|DUMMY|SMOKE|^DEMO-|^VAR-(ALLOC|PENDING))'
),
plan_bare AS (
  SELECT
    c.*,
    -- Drop the vessel-type prefix so "BG. WIDMARINO R18" and "OB. WIDMARINO R18"
    -- resolve to the same vessel.
    regexp_replace(upper(c.vessel_name), '^(SPOB|LCT|MT|MV|BG|OB|TB|TK|KM)[\.\s]+', '') AS bare_name
  FROM plan_clean c
),
plan_rows AS (
  SELECT
    b.*,
    -- Tokenise, map Roman numerals to digits, drop punctuation, re-join.
    (
      SELECT string_agg(COALESCE(r.arabic, t.tok), '' ORDER BY t.ord)
      FROM (
        SELECT regexp_replace(s.tok, '[^A-Z0-9]', '', 'g') AS tok, s.ord
        FROM regexp_split_to_table(b.bare_name, '\s+') WITH ORDINALITY AS s(tok, ord)
      ) t
      LEFT JOIN roman r ON r.roman = t.tok
    ) AS match_key
  FROM plan_bare b
),
jps_vessel AS (
  SELECT
    match_key,
    -- name as spelled on the most recent call
    (array_agg(vessel_name ORDER BY seen_at DESC))[1] AS vessel_name,
    -- latest non-null measurement per attribute
    (array_agg(vessel_gross_tonnage ORDER BY seen_at DESC)
       FILTER (WHERE vessel_gross_tonnage IS NOT NULL))[1] AS gross_tonnage,
    (array_agg(vessel_draft ORDER BY seen_at DESC)
       FILTER (WHERE vessel_draft IS NOT NULL))[1]         AS draft,
    (array_agg(vessel_loa_m ORDER BY seen_at DESC)
       FILTER (WHERE vessel_loa_m IS NOT NULL))[1]         AS loa_m,
    MAX(vessel_capacity)                                   AS capacity_mt
  FROM plan_rows
  GROUP BY match_key
)
SELECT
  j.vessel_name                         AS "Vessel Name",
  NULL::text                            AS "Vessel IMO",
  NULL::text                            AS "Vessel MMSI",
  NULL::text                            AS "Vessel Code SAP",
  -- Deliberately blank: see the WARNING above. JPS holds cargo quantity per
  -- call, not a vessel spec, and a wrong capacity in the hub propagates to
  -- every consuming app. The data owner enters true capacities in DHM.
  NULL::numeric                         AS "Vessel Capacity MT",
  j.gross_tonnage                       AS "Vessel Gross Tonnage",
  j.draft                               AS "Vessel Draft",
  -- DHM stores length as STRING; NUMERIC(10,2) text always carries a decimal
  -- point, so the double rtrim safely turns 180.00 into 180
  rtrim(rtrim(j.loa_m::text, '0'), '.') AS "Vessel Length Overral",
  NULL::text                            AS "Vessel Type",
  NULL::boolean                         AS "Heater",
  NULL::text                            AS "Type lambung",
  NULL::text                            AS "Type Charter"
FROM jps_vessel j
ORDER BY 1;
