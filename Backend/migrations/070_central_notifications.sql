-- Central notification engine: templates, per-user in-app rows, email delivery queue.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  locale TEXT,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info' CHECK (kind IN ('approval', 'clearance', 'email_sent', 'info')),
  primary_action_label_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_templates_event_channel_locale
  ON notification_templates (event_key, channel, COALESCE(locale, ''));

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  port_id BIGINT REFERENCES ports(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approval', 'clearance', 'email_sent', 'info')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_correlation
  ON notifications (user_id, correlation_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel = 'email'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error_text TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_queued
  ON notification_deliveries (created_at)
  WHERE status = 'queued';

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'shipment_plan.submitted', 'in_app', NULL,
  'Approval request: {{planReference}}',
  'A shipment plan was submitted for this port and requires your approval or rejection.',
    'approval',
    'actionApproveReject'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'shipment_plan.submitted' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'shipment_plan.submitted', 'email', NULL,
  'Jetty Planning: shipment plan {{planReference}} needs approval',
  E'A shipment plan was submitted and needs your approval.\n\nPlan reference: {{planReference}}\n\nOpen the approval page:\n{{actionUrl}}\n',
  'approval',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'shipment_plan.submitted' AND t.channel = 'email' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.signoff_requested', 'in_app', NULL,
  'Clearance: sign-off requested ({{jettyOperationCode}})',
  E'Sign-off was requested for vessel {{vesselName}} ({{jettyOperationCode}}). Review pending requests on Clearance.',
    'clearance',
    'actionReviewClearance'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.signoff_requested' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'operation.signoff_requested', 'email', NULL,
  'Clearance: sign-off for {{vesselName}} ({{jettyOperationCode}})',
  E'A sign-off was requested for vessel {{vesselName}} (operation {{jettyOperationCode}}).\n\nReview on Clearance:\n{{actionUrl}}\n',
  'clearance',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'operation.signoff_requested' AND t.channel = 'email' AND COALESCE(t.locale, '') = ''
);

INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind, primary_action_label_key)
SELECT 'notification.email_echo', 'in_app', NULL,
  'Email sent',
  '{{detail}}',
  'email_sent',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates t
  WHERE t.event_key = 'notification.email_echo' AND t.channel = 'in_app' AND COALESCE(t.locale, '') = ''
);

COMMIT;
