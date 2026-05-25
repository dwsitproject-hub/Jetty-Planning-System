-- Rollback 079: restore header shipper_id from first breakdown line per SI.

BEGIN;

ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS shipper_id BIGINT REFERENCES si_shippers(id);

UPDATE shipping_instructions si
SET shipper_id = sub.shipper_id, updated_at = NOW()
FROM (
  SELECT DISTINCT ON (b.shipping_instruction_id)
    b.shipping_instruction_id,
    b.shipper_id
  FROM shipping_instruction_breakdown b
  WHERE b.deleted_at IS NULL AND b.shipper_id IS NOT NULL
  ORDER BY b.shipping_instruction_id, b.line_order, b.id
) sub
WHERE si.id = sub.shipping_instruction_id AND si.deleted_at IS NULL;

ALTER TABLE shipping_instruction_breakdown DROP COLUMN IF EXISTS shipper_id;

ALTER TABLE shipping_instruction_breakdown ADD COLUMN IF NOT EXISTS shipper_text TEXT;

COMMIT;
