-- Material code from DHM commodity golden record (SAP/material identifier).

BEGIN;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS material_code TEXT;

COMMENT ON COLUMN si_commodities.material_code IS
  'SAP/material identifier from DHM (material_code on golden record); optional.';

COMMIT;
