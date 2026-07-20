-- SLA notification admin config: event settings, recipients, SMTP, templates.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_event_settings (
  event_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  include_post_signoff_breach BOOLEAN NOT NULL DEFAULT FALSE,
  daily_send_hour SMALLINT NOT NULL DEFAULT 8 CHECK (daily_send_hour >= 0 AND daily_send_hour <= 23),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_event_recipients (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL REFERENCES notification_event_settings(event_key) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT REFERENCES roles(id) ON DELETE CASCADE,
  port_id BIGINT REFERENCES ports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_event_recipients_user_or_role CHECK (
    (user_id IS NOT NULL AND role_id IS NULL) OR (user_id IS NULL AND role_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event_recipients_event_user
  ON notification_event_recipients (event_key, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event_recipients_event_role_port
  ON notification_event_recipients (event_key, role_id, COALESCE(port_id, 0));

CREATE TABLE IF NOT EXISTS smtp_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  host TEXT,
  port INTEGER NOT NULL DEFAULT 465,
  secure BOOLEAN NOT NULL DEFAULT TRUE,
  "user" TEXT,
  password_encrypted TEXT,
  from_address TEXT,
  reject_unauthorized BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO smtp_config (id, enabled)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notification_event_settings (event_key, enabled, in_app_enabled, email_enabled, include_post_signoff_breach, daily_send_hour)
VALUES
  ('operation.sla_etc_d1', TRUE, TRUE, TRUE, FALSE, 8),
  ('operation.sla_etc_breach', TRUE, TRUE, TRUE, FALSE, 8)
ON CONFLICT (event_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_updated
  ON notification_deliveries (status, updated_at DESC);

-- In-app templates
INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.sla_etc_d1', 'in_app', NULL,
  'SLA reminder: {{vesselName}} (ETC tomorrow)',
  'Vessel {{vesselName}} at {{jettyName}} is scheduled to complete tomorrow (ETC: {{etcFormatted}}). Please expedite operations.',
  'info',
  'actionViewAtBerth'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.sla_etc_d1' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.sla_etc_breach', 'in_app', NULL,
  'SLA breach: {{vesselName}} ({{overdueFormatted}} overdue)',
  'Vessel {{vesselName}} at {{jettyName}} has exceeded ETC ({{etcFormatted}}). Overdue: {{overdueFormatted}}.',
  'info',
  'actionViewAtBerth'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.sla_etc_breach' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

-- Email templates
INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.sla_etc_d1', 'email', NULL,
  'Jetty Planning: SLA reminder — {{vesselName}} (ETC tomorrow)',
  E'Vessel {{vesselName}} at {{jettyName}} is scheduled to complete tomorrow.\n\nOperation: {{jettyOperationCode}}\nPlan: {{planReference}}\nPort: {{portName}}\nETC: {{etcFormatted}}\n\nOpen At Berth:\n{{actionUrl}}\n',
  'info',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.sla_etc_d1' AND t.channel = 'email' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.sla_etc_breach', 'email', NULL,
  'Jetty Planning: SLA breach — {{vesselName}} ({{overdueFormatted}} overdue)',
  E'Vessel {{vesselName}} at {{jettyName}} has exceeded the estimated completion time.\n\nOperation: {{jettyOperationCode}}\nPlan: {{planReference}}\nPort: {{portName}}\nETC: {{etcFormatted}}\nOverdue: {{overdueFormatted}}\n\nOpen At Berth:\n{{actionUrl}}\n',
  'info',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.sla_etc_breach' AND t.channel = 'email' AND COALESCE(t.locale, '') = ''
);

COMMIT;
