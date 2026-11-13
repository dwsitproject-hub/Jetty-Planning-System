-- Backfill the Post-Checking "Closing" sub-step (sub_process_key = 'closing') on operations that
-- already finished cargo work, so they stay eligible for sign-off after Closing became mandatory.
--
-- Closing time = Hose Off (partner schedule.cargo_ops_end_at): the latest end_at among
-- Cargo Operations activities (same rule as PARTNER_CARGO_OPS_WINDOW_SUBSELECT).
-- Stored as occurred_at = start_at = end_at, status Done.
-- Handling method follows SI commodity type (Solid -> Conveyor, else Hose), like migration 055.
--
-- Skipped on purpose:
--   - operations still IN_PROGRESS or earlier (they record Closing themselves)
--   - operations with an open Cargo Operations segment (end_at IS NULL) or no Cargo Operations end time
--   - operations that already have an active Closing row (idempotent)
--
-- Backfilled rows carry payload_json.backfilled = true; see rollback/150_rollback_backfill_closing_sub_step.sql.

BEGIN;

WITH hose_off AS (
  SELECT
    o.id AS operation_id,
    (SELECT MAX(oa.end_at)
     FROM public.operation_operational_activities oa
     WHERE oa.operation_id = o.id
       AND oa.deleted_at IS NULL
       AND oa.entry_type = 'activity'
       AND oa.milestone_key = 'cargo_operations'
       AND oa.end_at IS NOT NULL) AS hose_off_at,
    COALESCE(
      (SELECT sc.commodity_type
       FROM public.shipping_instruction_breakdown b
       JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id
       LIMIT 1),
      'Liquid'
    ) AS commodity_type
  FROM public.operations o
  LEFT JOIN public.shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  WHERE o.deleted_at IS NULL
    AND o.status IN ('POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED', 'SAILED')
    AND NOT EXISTS (
      SELECT 1
      FROM public.operation_operational_activities oa
      WHERE oa.operation_id = o.id
        AND oa.deleted_at IS NULL
        AND oa.entry_type = 'activity'
        AND oa.milestone_key = 'cargo_operations'
        AND oa.end_at IS NULL
    )
)
INSERT INTO public.operation_sub_processes
  (operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, remark, payload_json)
SELECT
  h.operation_id,
  'Post-Checking',
  'closing',
  'Done',
  h.hose_off_at,
  h.hose_off_at,
  h.hose_off_at,
  'Backfilled from Cargo Operations end (Hose Off).',
  jsonb_build_object(
    'backfilled', TRUE,
    'source', 'cargo_ops_end_at',
    'cargoHandlingMethod', CASE WHEN h.commodity_type = 'Solid' THEN 'Conveyor' ELSE 'Hose' END
  )
FROM hose_off h
WHERE h.hose_off_at IS NOT NULL
ON CONFLICT (operation_id, phase, sub_process_key) WHERE deleted_at IS NULL DO NOTHING;

COMMIT;
