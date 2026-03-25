-- Jetty Planning System - Migration 004
-- Phase 3: Shipping instructions, operations, operation_materials

BEGIN;

-- Shipping instructions (from EXIM/Logistics or manual)
CREATE TABLE IF NOT EXISTS shipping_instructions (
  id BIGSERIAL PRIMARY KEY,
  reference_number TEXT,
  vessel_name TEXT NOT NULL,
  commodity TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('Loading', 'Unloading')),
  eta TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Submitted', 'Approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_si_purpose ON shipping_instructions(purpose);
CREATE INDEX IF NOT EXISTS idx_si_status ON shipping_instructions(status);

-- Operations (one per SI + jetty; links to allocation and at-berth)
CREATE TABLE IF NOT EXISTS operations (
  id BIGSERIAL PRIMARY KEY,
  shipping_instruction_id BIGINT NOT NULL REFERENCES shipping_instructions(id) ON DELETE RESTRICT,
  jetty_id BIGINT NOT NULL REFERENCES jetties(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ALLOCATED', 'DOCKED', 'IN_PROGRESS', 'COMPLETED', 'SAILED')),
  purpose TEXT NOT NULL CHECK (purpose IN ('Loading', 'Unloading')),
  docking_start_time TIMESTAMPTZ,
  estimated_completion_time TIMESTAMPTZ,
  actual_completion_time TIMESTAMPTZ,
  completion_percent INT NOT NULL DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operations_si_status ON operations(shipping_instruction_id, status);
CREATE INDEX IF NOT EXISTS idx_operations_jetty_docking ON operations(jetty_id, docking_start_time, status);

-- Materials per operation (volumes for SLA: sum(V_n / (Rate_n * Buffer_n)))
CREATE TABLE IF NOT EXISTS operation_materials (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  material_key TEXT NOT NULL,
  volume NUMERIC NOT NULL CHECK (volume >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operation_materials_operation_id ON operation_materials(operation_id);

COMMIT;
