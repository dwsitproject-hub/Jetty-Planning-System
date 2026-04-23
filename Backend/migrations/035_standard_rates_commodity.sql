-- Link standard_rates to si_commodities; one rate row per commodity when set.

BEGIN;

ALTER TABLE standard_rates ADD COLUMN IF NOT EXISTS commodity_id BIGINT REFERENCES si_commodities(id);

-- Match existing material_key to commodity name (case-insensitive, trimmed)
UPDATE standard_rates sr
SET commodity_id = sc.id
FROM si_commodities sc
WHERE sr.commodity_id IS NULL
  AND sr.deleted_at IS NULL
  AND sc.deleted_at IS NULL
  AND LOWER(TRIM(sc.name)) = LOWER(TRIM(sr.material_key));

-- Keep material_key aligned with commodity display name for operation_materials / SLA string match
UPDATE standard_rates sr
SET material_key = sc.name,
    updated_at = NOW()
FROM si_commodities sc
WHERE sr.commodity_id = sc.id
  AND sr.deleted_at IS NULL
  AND sc.deleted_at IS NULL;

-- Soft-delete duplicate standard_rate rows for the same commodity (keep lowest id)
UPDATE standard_rates sr
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE sr.id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY commodity_id ORDER BY id) AS rn
    FROM standard_rates
    WHERE deleted_at IS NULL
      AND commodity_id IS NOT NULL
  ) d WHERE d.rn > 1
);

DROP INDEX IF EXISTS idx_standard_rates_material_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_standard_rates_commodity_active
  ON standard_rates (commodity_id)
  WHERE deleted_at IS NULL AND commodity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_standard_rates_material_lower
  ON standard_rates (LOWER(TRIM(material_key)))
  WHERE deleted_at IS NULL;

COMMIT;
