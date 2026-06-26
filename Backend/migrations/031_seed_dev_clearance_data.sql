-- Jetty Planning System - Migration 031
-- DISABLED (no-op).
--
-- This migration previously seeded dev "clearance" operations with status
-- SIGNOFF_APPROVED / SAILED. Those statuses are not permitted by the
-- operations_status_check constraint until migrations 049/050, so on a fresh
-- database `npm run migrate` aborted here with:
--   new row for relation "operations" violates check constraint "operations_status_check"
--
-- The dev clearance sample-data seed has been removed so clean installs migrate
-- end-to-end. Existing databases already recorded this migration as applied and
-- are unaffected (the runner only executes files not yet in schema_migrations).
--
-- No replacement seed is added (per decision 2026-06-26). To populate clearance
-- test data, use the application flows or a manual seed run after migration 050.

SELECT 1;
