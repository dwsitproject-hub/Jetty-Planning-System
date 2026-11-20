-- Partner API shipment plan submission — separate notification event from in-app submit.

BEGIN;

INSERT INTO notification_event_settings (event_key, enabled, in_app_enabled, email_enabled, include_post_signoff_breach, daily_send_hour)
VALUES
  ('shipment_plan.partner_submitted', TRUE, TRUE, TRUE, FALSE, 8)
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'shipment_plan.partner_submitted', 'in_app', NULL,
  'Partner submission: {{planReference}}',
  'Partner {{partnerName}} submitted shipment plan {{planReference}} at {{portName}} (ref {{externalReference}}). Review and approve or reject.',
  'approval',
  'actionApproveReject'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'shipment_plan.partner_submitted' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'shipment_plan.partner_submitted', 'email', NULL,
  'Jetty Planning: partner {{partnerName}} submitted plan {{planReference}}',
  E'Partner {{partnerName}} submitted a shipment plan via the integration API.\n\n'
    || E'Port: {{portName}}\n'
    || E'Plan reference: {{planReference}}\n'
    || E'External reference: {{externalReference}}\n'
    || E'Vessel: {{vesselName}}\n\n'
    || E'Open the approval page:\n'
    || E'{{actionUrl}}\n',
  'approval',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'shipment_plan.partner_submitted' AND t.channel = 'email' AND COALESCE(t.locale, '') = ''
);

COMMIT;