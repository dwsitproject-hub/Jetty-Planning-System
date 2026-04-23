-- Per-port NPWP master for Shipping Instruction display (read-only on SI flows).

BEGIN;

CREATE TABLE IF NOT EXISTS si_port_npwp (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  npwp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_si_port_npwp_port_active
  ON si_port_npwp (port_id)
  WHERE deleted_at IS NULL;

-- One seeded row for the first active port (demo/local).
INSERT INTO si_port_npwp (port_id, npwp)
SELECT p.id, '81.291.248.3-018.000'
FROM ports p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM si_port_npwp n WHERE n.port_id = p.id AND n.deleted_at IS NULL
  )
ORDER BY p.id
LIMIT 1;

COMMIT;
