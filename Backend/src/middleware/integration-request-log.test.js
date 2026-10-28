import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

const {
  allowUnknownKeyLog,
  buildRequestLogRow,
  createIntegrationRequestLogger,
  extractIntegrationPath,
  readKeyPrefix,
  resetUnknownKeyLogCap,
  toRoutePattern,
} = await import('./integration-request-log.js');

function fakeReq(overrides = {}) {
  return {
    method: 'get',
    originalUrl: '/api/v1/integrations/shipping-instructions/142?external_reference=OP-1',
    headers: { 'x-api-key': 'jps_live_abcdef0123456789abcdef0123456789' },
    ip: '10.0.0.5',
    query: { external_reference: 'OP-1' },
    body: {},
    integrationKey: { id: 7 },
    integrationRequestId: 'req_abc123',
    ...overrides,
  };
}

function fakeRes(statusCode = 200, locals = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.locals = locals;
  return res;
}

describe('integration-request-log helpers', () => {
  beforeEach(() => resetUnknownKeyLogCap());

  it('extractIntegrationPath drops the API prefix and query string', () => {
    assert.equal(
      extractIntegrationPath('/api/v1/integrations/shipping-instructions/142?x=1'),
      '/shipping-instructions/142'
    );
    assert.equal(extractIntegrationPath('/api/v1/integrations'), '/');
  });

  it('toRoutePattern replaces numeric segments only', () => {
    assert.equal(toRoutePattern('/shipping-instructions/142'), '/shipping-instructions/:id');
    assert.equal(toRoutePattern('/webhooks/3/x'), '/webhooks/:id/x');
    assert.equal(toRoutePattern('/catalog'), '/catalog');
  });

  it('readKeyPrefix keeps only the public prefix of a jps_live key', () => {
    assert.equal(readKeyPrefix('jps_live_abcdef0123456789'), 'jps_live_abcd');
    assert.equal(readKeyPrefix('not-a-jps-key'), null);
    assert.equal(readKeyPrefix(undefined), null);
  });

  it('allowUnknownKeyLog caps rows per IP per minute and resets after the window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i += 1) assert.equal(allowUnknownKeyLog('1.2.3.4', t0), true);
    assert.equal(allowUnknownKeyLog('1.2.3.4', t0), false);
    assert.equal(allowUnknownKeyLog('5.6.7.8', t0), true);
    assert.equal(allowUnknownKeyLog('1.2.3.4', t0 + 61_000), true);
  });
});

describe('buildRequestLogRow', () => {
  beforeEach(() => resetUnknownKeyLogCap());

  it('records a successful call with route pattern, reference and duration', () => {
    const row = buildRequestLogRow(fakeReq(), fakeRes(200), 45.4);
    assert.equal(row.apiKeyId, 7);
    assert.equal(row.method, 'GET');
    assert.equal(row.route, '/shipping-instructions/:id');
    assert.equal(row.path, '/shipping-instructions/142');
    assert.equal(row.statusCode, 200);
    assert.equal(row.durationMs, 45);
    assert.equal(row.externalReference, 'OP-1');
    assert.equal(row.keyPrefix, 'jps_live_abcd');
    assert.equal(row.errorCode, null);
  });

  it('records the error code set by sendIntegrationError', () => {
    const row = buildRequestLogRow(fakeReq(), fakeRes(409, { integrationErrorCode: 'NOT_PENDING' }), 10);
    assert.equal(row.statusCode, 409);
    assert.equal(row.errorCode, 'NOT_PENDING');
  });

  it('records rejected calls with no key id (401) and reads the reference from the body', () => {
    const req = fakeReq({
      integrationKey: undefined,
      query: {},
      body: { external_reference: 'OP-BODY' },
      method: 'POST',
      originalUrl: '/api/v1/integrations/shipping-instructions',
    });
    const row = buildRequestLogRow(req, fakeRes(401, { integrationErrorCode: 'INVALID_API_KEY' }), 3);
    assert.equal(row.apiKeyId, null);
    assert.equal(row.statusCode, 401);
    assert.equal(row.externalReference, 'OP-BODY');
  });

  it('never stores secrets or bodies: the row has no header or body fields', () => {
    const row = buildRequestLogRow(fakeReq({ body: { vessel_name: 'SECRET VESSEL' } }), fakeRes(200), 1);
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes('abcdef0123456789abcdef0123456789'), false);
    assert.equal(serialized.includes('SECRET VESSEL'), false);
  });

  it('returns null for unknown-key calls beyond the per-IP cap, but never for known keys', () => {
    const unknown = () => buildRequestLogRow(fakeReq({ integrationKey: undefined }), fakeRes(401), 1);
    for (let i = 0; i < 30; i += 1) assert.notEqual(unknown(), null);
    assert.equal(unknown(), null);
    assert.notEqual(buildRequestLogRow(fakeReq(), fakeRes(200), 1), null);
  });
});

describe('createIntegrationRequestLogger', () => {
  beforeEach(() => resetUnknownKeyLogCap());

  it('inserts one row when the response finishes', async () => {
    const inserts = [];
    const db = { query: async (sql, params) => inserts.push({ sql, params }) };
    const mw = createIntegrationRequestLogger(db);
    const res = fakeRes(200);
    let nextCalled = false;
    mw(fakeReq(), res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    res.emit('finish');
    await new Promise((r) => setImmediate(r));
    assert.equal(inserts.length, 1);
    assert.match(inserts[0].sql, /INSERT INTO integration_api_request_logs/);
    assert.equal(inserts[0].params[0], 7);
    assert.equal(inserts[0].params[6], 200);
  });

  it('does not throw or reject when the insert fails', async () => {
    const db = {
      query: async () => {
        throw new Error('db down');
      },
    };
    const origError = console.error;
    console.error = () => {};
    try {
      const mw = createIntegrationRequestLogger(db);
      const res = fakeRes(500);
      mw(fakeReq(), res, () => {});
      assert.doesNotThrow(() => res.emit('finish'));
      await new Promise((r) => setImmediate(r));
    } finally {
      console.error = origError;
    }
  });
});

describe('integrations router wiring', () => {
  it('mounts the request logger before key auth so 401 and 429 are recorded', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../routes/integrations.js', import.meta.url), 'utf8');
    const logAt = src.indexOf('router.use(integrationRequestLog)');
    const authAt = src.indexOf('router.use(requireIntegrationKey)');
    assert.ok(logAt >= 0 && authAt >= 0);
    assert.ok(logAt < authAt);
  });
});
