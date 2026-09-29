import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNewlyUnhealthy,
  canSendAdminOpsAlerts,
  buildAdminOpsAlertEmail,
} from './admin-ops-alert-logic.js';

test('isNewlyUnhealthy detects transition into unhealthy only', () => {
  assert.equal(isNewlyUnhealthy(null, 'unhealthy'), false);
  assert.equal(isNewlyUnhealthy('', 'unhealthy'), false);
  assert.equal(isNewlyUnhealthy('unhealthy', 'unhealthy'), false);
  assert.equal(isNewlyUnhealthy('healthy', 'unhealthy'), true);
  assert.equal(isNewlyUnhealthy('degraded', 'unhealthy'), true);
  assert.equal(isNewlyUnhealthy('unknown', 'unhealthy'), true);
  assert.equal(isNewlyUnhealthy('disabled', 'unhealthy'), true);
  assert.equal(isNewlyUnhealthy('healthy', 'degraded'), false);
  assert.equal(isNewlyUnhealthy('unhealthy', 'healthy'), false);
});

test('canSendAdminOpsAlerts requires dashboard toggle and global email enabled', () => {
  assert.deepEqual(canSendAdminOpsAlerts({ emailAlertsEnabled: false }), {
    ok: false,
    reason: 'disabled',
  });
  assert.deepEqual(
    canSendAdminOpsAlerts({ emailAlertsEnabled: true }, { NOTIFICATION_EMAIL_ENABLED: 'false' }),
    { ok: false, reason: 'email_globally_disabled' }
  );
  assert.deepEqual(canSendAdminOpsAlerts({ emailAlertsEnabled: true }), {
    ok: true,
  });
});

test('buildAdminOpsAlertEmail formats subject and body', () => {
  const { subject, text } = buildAdminOpsAlertEmail(
    [{ id: 'synology_mount', title: 'Synology upload mount', summary: 'Host mount check failed' }],
    '2026-09-24T10:00:00.000Z'
  );
  assert.match(subject, /Unhealthy: Synology upload mount/);
  assert.match(text, /Synology upload mount/);
  assert.match(text, /Host mount check failed/);
  assert.match(text, /admin\/operations/);
});
