/**
 * Unit tests for SMTP config encryption and eligibility helpers.
 * Run: node --test src/lib/smtp-config.test.js src/lib/etc-sla-eligibility.test.js
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  encryptSmtpPassword,
  decryptSmtpPassword,
  buildNodemailerTransport,
  buildSmtpConnectionOptions,
  getSmtpPostSendDelayMs,
  getSmtpRequireTls,
  invalidateSmtpTransportCache,
  isSmtpHubParityMode,
  isSmtpSendingConfigured,
  getSmtpEnvStatus,
} from './smtp-config.js';
import {
  formatOverdueDuration,
  buildBaseEligibilitySql,
  buildOperationalSignoffSql,
} from './etc-sla-eligibility.js';

describe('smtp-config', () => {
  const prevJwt = process.env.JWT_SECRET;
  before(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-smtp-encryption';
  });
  after(() => {
    process.env.JWT_SECRET = prevJwt;
    invalidateSmtpTransportCache();
  });

  it('encrypts and decrypts password round-trip', () => {
    const plain = 'super-secret-smtp-pass';
    const enc = encryptSmtpPassword(plain);
    assert.ok(enc);
    assert.notEqual(enc, plain);
    assert.equal(decryptSmtpPassword(enc), plain);
  });

  it('builds nodemailer transport when config is valid', () => {
    invalidateSmtpTransportCache();
    const t = buildNodemailerTransport({
      enabled: true,
      host: 'mail.example.com',
      port: 465,
      secure: true,
      user: 'noreply@example.com',
      pass: 'x',
      rejectUnauthorized: true,
    });
    assert.ok(t);
  });

  it('returns null transport when host missing', () => {
    assert.equal(buildNodemailerTransport({ enabled: true, host: '' }), null);
  });

  it('getSmtpRequireTls defaults false on 587 unless env set', () => {
    const prev = process.env.SMTP_REQUIRE_TLS;
    delete process.env.SMTP_REQUIRE_TLS;
    assert.equal(getSmtpRequireTls(587, false), false);
    process.env.SMTP_REQUIRE_TLS = 'true';
    assert.equal(getSmtpRequireTls(587, false), true);
    assert.equal(getSmtpRequireTls(465, true), false);
    process.env.SMTP_REQUIRE_TLS = prev;
  });

  it('isSmtpHubParityMode parses env flag', () => {
    const h = process.env.SMTP_HUB_PARITY;
    delete process.env.SMTP_HUB_PARITY;
    assert.equal(isSmtpHubParityMode(), false);
    process.env.SMTP_HUB_PARITY = '1';
    assert.equal(isSmtpHubParityMode(), true);
    process.env.SMTP_HUB_PARITY = h;
  });

  it('getSmtpEnvStatus reports unconfigured without SMTP_HOST', () => {
    const host = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    assert.deepEqual(getSmtpEnvStatus(), { configured: false, source: 'none' });
    process.env.SMTP_HOST = host;
  });

  it('buildSmtpConnectionOptions mirrors hub vs jps transport flags', () => {
    const cfg = {
      enabled: true,
      host: 'mail.example.com',
      port: 587,
      secure: false,
      user: 'u@example.com',
      pass: 'p',
      rejectUnauthorized: true,
    };
    const hub = process.env.SMTP_HUB_PARITY;
    process.env.SMTP_HUB_PARITY = 'true';
    invalidateSmtpTransportCache();
    const hubOpts = buildSmtpConnectionOptions(cfg);
    assert.equal(hubOpts.requireTLS, undefined);
    assert.equal(hubOpts.connectionTimeout, undefined);
    process.env.SMTP_HUB_PARITY = 'false';
    const prevTls = process.env.SMTP_REQUIRE_TLS;
    delete process.env.SMTP_REQUIRE_TLS;
    const jpsOpts = buildSmtpConnectionOptions(cfg);
    assert.equal(jpsOpts.requireTLS, false);
    process.env.SMTP_REQUIRE_TLS = prevTls;
    assert.equal(jpsOpts.connectionTimeout, 20_000);
    process.env.SMTP_HUB_PARITY = hub;
  });

  it('isSmtpSendingConfigured requires host user and pass', () => {
    assert.equal(isSmtpSendingConfigured({ enabled: true, host: 'h', user: 'u', pass: 'p' }), true);
    assert.equal(isSmtpSendingConfigured({ enabled: true, host: 'h', user: 'u' }), false);
  });

  it('getSmtpPostSendDelayMs clamps and parses env', () => {
    const prev = process.env.SMTP_POST_SEND_DELAY_MS;
    delete process.env.SMTP_POST_SEND_DELAY_MS;
    assert.equal(getSmtpPostSendDelayMs(), 0);
    process.env.SMTP_POST_SEND_DELAY_MS = '2000';
    assert.equal(getSmtpPostSendDelayMs(), 2000);
    process.env.SMTP_POST_SEND_DELAY_MS = '999999';
    assert.equal(getSmtpPostSendDelayMs(), 30_000);
    process.env.SMTP_POST_SEND_DELAY_MS = prev;
  });
});

describe('etc-sla-eligibility', () => {
  it('formatOverdueDuration formats hours and days', () => {
    assert.equal(formatOverdueDuration(0.5), '+30m');
    assert.equal(formatOverdueDuration(2.5), '+2.5h');
    assert.equal(formatOverdueDuration(26), '+1d 2h');
  });

  it('buildBaseEligibilitySql excludes sign-off when operational', () => {
    const sql = buildBaseEligibilitySql(false);
    assert.match(sql, /SIGNOFF_REQUESTED/);
    const withSignoff = buildBaseEligibilitySql(true);
    assert.doesNotMatch(buildOperationalSignoffSql(true), /SIGNOFF_REQUESTED/);
    assert.match(withSignoff, /shifting_out/);
  });
});
