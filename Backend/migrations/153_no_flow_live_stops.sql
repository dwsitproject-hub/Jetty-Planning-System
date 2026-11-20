-- Live no-flow capture: a stop can be open (no end yet) while flow is stopped, closed by
-- the operator, by the next cargo start, or by ATG showing flow again. One open stop per voyage.
-- Adds the supervisor alert when ATG shows no flow on an open cargo entry.

BEGIN;

ALTER TABLE public.operation_no_flow_events
  ALTER COLUMN ended_at DROP NOT NULL;

ALTER TABLE public.operation_no_flow_events
  DROP CONSTRAINT IF EXISTS operation_no_flow_events_check;

ALTER TABLE public.operation_no_flow_events
  ADD CONSTRAINT operation_no_flow_events_window_check
  CHECK (ended_at IS NULL OR ended_at > started_at);

ALTER TABLE public.operation_no_flow_events
  DROP CONSTRAINT IF EXISTS operation_no_flow_events_source_check;

ALTER TABLE public.operation_no_flow_events
  ADD CONSTRAINT operation_no_flow_events_source_check
  CHECK (source IN ('atg_flat', 'gap', 'manual', 'cargo_stop', 'flow_pause', 'atg_nudge'));

ALTER TABLE public.operation_no_flow_events
  ADD COLUMN IF NOT EXISTS close_source TEXT
    CHECK (close_source IS NULL OR close_source IN ('manual', 'cargo_start', 'atg_resume'));

COMMENT ON COLUMN public.operation_no_flow_events.close_source IS
  'How an open stop ended: operator (manual), next cargo entry started (cargo_start), ATG flow seen again (atg_resume).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_no_flow_events_one_open
  ON public.operation_no_flow_events (operation_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

INSERT INTO notification_event_settings (event_key, enabled, in_app_enabled, email_enabled)
VALUES ('operation.no_flow_detected', TRUE, TRUE, FALSE)
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.no_flow_detected', 'in_app', NULL,
  'No flow: {{vesselName}} ({{minutes}} min)',
  'ATG shows no flow on {{tankCodes}} for {{vesselName}} at {{jettyName}} since {{flatSinceFormatted}}. Add a no-flow reason.',
  'info',
  'actionViewAtBerth'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.no_flow_detected' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

COMMIT;
