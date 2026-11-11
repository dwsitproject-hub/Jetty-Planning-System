-- Rollback migration 150: remove Closing rows that the backfill inserted.
-- Only rows still carrying payload_json.backfilled = true are removed. A row a user has since
-- edited and saved from the app loses that marker and is kept.
-- Run this before reverting to a build that has no Closing step, or those operations keep an unused row.

BEGIN;

DELETE FROM public.operation_sub_processes
WHERE phase = 'Post-Checking'
  AND sub_process_key = 'closing'
  AND payload_json ->> 'backfilled' = 'true';

COMMIT;
