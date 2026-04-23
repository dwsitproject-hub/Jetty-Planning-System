-- Jetty operational status: only Available / Out of Service.
-- Converts legacy Maintenance and High-Priority to Available, then tightens CHECK.

BEGIN;

UPDATE jetties
SET status = 'Available', updated_at = NOW()
WHERE deleted_at IS NULL
  AND status IN ('Maintenance', 'High-Priority');

ALTER TABLE jetties DROP CONSTRAINT IF EXISTS jetties_status_check;

ALTER TABLE jetties
  ADD CONSTRAINT jetties_status_check
  CHECK (status IN ('Available', 'Out of Service'));

COMMIT;
