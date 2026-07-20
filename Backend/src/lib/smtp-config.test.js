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
  invalidateSmtpTransportCache,
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
