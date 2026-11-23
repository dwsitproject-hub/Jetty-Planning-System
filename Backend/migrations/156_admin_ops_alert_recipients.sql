-- System Health Dashboard: per-check / per-port alert email recipients.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_ops_alert_recipients (
  id BIGSERIAL PRIMARY KEY,
  check_id TEXT NOT NULL,
  port_id BIGINT REFERENCES ports(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_ops_alert_recipients_check_only
  ON admin_ops_alert_recipients (check_id)
  WHERE port_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_ops_alert_recipients_check_port
  ON admin_ops_alert_recipients (check_id, port_id)
  WHERE port_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_ops_alert_recipients_check
  ON admin_ops_alert_recipients (check_id);

COMMIT;