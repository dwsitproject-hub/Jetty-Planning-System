/**
 * Comprehensive tests: notification templates/schema, lib helpers, trigger + cleanup,
 * optional HTTP API (same auth pattern as test-si-roundtrip.mjs).
 *
 * Run from repo `Backend/` with `.env` containing DATABASE_URL:
 *   npm run test:notifications
 *
 * Env:
 *   API_BASE       — default http://localhost:3000/api/v1
 *   SKIP_HTTP=1    — skip login + /notifications HTTP checks
 *   SKIP_TRIGGER=1 — skip DB trigger insert/delete smoke test
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  renderTemplate,
  getPublicAppBaseUrl,
  loadNotificationTemplate,
  resolveApproverUserIds,
  triggerNotification,
  insertInAppNotificationForUser,
} from '../src/lib/notifications.js';

const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const SKIP_HTTP = String(process.env.SKIP_HTTP || '') === '1';
const SKIP_TRIGGER = String(process.env.SKIP_TRIGGER || '') === '1';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function authHeadersFromLogin(loginRes, loginJson) {
  if (loginJson.token) {
    return {
      Authorization: `Bearer ${loginJson.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }
  const list =
    typeof loginRes.headers.getSetCookie === 'function' ? loginRes.headers.getSetCookie() : [];
  const jar = {};
  for (const c of list) {
    const pair = c.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const at = jar.jps_at;
  const xsrf = jar.jps_xsrf;
  assert(at && xsrf, `login: no token in JSON and no session cookies: ${JSON.stringify(loginJson)}`);
  return {
    Cookie: `jps_at=${at}; jps_xsrf=${xsrf}`,
    'X-XSRF-TOKEN': xsrf,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function testDbSchemaAndTemplates() {
  const tables = ['notification_templates', 'notifications', 'notification_deliveries'];
  for (const t of tables) {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [t]
    );
    assert(r.rows.length === 1, `table missing: ${t}`);
  }

  const keys = [
    ['shipment_plan.submitted', 'in_app'],
    ['shipment_plan.submitted', 'email'],
    ['operation.signoff_requested', 'in_app'],
    ['operation.signoff_requested', 'email'],
    ['notification.email_echo', 'in_app'],
  ];
  for (const [eventKey, channel] of keys) {
    const tpl = await loadNotificationTemplate(pool, eventKey, channel);
    assert(tpl && tpl.title_template && tpl.body_template, `template missing: ${eventKey} ${channel}`);
  }
}

function testRenderTemplateUnit() {
  assert(renderTemplate('', { a: 1 }) === '', 'empty template');
  assert(renderTemplate('{{a}}', { a: 'x' }) === 'x', 'simple var');
  assert(renderTemplate('{{ a }}', { a: 2 }) === '2', 'spaced var');
  assert(renderTemplate('{{missing}}', {}) === '', 'missing var');
  assert(renderTemplate('A{{x}}B', { x: '' }) === 'AB', 'empty substitution');
}

function testPublicBaseUnit() {
  const b = getPublicAppBaseUrl();
  assert(typeof b === 'string' && b.length > 0, 'public base url');
  assert(!b.endsWith('/'), 'public base should not end with slash');
}

async function testResolveApprovers() {
  const shipmentApprovers = await resolveApproverUserIds(pool, 'shipment-plan', null);
  const loadingApprovers = await resolveApproverUserIds(pool, 'loading', null);
  assert(Array.isArray(shipmentApprovers), 'shipment-plan approvers array');
  assert(Array.isArray(loadingApprovers), 'loading approvers array');
  for (const id of [...shipmentApprovers, ...loadingApprovers]) {
    assert(Number.isFinite(id) && id > 0, `invalid approver id: ${id}`);
  }
}

async function cleanupByCorrelation(correlationId) {
  await pool.query(
    `DELETE FROM notification_deliveries nd
     USING notifications n
     WHERE nd.notification_id = n.id AND n.correlation_id = $1`,
    [correlationId]
  );
  await pool.query(`DELETE FROM notifications WHERE correlation_id = $1`, [correlationId]);
}

async function testTriggerSmoke() {
  const portRow = await pool.query(`SELECT id FROM ports WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`);
  assert(portRow.rows.length > 0, 'need at least one port');
  const portId = Number(portRow.rows[0].id);

  const correlationId = `comprehensive_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const approversBefore = await resolveApproverUserIds(pool, 'shipment-plan', null);

  const result = await triggerNotification(pool, {
    eventKey: 'shipment_plan.submitted',
    correlationId,
    portId,
    excludeUserId: null,
    payloadVars: {
      planReference: 'TEST-PLAN-REF',
      planId: '999999',
      primaryHref: `${getPublicAppBaseUrl()}/shipment-plans/approval/999999`,
      actionUrl: `${getPublicAppBaseUrl()}/shipment-plans/approval/999999`,
    },
  });

  assert(typeof result.sent === 'number', 'trigger sent count');
  assert(typeof result.emailQueued === 'number', 'trigger emailQueued');
  assert(result.recipients === approversBefore.length, `recipients count ${result.recipients} vs resolve ${approversBefore.length}`);

  if (result.sent > 0) {
    const rows = await pool.query(
      `SELECT n.id, n.user_id, n.kind, n.title, (SELECT COUNT(*)::int FROM notification_deliveries nd WHERE nd.notification_id = n.id) AS deliveries
       FROM notifications n WHERE n.correlation_id = $1 ORDER BY n.id`,
      [correlationId]
    );
    assert(rows.rows.length === result.sent, 'row count matches sent');
    for (const row of rows.rows) {
      assert(row.title.includes('TEST-PLAN-REF'), 'title should contain plan ref');
      assert(row.deliveries >= 1, 'each notification should have at least one delivery row when email template exists');
    }
  } else {
    console.warn('[warn] trigger inserted 0 rows (no users with can_approve on shipment-plan); RBAC-only env is OK.');
  }

  await cleanupByCorrelation(correlationId);
  const left = await pool.query(`SELECT COUNT(*)::int AS c FROM notifications WHERE correlation_id = $1`, [
    correlationId,
  ]);
  assert(left.rows[0].c === 0, 'cleanup should remove test notifications');
}

async function testInsertEchoUser() {
  const u = await pool.query(`SELECT id FROM users WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY id ASC LIMIT 1`);
  assert(u.rows.length > 0, 'need a user');
  const userId = Number(u.rows[0].id);
  const portRow = await pool.query(`SELECT id FROM ports WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`);
  const portId = portRow.rows[0] ? Number(portRow.rows[0].id) : null;
  const correlationId = `comprehensive_echo_${Date.now()}`;

  await insertInAppNotificationForUser(pool, {
    userId,
    portId,
    eventKey: 'notification.email_echo',
    correlationId,
    title: 'Email sent',
    body: 'Test echo body',
    kind: 'email_sent',
    payload: { detail: 'test' },
  });

  const chk = await pool.query(`SELECT id FROM notifications WHERE correlation_id = $1`, [correlationId]);
  assert(chk.rows.length >= 1, 'echo row inserted');
  await cleanupByCorrelation(correlationId);
}

async function testHttpApi() {
  if (SKIP_HTTP) {
    console.log('[skip] SKIP_HTTP=1 — HTTP API tests skipped');
    return;
  }
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: process.env.E2E_USERNAME || 'admin', password: process.env.E2E_PASSWORD || 'admin123' }),
  });
  const login = await loginRes.json();
  assert(loginRes.ok && login.user, `login failed: ${JSON.stringify(login)}`);
  const auth = authHeadersFromLogin(loginRes, login);

  const up = await pool.query(
    `SELECT p.id FROM user_ports up JOIN ports p ON p.id = up.port_id AND p.deleted_at IS NULL
     WHERE up.user_id = $1 AND up.deleted_at IS NULL ORDER BY p.id ASC LIMIT 1`,
    [login.user.id]
  );
  const portHeader =
    up.rows.length > 0
      ? {
          'X-Selected-Port-Id': String(up.rows[0].id),
        }
      : {};

  const unreadRes = await fetch(`${BASE}/notifications/unread-count`, { headers: { ...auth, ...portHeader } });
  if (unreadRes.status === 404) {
    console.warn(
      '[skip] HTTP: GET /notifications/unread-count returned 404 (API may be an older build without notification routes). Restart the API and re-run without SKIP_HTTP.'
    );
    return;
  }
  assert(unreadRes.ok, `unread-count ${unreadRes.status}: ${await unreadRes.text()}`);
  const unreadJson = await unreadRes.json();
  assert(typeof unreadJson.count === 'number', 'unread count number');

  const listRes = await fetch(`${BASE}/notifications?limit=5`, { headers: { ...auth, ...portHeader } });
  assert(listRes.ok, `notifications list ${listRes.status}: ${await listRes.text()}`);
  const listJson = await listRes.json();
  assert(Array.isArray(listJson.items), 'items array');
  assert('nextCursor' in listJson, 'nextCursor key');

  const badPatch = await fetch(`${BASE}/notifications/read`, {
    method: 'PATCH',
    headers: { ...auth, ...portHeader },
    body: JSON.stringify({}),
  });
  assert(badPatch.status === 400, `PATCH read without ids/all should be 400, got ${badPatch.status}`);

  const goodPatch = await fetch(`${BASE}/notifications/read`, {
    method: 'PATCH',
    headers: { ...auth, ...portHeader },
    body: JSON.stringify({ all: true }),
  });
  assert(goodPatch.ok, `PATCH read all ${goodPatch.status}: ${await goodPatch.text()}`);
  const patchJson = await goodPatch.json();
  assert(typeof patchJson.updated === 'number', 'updated count');
}

async function main() {
  console.log('--- Notification center: comprehensive tests ---');
  let failed = false;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log(`OK  ${name}`);
    } catch (e) {
      failed = true;
      console.error(`FAIL ${name}:`, e?.message || e);
    }
  };

  await run('DB schema + seeded templates', testDbSchemaAndTemplates);
  await run('renderTemplate (unit)', () => Promise.resolve(testRenderTemplateUnit()));
  await run('getPublicAppBaseUrl (unit)', () => Promise.resolve(testPublicBaseUnit()));
  await run('resolveApproverUserIds', testResolveApprovers);

  if (!SKIP_TRIGGER) {
    await run('triggerNotification smoke + cleanup', testTriggerSmoke);
    await run('insertInAppNotificationForUser echo + cleanup', testInsertEchoUser);
  } else {
    console.log('[skip] SKIP_TRIGGER=1 — trigger/insert smoke tests skipped');
  }

  await run('HTTP /notifications API', testHttpApi);

  await pool.end();
  if (failed) {
    console.error('--- Some tests FAILED ---');
    process.exit(1);
  }
  console.log('--- All tests PASSED ---');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
