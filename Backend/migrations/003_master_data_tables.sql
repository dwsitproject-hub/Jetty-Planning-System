-- Jetty Planning System - Migration 003
-- Phase 2: Master data — ports, jetties, jetty_status_history, sla_config, standard_rates

BEGIN;

-- Ports
CREATE TABLE IF NOT EXISTS ports (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jetties (per port)
CREATE TABLE IF NOT EXISTS jetties (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  order_no INT NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Available'
    CHECK (status IN ('Available', 'Maintenance', 'High-Priority', 'Out of Service')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jetties_port_id ON jetties(port_id);

-- Jetty status change history (audit)
CREATE TABLE IF NOT EXISTS jetty_status_history (
  id BIGSERIAL PRIMARY KEY,
  jetty_id BIGINT NOT NULL REFERENCES jetties(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jetty_status_history_jetty_id ON jetty_status_history(jetty_id);

-- SLA formula config (single row; id = 1)
CREATE TABLE IF NOT EXISTS sla_config (
  id BIGSERIAL PRIMARY KEY,
  q1_hours NUMERIC NOT NULL DEFAULT 0,
  q2_hours NUMERIC NOT NULL DEFAULT 0,
  c_hours NUMERIC NOT NULL DEFAULT 0,
  s_hours NUMERIC NOT NULL DEFAULT 1,
  buffer_default NUMERIC NOT NULL DEFAULT 0.85,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sla_config (id, q1_hours, q2_hours, c_hours, s_hours, buffer_default)
VALUES (1, 0, 0, 0, 1, 0.85)
ON CONFLICT (id) DO NOTHING;

-- Standard rates per material type (for SLA calculation)
CREATE TABLE IF NOT EXISTS standard_rates (
  id BIGSERIAL PRIMARY KEY,
  material_key TEXT NOT NULL UNIQUE,
  rate_per_hour NUMERIC NOT NULL,
  buffer NUMERIC NOT NULL DEFAULT 0.85,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
