-- Backfill NPWP master rows for all active ports (local/dev convenience).
-- Ensures the SI form/view/approval shows an NPWP value per selected port.

BEGIN;

INSERT INTO si_port_npwp (port_id, npwp)
SELECT p.id, '81.291.248.3-018.000'
FROM ports p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM si_port_npwp n WHERE n.port_id = p.id AND n.deleted_at IS NULL
  );

COMMIT;

