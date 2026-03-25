-- Jetty Planning System - Migration 006
-- Phase 5: Clearance & exception workflow on operations

BEGIN;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS hose_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cast_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clearance_document_url TEXT,
  ADD COLUMN IF NOT EXISTS vessel_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS sailed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_status TEXT
    CHECK (exception_status IS NULL OR exception_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD COLUMN IF NOT EXISTS exception_justification TEXT,
  ADD COLUMN IF NOT EXISTS exception_document_url TEXT,
  ADD COLUMN IF NOT EXISTS exception_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_approver_user_id BIGINT REFERENCES users(id);

COMMENT ON COLUMN operations.exception_status IS 'NULL = no exception; PENDING/APPROVED/REJECTED';

COMMIT;
