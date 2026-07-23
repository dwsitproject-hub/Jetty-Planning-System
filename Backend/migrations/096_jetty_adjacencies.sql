-- Explicit jetty adjacency config for multi-jetty berthing (Master – Jetty).
BEGIN;

CREATE TABLE IF NOT EXISTS jetty_adjacencies (
  jetty_id BIGINT NOT NULL REFERENCES jetties(id) ON DELETE CASCADE,
  adjacent_jetty_id BIGINT NOT NULL REFERENCES jetties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (jetty_id, adjacent_jetty_id),
  CHECK (jetty_id <> adjacent_jetty_id)
);

CREATE INDEX IF NOT EXISTS idx_jetty_adjacencies_adjacent ON jetty_adjacencies(adjacent_jetty_id);

COMMENT ON TABLE jetty_adjacencies IS
  'Explicit, admin-configured "next to each other" jetty pairs (Master – Jetty). Stored symmetrically. Independent of jetty_layouts schematic positioning.';

COMMIT;
