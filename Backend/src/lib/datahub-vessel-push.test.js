/**
 * Unit tests for outbound vessel push (Pattern A inbound).
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { clearDataHubTokenCache } from './datahub-client.js';
import {
  localVesselToHubPayload,
  pushVesselToDataHub,
} from './datahub-vessel-push.js';
import { hubRecordToLinkage } from './datahub-vessel-linkage.js';

const CFG = {
  baseUrl: 'https://hub.example.com',
  publicKey: 'dhm_pk_abc',
  privateKey: 'dhm_sk_xyz',
};

const TOKEN_OK = { body: { token: 'jwt-abc', expiresIn: '8h' } };

function stubFetch(responders) {
  const calls = [];
  const queue = [...responders];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ?? null });
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

const LOCAL_ROW = {
  id: 7,
  hub_code: null,
  vessel_name: 'MT TEST PUSH',
  vessel_imo: '9123456',
  vessel_type: 'tanker',
  heater: true,
  vessel_length_overall: '79',
};

describe('datahub-vessel-push', () => {
  beforeEach(() => clearDataHubTokenCache());

  it('maps local columns to canonical hub field names', () => {
    const payload = localVesselToHubPayload(LOCAL_ROW);
    assert.equal(payload.Vessel_Name, 'MT TEST PUSH');
    assert.equal(payload.Vessel_IMO, '9123456');
    assert.equal(payload.Vessel_Type, 'tanker');
    assert.equal(payload.Heater, true);
    assert.equal(payload.Vessel_Length_Overral, '79');
    assert.equal(payload.code, undefined);
  });

  it('includes code on PUT payloads when requested', () => {
    const payload = localVesselToHubPayload(
      { ...LOCAL_ROW, hub_code: 'VSL-0099' },
      { includeCode: true }
    );
    assert.equal(payload.code, 'VSL-0099');
  });

  it('extracts linkage from an inbound record', () => {
    const linkage = hubRecordToLinkage({
      id: '11111111-1111-1111-1111-111111111111',
      version: 2,
      updatedAt: '2026-09-21T08:00:00.000Z',
      data: { code: 'VSL-0042', Vessel_Name: 'MT TEST PUSH' },
    });
    assert.deepEqual(linkage, {
      hubCode: 'VSL-0042',
      hubRecordId: '11111111-1111-1111-1111-111111111111',
      hubVersion: 2,
      hubUpdatedAt: '2026-09-21T08:00:00.000Z',
    });
  });

  it('POSTs a new vessel and returns created linkage', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        status: 201,
        body: {
          status: 'created',
          code: 'VSL-0346',
          inboundId: 'inb-1',
          record: {
            id: '22222222-2222-2222-2222-222222222222',
            version: 1,
            updatedAt: '2026-09-21T08:01:00.000Z',
            data: { code: 'VSL-0346', Vessel_Name: 'MT TEST PUSH' },
          },
        },
      },
    ]);

    const result = await pushVesselToDataHub(CFG, LOCAL_ROW, fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'created');
    assert.equal(result.code, 'VSL-0346');
    assert.equal(result.linkage.hubCode, 'VSL-0346');
    assert.equal(calls[1].url, 'https://hub.example.com/v1/inbound/vessel');
    assert.equal(calls[1].method, 'POST');
    assert.ok(!JSON.parse(calls[1].body).code);
  });

  it('PUTs when hub_code is already linked', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        status: 200,
        body: {
          status: 'updated',
          code: 'VSL-0099',
          record: {
            id: '33333333-3333-3333-3333-333333333333',
            version: 4,
            updatedAt: '2026-09-21T08:02:00.000Z',
            data: { code: 'VSL-0099', Vessel_Name: 'MT TEST PUSH' },
          },
        },
      },
    ]);

    const result = await pushVesselToDataHub(CFG, { ...LOCAL_ROW, hub_code: 'VSL-0099' }, fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'updated');
    assert.equal(calls[1].method, 'PUT');
    assert.match(calls[1].url, /\/v1\/inbound\/vessel\/VSL-0099$/);
    assert.equal(JSON.parse(calls[1].body).code, 'VSL-0099');
  });

  it('links on 409 duplicate and escalates to PUT when local data differs', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        status: 409,
        body: {
          status: 'duplicate',
          code: 'VSL-0100',
          inboundId: 'inb-dup',
          record: {
            id: '44444444-4444-4444-4444-444444444444',
            version: 3,
            updatedAt: '2026-09-21T08:03:00.000Z',
            data: {
              code: 'VSL-0100',
              Vessel_Name: 'MT TEST PUSH',
              Vessel_Type: 'barge',
            },
          },
        },
      },
      {
        status: 200,
        body: {
          status: 'updated',
          code: 'VSL-0100',
          record: {
            id: '44444444-4444-4444-4444-444444444444',
            version: 4,
            updatedAt: '2026-09-21T08:04:00.000Z',
            data: { code: 'VSL-0100', Vessel_Name: 'MT TEST PUSH', Vessel_Type: 'tanker' },
          },
        },
      },
    ]);

    const result = await pushVesselToDataHub(CFG, LOCAL_ROW, fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.message, 'duplicate_linked_then_updated');
    assert.equal(result.priorStatus, 'duplicate');
    assert.equal(calls.length, 3);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[2].method, 'PUT');
  });

  it('links on 409 duplicate without PUT when hub data already matches', async () => {
    const { fetchImpl, calls } = stubFetch([
      TOKEN_OK,
      {
        status: 409,
        body: {
          status: 'duplicate',
          code: 'VSL-0100',
          record: {
            id: '44444444-4444-4444-4444-444444444444',
            version: 3,
            updatedAt: '2026-09-21T08:03:00.000Z',
            data: {
              code: 'VSL-0100',
              Vessel_Name: 'MT TEST PUSH',
              Vessel_IMO: '9123456',
              Vessel_Type: 'tanker',
              Heater: true,
              Vessel_Length_Overral: '79',
            },
          },
        },
      },
    ]);

    const result = await pushVesselToDataHub(CFG, LOCAL_ROW, fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.message, 'duplicate_linked');
    assert.equal(calls.length, 2);
  });
});
