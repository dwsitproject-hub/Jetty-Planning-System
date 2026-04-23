-- Jetty Planning System - Migration 005
-- Phase 4: QC & Quantity tables — qc_surveys, qc_documents, quantity_checks

BEGIN;

-- QC surveys / checks captured in Pre-Checking and Post-Checking.
CREATE TABLE IF NOT EXISTS qc_surveys (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('Pre-Checking', 'Post-Checking')),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Done')),
  result TEXT,
  remarks TEXT,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qc_surveys_operation_id ON qc_surveys(operation_id);

-- Documents attached to QC surveys (placeholder for real file storage later)
CREATE TABLE IF NOT EXISTS qc_documents (
  id BIGSERIAL PRIMARY KEY,
  qc_survey_id BIGINT NOT NULL REFERENCES qc_surveys(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qc_documents_qc_survey_id ON qc_documents(qc_survey_id);

-- Quantity checks (sampling, sounding, draft survey, etc.)
CREATE TABLE IF NOT EXISTS quantity_checks (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('Pre-Checking', 'Operational', 'Post-Checking')),
  check_key TEXT NOT NULL,
  value_json JSONB,
  remarks TEXT,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quantity_checks_operation_id ON quantity_checks(operation_id);

COMMIT;

