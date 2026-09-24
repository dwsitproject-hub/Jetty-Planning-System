-- Admin Operations Dashboard: email alert settings, check state, delivery log.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_ops_alert_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  email_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  alert_email TEXT NOT NULL DEFAULT 'it-project@energi-up.com',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO admin_ops_alert_settings (id, email_alerts_enabled, alert_email)
VALUES (1, FALSE, 'it-project@energi-up.com')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ops_alert_state (
  check_id TEXT PRIMARY KEY,
  last_status TEXT,
  last_summary TEXT,
  last_checked_at TIMESTAMPTZ,
  last_alerted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_ops_alert_deliveries (
  id BIGSERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  recipient_email TEXT,
  subject TEXT,
  unhealthy_checks JSONB,
  error_text TEXT,
  provider_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_ops_alert_deliveries_sent_at
  ON admin_ops_alert_deliveries (sent_at DESC);

COMMIT;
