/**
 * Unit tests for the DataHub client: token exchange, header construction,
 * hub-record normalization, cursor pagination, and error shaping. `fetch` is
 * stubbed, so these run without DataHub being reachable.
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  SYNC_PAGE_LIMIT,
  buildAuthHeaders,
  clearDataHubTokenCache,
  fetchAllVessels,
  fetchAppToken,
  fetchVesselCatalog,
  looksLikeHtml,
  postInboundVessel,
  putInboundVessel,
  normalizeHubVessel,
  parseExpiresInSeconds,
  parseSyncPage,
} from './datahub-client.js';

const CFG = {
  baseUrl: 'https://hub.example.com',
  publicKey: 'dhm_pk_abc',
  privateKey: 'dhm_sk_xyz',
};

/** A successful POST /auth/token response. */
const TOKEN_OK = { body: { token: 'jwt-abc', expiresIn: '8h', application: { slug: 'jps' } } };

/** Returns a fetch stub plus a log of how it was called. */
function stubFetch(responders) {
  const calls = [];
  const queue = [...responders];
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      headers: init?.headers,
      method: init?.method ?? 'GET',
      body: init?.body ?? null,
    });
    const responder = queue.shift();
    if (!responder) throw new Error(`unexpected fetch: ${url}`);
    const { status = 200, body, contentType = 'application/json' } = responder;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? contentType : null) },
      async text() {
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
    };
  };
  return { fetchImpl, calls };
}

function hubRecord(name, code, overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    version: 3,
    isDeleted: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
    data: {
      code,
      Vessel_Name: name,
      Vessel_IMO: '9876543',
      Vessel_Gross_Tonnage: 1878,
      Vessel_Draft: '3.90',
      Vessel_Length_Overral: '79',
      Vessel_Type: 'barge',
      Heater: false,
      ...(overrides.data || {}),
    },
  };
}

describe('datahub-client', () => {
  // Tokens are cached process-wide, so every test starts from a clean slate.
  beforeEach(() => clearDataHubTokenCache());

  it('builds the documented key-pair headers', () => {
    const headers = buildAuthHeaders(CFG);
    assert.equal(headers['X-DHM-Public-Key'], 'dhm_pk_abc');
    assert.equal(headers['X-DHM-Private-Key'], 'dhm_sk_xyz');
    assert.equal(headers.Accept, 'application/json');
  });

  it('refuses to build headers without both keys', () => {
    assert.throws(() => buildAuthHeaders({ publicKey: 'pk' }), /public and private keys/);
    assert.throws(() => buildAuthHeaders({ privateKey: 'sk' }), /public and private keys/);
  });

  it('reads DHM duration strings and numeric expiries', () => {
    assert.equal(parseExpiresInSeconds('8h'), 28800);
    assert.equal(parseExpiresInSeconds('30m'), 1800);
    assert.equal(parseExpiresInSeconds('45s'), 45);
    assert.equal(parseExpiresInSeconds('1d'), 86400);
    assert.equal(parseExpiresInSeconds(900), 900);
    assert.equal(parseExpiresInSeconds('900'), 900);
    // Anything unrecognized falls back to an hour rather than never expiring.
    assert.equal(parseExpiresInSeconds(undefined), 3600);
    assert.equal(parseExpiresInSeconds('soon'), 3600);
    assert.equal(parseExpiresInSeconds(-5), 3600);
  });

  it('posts the key pair as JSON to /auth/token', async () => {
    const { fetchImpl, calls } = stubFetch([TOKEN_OK]);
    const result = await fetchAppToken(CFG, fetchImpl);
    assert.equal(calls[0].url, 'https://hub.example.com/auth/token');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), {
      publicKey: 'dhm_pk_abc',
      privateKey: 'dhm_sk_xyz',
    });
    assert.equal(result.token, 'jwt-abc');
    assert.equal(result.expiresInSeconds, 28800);
  });

  it('rejects a token response with no token in it', async () => {
    const { fetchImpl } = stubFetch([{ body: { expiresIn: '8h' } }]);
    await assert.rejects(() => fetchAppToken(CFG, fetchImpl), /did not return an app token/);
  });

  it('exchanges the key pair for a token, then authorizes with Bearer', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { slug: 'vessel', name: 'Vessel', fields: [{ key: 'Vessel_Name' }] } },
    ]);
    const result = await fetchVesselCatalog(CFG, fetchImpl);

    assert.equal(calls[0].url, 'https://hub.example.com/auth/token');
    assert.equal(calls[1].url, 'https://hub.example.com/v1/catalog/vessel');
    assert.equal(calls[1].headers.Authorization, 'Bearer jwt-abc');
    // The key pair must not ride along once a token is in hand.
    assert.equal(calls[1].headers['X-DHM-Private-Key'], undefined);
    assert.equal(result.slug, 'vessel');
    assert.equal(result.fieldCount, 1);
  });

  it('falls back to key-pair headers when /auth/token does not exist', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 404, body: { error: 'Not Found' } },
      { body: { slug: 'vessel', fields: [] } },
    ]);
    await fetchVesselCatalog(CFG, fetchImpl);
    assert.equal(calls[1].headers['X-DHM-Public-Key'], 'dhm_pk_abc');
    assert.equal(calls[1].headers.Authorization, undefined);
  });

  it('propagates a rejected key pair from the token exchange', async () => {
    const { fetchImpl } = stubFetch([
      { status: 401, body: { error: 'Invalid application credentials' } },
    ]);
    await assert.rejects(
      () => fetchVesselCatalog(CFG, fetchImpl),
      (e) => {
        assert.equal(e.status, 401);
        assert.match(e.message, /Invalid application credentials/);
        return true;
      }
    );
  });

  it('maps hub fields onto local columns, including the misspelled LOA key', () => {
    const v = normalizeHubVessel(hubRecord('MT A', 'VSL-0001'));
    assert.equal(v.hubCode, 'VSL-0001');
    assert.equal(v.hubVersion, 3);
    assert.equal(v.values.vessel_name, 'MT A');
    assert.equal(v.values.vessel_length_overall, '79');
    assert.equal(v.values.vessel_gross_tonnage, 1878);
    assert.equal(v.values.vessel_draft, 3.9);
    assert.equal(v.values.heater, false);
    assert.equal(v.values.vessel_mmsi, null);
  });

  it('drops records with no usable vessel name', () => {
    assert.equal(normalizeHubVessel({ id: 'x', data: { Vessel_Name: '   ' } }), null);
    assert.equal(normalizeHubVessel({ id: 'x' }), null);
    assert.equal(normalizeHubVessel(null), null);
  });

  it('parses a sync page into vessels plus the cursor state', () => {
    const page = parseSyncPage({
      records: [hubRecord('MT A', 'VSL-0001'), hubRecord('MT B', 'VSL-0002')],
      hasMore: true,
      nextCursor: 'cur-2',
    });
    assert.equal(page.vessels.length, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, 'cur-2');

    const empty = parseSyncPage({});
    assert.deepEqual(empty.vessels, []);
    assert.equal(empty.hasMore, false);
    assert.equal(empty.nextCursor, null);
  });

  it('follows nextCursor until the hub reports no more pages, on one token', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { records: [hubRecord('MT A', 'VSL-0001')], hasMore: true, nextCursor: 'cur-2' } },
      { body: { records: [hubRecord('MT B', 'VSL-0002')], hasMore: true, nextCursor: 'cur-3' } },
      { body: { records: [hubRecord('MT C', 'VSL-0003')], hasMore: false, nextCursor: null } },
    ]);

    const vessels = await fetchAllVessels(CFG, fetchImpl);
    assert.deepEqual(
      vessels.map((v) => v.values.vessel_name),
      ['MT A', 'MT B', 'MT C']
    );
    assert.equal(calls.length, 4);
    assert.equal(calls[1].url, `https://hub.example.com/v1/sync/vessel?limit=${SYNC_PAGE_LIMIT}`);
    assert.equal(calls[2].url, 'https://hub.example.com/v1/sync/vessel?cursor=cur-2');
    assert.equal(calls[3].url, 'https://hub.example.com/v1/sync/vessel?cursor=cur-3');
    assert.equal(calls[3].headers.Authorization, 'Bearer jwt-abc');
    // Only one token request for the whole paged pull.
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/token')).length, 1);
  });

  it('reuses a cached token across separate calls', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { slug: 'vessel', fields: [] } },
      { body: { slug: 'vessel', fields: [] } },
    ]);
    await fetchVesselCatalog(CFG, fetchImpl);
    await fetchVesselCatalog(CFG, fetchImpl);
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/token')).length, 1);
  });

  it('requests a fresh token after the cache is cleared', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { slug: 'vessel', fields: [] } },
      TOKEN_OK,
      { body: { slug: 'vessel', fields: [] } },
    ]);
    await fetchVesselCatalog(CFG, fetchImpl);
    clearDataHubTokenCache();
    await fetchVesselCatalog(CFG, fetchImpl);
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/token')).length, 2);
  });

  it('stops when hasMore is true but no cursor is returned', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { records: [hubRecord('MT A', 'VSL-0001')], hasMore: true, nextCursor: null } },
    ]);
    const vessels = await fetchAllVessels(CFG, fetchImpl);
    assert.equal(vessels.length, 1);
    assert.equal(calls.length, 2);
  });

  it('percent-encodes cursors', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { body: { records: [], hasMore: true, nextCursor: 'a b/c+d' } },
      { body: { records: [], hasMore: false } },
    ]);
    await fetchAllVessels(CFG, fetchImpl);
    assert.equal(calls[2].url, 'https://hub.example.com/v1/sync/vessel?cursor=a%20b%2Fc%2Bd');
  });

  it('summarizes the catalog for the connection test', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        body: {
          slug: 'vessel',
          name: 'Vessel',
          fields: [{ key: 'Vessel_Name' }, { key: 'Vessel_IMO' }],
        },
      },
    ]);
    const result = await fetchVesselCatalog(CFG, fetchImpl);
    assert.equal(calls[1].url, 'https://hub.example.com/v1/catalog/vessel');
    assert.equal(result.slug, 'vessel');
    assert.equal(result.fieldCount, 2);
    assert.deepEqual(result.fieldKeys, ['Vessel_Name', 'Vessel_IMO']);
  });

  it('surfaces the hub error message and status', async () => {
    const { fetchImpl } = stubFetch([
      TOKEN_OK,
      { status: 403, body: { message: 'Entity not allowed for this key pair' } },
    ]);
    await assert.rejects(
      () => fetchVesselCatalog(CFG, fetchImpl),
      (e) => {
        assert.equal(e.status, 403);
        assert.match(e.message, /Entity not allowed/);
        return true;
      }
    );
  });

  it('rejects a non-JSON success response', async () => {
    const { fetchImpl } = stubFetch([TOKEN_OK, { body: 'gateway timeout, plain text' }]);
    await assert.rejects(() => fetchVesselCatalog(CFG, fetchImpl), /non-JSON/);
  });

  it('detects HTML by content type and by body sniffing', () => {
    const htmlHeaders = { headers: { get: () => 'text/html; charset=utf-8' } };
    const jsonHeaders = { headers: { get: () => 'application/json' } };
    assert.equal(looksLikeHtml(htmlHeaders, '{}'), true);
    assert.equal(looksLikeHtml(jsonHeaders, '<!DOCTYPE html><html>…'), true);
    assert.equal(looksLikeHtml(jsonHeaders, '  <html lang="en">'), true);
    assert.equal(looksLikeHtml(jsonHeaders, '{"slug":"vessel"}'), false);
    // A response with no headers object at all must not blow up.
    assert.equal(looksLikeHtml(undefined, '{"slug":"vessel"}'), false);
  });

  it('reports a portal URL as a misconfiguration rather than raw markup', async () => {
    // The portal 404s the token route too, so the client falls back to the key
    // pair and then hits the same HTML on the catalog call.
    const portal404 = {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html lang="en"><head><link rel="preload" href="/_next/static/media/x.woff2"',
    };
    const { fetchImpl } = stubFetch([portal404, portal404]);
    await assert.rejects(
      () => fetchVesselCatalog(CFG, fetchImpl),
      (e) => {
        assert.equal(e.isHtml, true);
        assert.equal(e.status, 404);
        assert.match(e.message, /web page/);
        assert.match(e.message, /portal instead of the \/v1 API host/);
        assert.ok(!e.message.includes('_next'), 'raw markup must not leak into the message');
        return true;
      }
    );
  });

  it('POST inbound vessel returns 201 without throwing', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        status: 201,
        body: { status: 'created', code: 'VSL-0001', record: { data: { code: 'VSL-0001' } } },
      },
    ]);
    const result = await postInboundVessel(CFG, { Vessel_Name: 'MT A' }, fetchImpl);
    assert.equal(result.httpStatus, 201);
    assert.equal(result.body.status, 'created');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, 'https://hub.example.com/v1/inbound/vessel');
  });

  it('POST inbound vessel returns 409 without throwing', async () => {
    const { fetchImpl } = stubFetch([
      TOKEN_OK,
      { status: 409, body: { status: 'duplicate', code: 'VSL-0001', record: { data: { code: 'VSL-0001' } } } },
    ]);
    const result = await postInboundVessel(CFG, { Vessel_Name: 'MT A' }, fetchImpl);
    assert.equal(result.httpStatus, 409);
    assert.equal(result.body.status, 'duplicate');
  });

  it('PUT inbound vessel sends code in URL and body', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      { status: 200, body: { status: 'updated', code: 'VSL-0001' } },
    ]);
    await putInboundVessel(CFG, 'VSL-0001', { Vessel_Name: 'MT A', Vessel_Type: 'tanker' }, fetchImpl);
    assert.equal(calls[1].method, 'PUT');
    assert.equal(JSON.parse(calls[1].body).code, 'VSL-0001');
  });

  it('flags an HTML login redirect served with a 200', async () => {
    const { fetchImpl } = stubFetch([
      { status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><title>Some Portal</title>' },
    ]);
    await assert.rejects(
      () => fetchVesselCatalog(CFG, fetchImpl),
      (e) => {
        assert.equal(e.isHtml, true);
        return true;
      }
    );
  });
});
