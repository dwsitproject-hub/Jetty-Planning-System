-- Move shipper from SI header (shipping_instructions.shipper_id) to breakdown lines.
-- Backfill existing data before dropping header column.

BEGIN;

ALTER TABLE shipping_instruction_breakdown
  ADD COLUMN IF NOT EXISTS shipper_id BIGINT REFERENCES si_shippers(id);

CREATE INDEX IF NOT EXISTS idx_sib_shipper_active ON shipping_instruction_breakdown (shipper_id)
  WHERE deleted_at IS NULL;

-- Step 1: header shipper → all active breakdown lines
UPDATE shipping_instruction_breakdown b
SET shipper_id = si.shipper_id, updated_at = NOW()
FROM shipping_instructions si
WHERE b.shipping_instruction_id = si.id
  AND si.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND si.shipper_id IS NOT NULL
  AND b.shipper_id IS NULL;

-- Step 2: legacy shipper_text → si_shippers match
UPDATE shipping_instruction_breakdown b
SET shipper_id = sh.id, updated_at = NOW()
FROM si_shippers sh
WHERE b.deleted_at IS NULL
  AND b.shipper_id IS NULL
  AND b.shipper_text IS NOT NULL
  AND TRIM(b.shipper_text) <> ''
  AND sh.deleted_at IS NULL
  AND LOWER(TRIM(sh.name)) = LOWER(TRIM(b.shipper_text));

-- Step 3: SIs with header shipper but no breakdown rows
INSERT INTO shipping_instruction_breakdown (
  shipping_instruction_id, commodity_id, metric_id, qty, shipper_id, line_order, remarks
)
SELECT si.id,
  (SELECT id FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, id LIMIT 1),
  (SELECT id FROM metric WHERE code = 'MT' AND deleted_at IS NULL LIMIT 1),
  0,
  si.shipper_id,
  1,
  'Auto seed during shipper migration'
FROM shipping_instructions si
WHERE si.deleted_at IS NULL
  AND si.shipper_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM shipping_instruction_breakdown b
    WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
  );

ALTER TABLE shipping_instruction_breakdown DROP COLUMN IF EXISTS shipper_text;

ALTER TABLE shipping_instructions DROP COLUMN IF EXISTS shipper_id;

COMMIT;
