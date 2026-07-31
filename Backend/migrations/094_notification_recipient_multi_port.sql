-- Allow same user/role recipient on multiple ports (multi-port SLA notifications).

BEGIN;

DROP INDEX IF EXISTS idx_notification_event_recipients_event_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event_recipients_event_user_port
  ON notification_event_recipients (event_key, user_id, COALESCE(port_id, 0))
  WHERE user_id IS NOT NULL;

COMMIT;
