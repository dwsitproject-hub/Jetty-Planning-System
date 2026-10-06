-- Admin-configurable toggles for workflow notifications (Shipment Plan Approval, Sign-off Requested).

BEGIN;

INSERT INTO notification_event_settings (event_key, enabled, in_app_enabled, email_enabled, include_post_signoff_breach, daily_send_hour)
VALUES
  ('shipment_plan.submitted', TRUE, TRUE, TRUE, FALSE, 8),
  ('operation.signoff_requested', TRUE, TRUE, TRUE, FALSE, 8)
ON CONFLICT (event_key) DO NOTHING;

COMMIT;
