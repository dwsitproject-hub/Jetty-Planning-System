-- SI lookup tables (soft delete) + shipping_instructions FKs + seed from mock UI

BEGIN;

-- ---------- Lookup tables ----------
CREATE TABLE IF NOT EXISTS si_commodities (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_commodities_name_active ON si_commodities (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_trade_terms (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_trade_terms_code_active ON si_trade_terms (UPPER(code)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_purposes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_purposes_code_active ON si_purposes (code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_shippers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_shippers_name_active ON si_shippers (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_loading_ports (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_loading_ports_name_active ON si_loading_ports (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_surveyors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_surveyors_name_active ON si_surveyors (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS si_agents (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_agents_name_active ON si_agents (LOWER(name)) WHERE deleted_at IS NULL;

-- ---------- shipping_instructions: FK columns ----------
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS commodity_id BIGINT REFERENCES si_commodities(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS trade_term_id BIGINT REFERENCES si_trade_terms(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS purpose_id BIGINT REFERENCES si_purposes(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS preferred_jetty_id BIGINT REFERENCES jetties(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS shipper_id BIGINT REFERENCES si_shippers(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS loading_port_id BIGINT REFERENCES si_loading_ports(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS surveyor_id BIGINT REFERENCES si_surveyors(id);
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES si_agents(id);

CREATE INDEX IF NOT EXISTS idx_si_commodity_id ON shipping_instructions (commodity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_si_preferred_jetty ON shipping_instructions (preferred_jetty_id) WHERE deleted_at IS NULL;

-- ---------- Seed: purposes ----------
INSERT INTO si_purposes (code, label, sort_order)
SELECT v.code, v.label, v.ord FROM (VALUES
  ('Loading', 'Loading', 1),
  ('Unloading', 'Unloading', 2)
) AS v(code, label, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_purposes p WHERE p.code = v.code AND p.deleted_at IS NULL);

-- ---------- Seed: commodities (ShippingInstruction.jsx) ----------
INSERT INTO si_commodities (name, sort_order)
SELECT x.name, x.ord FROM (VALUES
  ('CPO', 1),
  ('CRUDE PALM OIL', 2),
  ('POME', 3),
  ('PKE', 4),
  ('FAME', 5),
  ('RBD PO', 6)
) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_commodities c WHERE LOWER(c.name) = LOWER(x.name) AND c.deleted_at IS NULL);

-- ---------- Seed: trade terms ----------
INSERT INTO si_trade_terms (code, sort_order)
SELECT x.code, x.ord FROM (VALUES ('FOB', 1), ('CIF', 2), ('CFR', 3)) AS x(code, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_trade_terms t WHERE UPPER(t.code) = UPPER(x.code) AND t.deleted_at IS NULL);

-- ---------- Seed: shippers (mockData) ----------
INSERT INTO si_shippers (name, sort_order)
SELECT x.name, x.ord FROM (VALUES
  ('PT. TANJUNG BUYU PERKASA', 1),
  ('PT. TJIM', 2),
  ('PT. EUPLG', 3),
  ('PT. EUP', 4),
  ('PT. Example', 5),
  ('Other', 6)
) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_shippers s WHERE LOWER(s.name) = LOWER(x.name) AND s.deleted_at IS NULL);

-- ---------- Seed: loading ports ----------
INSERT INTO si_loading_ports (name, sort_order)
SELECT x.name, x.ord FROM (VALUES
  ('LEMPAKE, KALIMANTAN TIMUR', 1),
  ('DUMAI', 2),
  ('BONTANG', 3),
  ('POSO, INDONESIA', 4),
  ('TANAH GROGOT', 5),
  ('RVTG', 6),
  ('Other', 7)
) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_loading_ports p WHERE LOWER(p.name) = LOWER(x.name) AND p.deleted_at IS NULL);

-- ---------- Seed: surveyors ----------
INSERT INTO si_surveyors (name, sort_order)
SELECT x.name, x.ord FROM (VALUES
  ('LSN', 1),
  ('SAYBOLT', 2),
  ('SGS', 3),
  ('Bureau Veritas', 4),
  ('Intertek', 5),
  ('Other', 6)
) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_surveyors s WHERE LOWER(s.name) = LOWER(x.name) AND s.deleted_at IS NULL);

-- ---------- Seed: agents ----------
INSERT INTO si_agents (name, sort_order)
SELECT x.name, x.ord FROM (VALUES
  ('PSM', 1),
  ('TPB BONTANG', 2),
  ('PT. SCM', 3),
  ('PT. Pelayaran Sentosa Makmur', 4),
  ('PT. EUPLG', 5),
  ('Other', 6)
) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM si_agents a WHERE LOWER(a.name) = LOWER(x.name) AND a.deleted_at IS NULL);

-- ---------- Backfill shipping_instructions ----------
UPDATE shipping_instructions si
SET purpose_id = p.id
FROM si_purposes p
WHERE si.purpose_id IS NULL AND si.deleted_at IS NULL AND p.deleted_at IS NULL AND p.code = si.purpose;

UPDATE shipping_instructions si
SET commodity_id = c.id
FROM si_commodities c
WHERE si.commodity_id IS NULL AND si.commodity IS NOT NULL AND si.deleted_at IS NULL AND c.deleted_at IS NULL
  AND LOWER(TRIM(si.commodity)) = LOWER(TRIM(c.name));

-- ---------- Optional: seed jetties from mock (1A–3B) when no jetties exist ----------
INSERT INTO ports (name, description)
SELECT 'BONTANG (SI seed)', NULL
WHERE NOT EXISTS (SELECT 1 FROM ports WHERE deleted_at IS NULL LIMIT 1);

INSERT INTO jetties (port_id, order_no, name, description, status)
SELECT p.id, v.ord, v.jetty_name, NULL, 'Available'
FROM (VALUES
  (1, 'Jetty 1A'),
  (2, 'Jetty 1B'),
  (3, 'Jetty 2A'),
  (4, 'Jetty 2B'),
  (5, 'Jetty 3A'),
  (6, 'Jetty 3B')
) AS v(ord, jetty_name)
CROSS JOIN LATERAL (SELECT id FROM ports WHERE deleted_at IS NULL ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM jetties WHERE deleted_at IS NULL LIMIT 1);

COMMIT;
