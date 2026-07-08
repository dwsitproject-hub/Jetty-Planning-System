-- =============================================================================
-- JPS — PURGE ALL TRANSACTIONAL DATA (HARD DELETE)
-- =============================================================================
--
-- *** DESTRUCTIVE — IRREVERSIBLE ***
--
-- Removes all vessel-call transaction data so the app can be tested fresh in
-- production/staging. This script is NOT a migration and does NOT run on deploy.
-- Run only when you intend to wipe transactional data.
--
-- PRESERVES (not truncated):
--   ports, jetties, jetty_layouts, jetty_status_history
--   si_* master tables, metric, standard_rates, sla_config
--   users, roles, permissions, role_permissions, user_roles, user_ports
--   master_cargo_handling_methods, notification_templates
--   schema_migrations
--
-- REMOVES:
--   shipment plans, shipping instructions, allocations (operations),
--   at-berth execution (pre/ops/post), clearance/sign-off rows, QC/qty,
--   activity logs, in-app notifications (not templates)
--
-- Uploaded files on disk (UPLOAD_DIR) are NOT deleted by this script.
--
-- Requires DB schema through migration 076 (shipping_instruction_documents).
--
-- RUN on backend server (see run-purge-transactional-data.sh or Docs/Troubleshoot):
--   cd /opt/jetty-planning-system
--   bash Backend/scripts/run-purge-transactional-data.sh
--
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo ''
\echo '========== JPS PURGE — row counts BEFORE =========='

SELECT 'shipment_plans' AS table_name, COUNT(*)::bigint AS row_count FROM public.shipment_plans
UNION ALL SELECT 'shipping_instructions', COUNT(*) FROM public.shipping_instructions
UNION ALL SELECT 'shipping_instruction_breakdown', COUNT(*) FROM public.shipping_instruction_breakdown
UNION ALL SELECT 'shipping_instruction_documents', COUNT(*) FROM public.shipping_instruction_documents
UNION ALL SELECT 'operations', COUNT(*) FROM public.operations
UNION ALL SELECT 'operation_sub_processes', COUNT(*) FROM public.operation_sub_processes
UNION ALL SELECT 'operation_operational_activities', COUNT(*) FROM public.operation_operational_activities
UNION ALL SELECT 'operation_cargo_load_lines', COUNT(*) FROM public.operation_cargo_load_lines
UNION ALL SELECT 'qc_surveys', COUNT(*) FROM public.qc_surveys
UNION ALL SELECT 'quantity_checks', COUNT(*) FROM public.quantity_checks
UNION ALL SELECT 'activity_logs', COUNT(*) FROM public.activity_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM public.notifications
ORDER BY 1;

\echo ''
\echo '========== TRUNCATING transactional tables =========='

BEGIN;

TRUNCATE TABLE
  public.notification_deliveries,
  public.notifications,
  public.qc_documents,
  public.qc_surveys,
  public.quantity_checks,
  public.operation_cargo_load_lines,
  public.operation_operational_activities,
  public.operation_sub_process_documents,
  public.operation_sub_processes,
  public.operation_nor_details,
  public.operation_documents,
  public.operation_materials,
  public.jetty_operation_code_counters,
  public.operations,
  public.shipping_instruction_documents,
  public.shipping_instruction_breakdown,
  public.shipping_instructions,
  public.shipment_plans,
  public.activity_logs
RESTART IDENTITY CASCADE;

COMMIT;

\echo ''
\echo '========== JPS PURGE — row counts AFTER (expect 0) =========='

SELECT 'shipment_plans' AS table_name, COUNT(*)::bigint AS row_count FROM public.shipment_plans
UNION ALL SELECT 'shipping_instructions', COUNT(*) FROM public.shipping_instructions
UNION ALL SELECT 'operations', COUNT(*) FROM public.operations
UNION ALL SELECT 'activity_logs', COUNT(*) FROM public.activity_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM public.notifications
ORDER BY 1;

\echo ''
\echo 'Purge complete. Master data and schema_migrations were not modified.'
