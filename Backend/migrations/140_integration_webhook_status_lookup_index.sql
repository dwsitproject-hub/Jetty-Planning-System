-- Status-change dedupe: latest status.changed delivery per endpoint and instruction.
CREATE INDEX IF NOT EXISTS idx_integration_webhook_deliveries_status_lookup
  ON integration_webhook_deliveries (endpoint_id, si_id, id DESC)
  WHERE event_type = 'status.changed';
