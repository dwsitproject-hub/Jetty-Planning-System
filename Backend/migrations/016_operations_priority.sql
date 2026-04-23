-- Jetty Planning System - Migration 016
-- Allocation/Berthing: store priority on operations.

BEGIN;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS priority TEXT;

COMMIT;

