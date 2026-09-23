/**
 * Unit tests for DataHub config storage: encryption round-trip, write-only
 * private key, and base URL normalization.
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import {
  getDataHubConfigForAdmin,
  getEffectiveDataHubConfig,
  normalizeBaseUrl,
  saveDataHubConfig,
  trimBaseUrl,
} from './datahub-config.js';

/** Minimal in-memory stand-in for the datahub_config singleton row. */
function fakeDb(initial = {}) {
  const row = {
    id: 1,
    base_url: null,
    public_key: null,
    private_key_encrypted: null,
    enabled: false,
    last_sync_at: null,
    last_sync_ok: null,
    last_error: null,
    updated_at: null,
    updated_by: null,
    ...initial,
  };
  return {
    row,
    async query(sql, params = []) {
      if (/^\s*SELECT/i.test(sql)) return { rows: [row] };
      if (/UPDATE datahub_config SET\s+base_url/i.test(sql)) {
        const [baseUrl, publicKey, privateKeyEncrypted, enabled, updatedBy] = params;
        Object.assign(row, {
          base_url: baseUrl,
          public_key: publicKey,
          private_key_encrypted: privateKeyEncrypted,
          enabled,
          updated_by: updatedBy,
        });
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

describe('datahub-config', () => {
  const prevJwt = process.env.JWT_SECRET;
  const prevBase = process.env.DHM_BASE_URL;
  const prevPublic = process.env.DHM_PUBLIC_KEY;
  const prevPrivate = process.env.DHM_PRIVATE_KEY;

  before(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-datahub-encryption';
  });
  after(() => {
    process.env.JWT_SECRET = prevJwt;
    process.env.DHM_BASE_URL = prevBase;
    process.env.DHM_PUBLIC_KEY = prevPublic;
    process.env.DHM_PRIVATE_KEY = prevPrivate;
  });
  beforeEach(() => {
    delete process.env.DHM_BASE_URL;
    delete process.env.DHM_PUBLIC_KEY;
    delete process.env.DHM_PRIVATE_KEY;
  });

  it('normalizes and trims base URLs', () => {
    assert.equal(trimBaseUrl('https://hub.example.com/'), 'https://hub.example.com');
    assert.equal(normalizeBaseUrl(' https://hub.example.com/// '), 'https://hub.example.com');
    assert.equal(normalizeBaseUrl('http://172.28.92.56:3000/api'), 'http://172.28.92.56:3000/api');
    assert.throws(() => normalizeBaseUrl(''), /baseUrl is required/);
    assert.throws(() => normalizeBaseUrl('not a url'), /valid URL/);
    assert.throws(() => normalizeBaseUrl('ftp://hub.example.com'), /http or https/);
  });

  it('stores the private key encrypted and decrypts it for server use', async () => {
    const db = fakeDb();
    await saveDataHubConfig(
      db,
      {
        baseUrl: 'https://hub.example.com',
        publicKey: 'dhm_pk_abc',
        privateKey: 'dhm_sk_super_secret',
        enabled: true,
      },
      7
    );

    assert.ok(db.row.private_key_encrypted);
    assert.ok(!db.row.private_key_encrypted.includes('dhm_sk_super_secret'));
    assert.equal(db.row.updated_by, 7);

    const effective = await getEffectiveDataHubConfig(db);
    assert.equal(effective.source, 'database');
    assert.equal(effective.baseUrl, 'https://hub.example.com');
    assert.equal(effective.privateKey, 'dhm_sk_super_secret');
  });

  it('never returns the private key to an admin reader', async () => {
    const db = fakeDb();
    await saveDataHubConfig(
      db,
      { baseUrl: 'https://hub.example.com', publicKey: 'pk', privateKey: 'sk-secret', enabled: true },
      1
    );

    const dto = await getDataHubConfigForAdmin(db);
    assert.equal(dto.privateKeyConfigured, true);
    assert.equal(dto.publicKey, 'pk');
    assert.ok(!Object.prototype.hasOwnProperty.call(dto, 'privateKey'));
    assert.ok(!JSON.stringify(dto).includes('sk-secret'));
  });

  it('keeps the stored private key when the save omits it', async () => {
    const db = fakeDb();
    await saveDataHubConfig(
      db,
      { baseUrl: 'https://hub.example.com', publicKey: 'pk', privateKey: 'sk-original', enabled: true },
      1
    );
    const firstCipher = db.row.private_key_encrypted;

    await saveDataHubConfig(db, { baseUrl: 'https://hub2.example.com', publicKey: 'pk2', enabled: true }, 1);
    assert.equal(db.row.private_key_encrypted, firstCipher);
    assert.equal(db.row.base_url, 'https://hub2.example.com');

    const effective = await getEffectiveDataHubConfig(db);
    assert.equal(effective.privateKey, 'sk-original');

    // An explicitly blank private key is also treated as "keep".
    await saveDataHubConfig(db, { privateKey: '   ' }, 1);
    assert.equal(db.row.private_key_encrypted, firstCipher);
  });

  it('refuses to enable without a complete key pair', async () => {
    const db = fakeDb();
    await assert.rejects(
      saveDataHubConfig(db, { baseUrl: 'https://hub.example.com', publicKey: 'pk', enabled: true }, 1),
      /required to enable/
    );
  });

  it('falls back to the environment when the row is disabled', async () => {
    const db = fakeDb();
    process.env.DHM_BASE_URL = 'https://env-hub.example.com/';
    process.env.DHM_PUBLIC_KEY = 'env-pk';
    process.env.DHM_PRIVATE_KEY = 'env-sk';

    const effective = await getEffectiveDataHubConfig(db);
    assert.equal(effective.source, 'environment');
    assert.equal(effective.baseUrl, 'https://env-hub.example.com');
    assert.equal(effective.privateKey, 'env-sk');
  });

  it('reports no source when neither the row nor the environment is set', async () => {
    const effective = await getEffectiveDataHubConfig(fakeDb());
    assert.equal(effective.source, 'none');
    assert.equal(effective.enabled, false);
  });
});
