-- Global metric units + shipping_instruction_breakdown (commodity per line, qty + metric)
-- Clears header commodity on SI after backfill (commodity lives on breakdown only).

BEGIN;

CREATE TABLE IF NOT EXISTS metric (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_code_active ON metric (UPPER(code)) WHERE deleted_at IS NULL;

INSERT INTO metric (code, label, sort_order)
SELECT v.code, v.label, v.ord FROM (VALUES
  ('KL', 'Kilo litre', 1),
  ('MT', 'Metric ton', 2)
) AS v(code, label, ord)
WHERE NOT EXISTS (SELECT 1 FROM metric m WHERE UPPER(m.code) = UPPER(v.code) AND m.deleted_at IS NULL);

CREATE TABLE IF NOT EXISTS shipping_instruction_breakdown (
  id BIGSERIAL PRIMARY KEY,
  shipping_instruction_id BIGINT NOT NULL REFERENCES shipping_instructions(id) ON DELETE CASCADE,
  commodity_id BIGINT NOT NULL REFERENCES si_commodities(id),
  metric_id BIGINT NOT NULL REFERENCES metric(id),
  qty NUMERIC NOT NULL DEFAULT 0 CHECK (qty >= 0),
  contract_no TEXT,
  po_no TEXT,
  remarks TEXT,
  shipper_text TEXT,
  line_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sib_si_active ON shipping_instruction_breakdown (shipping_instruction_id)
  WHERE deleted_at IS NULL;

-- One breakdown line per SI that has none yet (commodity from header or first catalog row)
INSERT INTO shipping_instruction_breakdown (
  shipping_instruction_id, commodity_id, metric_id, qty, contract_no, po_no, remarks, line_order
)
SELECT
  si.id,
  COALESCE(
    si.commodity_id,
    (SELECT c.id FROM si_commodities c
     WHERE si.commodity IS NOT NULL AND TRIM(si.commodity) <> ''
       AND LOWER(TRIM(c.name)) = LOWER(TRIM(si.commodity)) AND c.deleted_at IS NULL
     LIMIT 1),
    (SELECT id FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, id LIMIT 1)
  ),
  (SELECT id FROM metric WHERE code = 'MT' AND deleted_at IS NULL LIMIT 1),
  0,
  NULL,
  NULL,
  CASE
    WHEN si.commodity_id IS NOT NULL OR (si.commodity IS NOT NULL AND TRIM(si.commodity) <> '')
    THEN 'Migrated from SI header'
    ELSE 'Auto seed (no header commodity)'
  END,
  1
FROM shipping_instructions si
WHERE si.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM shipping_instruction_breakdown b
    WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
  );

UPDATE shipping_instructions
SET commodity = NULL, commodity_id = NULL, updated_at = NOW()
WHERE deleted_at IS NULL;

COMMIT;
