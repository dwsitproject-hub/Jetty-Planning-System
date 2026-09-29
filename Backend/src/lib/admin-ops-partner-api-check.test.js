import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTNER_API_STALE_MS,
  derivePartnerApiStatus,
  buildPartnerApiSummary,
} from './admin-ops-partner-api-check.js';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const STALE = PARTNER_API_STALE_MS;

test('derivePartnerApiStatus returns disabled when no active keys', () => {
  assert.equal(derivePartnerApiStatus({ activeKeys: 0, lastActivityAt: null }, NOW), 'disabled');
});

test('derivePartnerApiStatus returns unknown when keys exist but never used', () => {
  assert.equal(derivePartnerApiStatus({ activeKeys: 2, lastActivityAt: null }, NOW), 'unknown');
});

test('derivePartnerApiStatus returns healthy within stale window', () => {
  const twoDaysAgo = new Date(NOW - 2 * 86400000).toISOString();
  assert.equal(derivePartnerApiStatus({ activeKeys: 1, lastActivityAt: twoDaysAgo }, NOW, STALE), 'healthy');
});

test('derivePartnerApiStatus returns healthy at exactly stale boundary', () => {
  const atBoundary = new Date(NOW - STALE).toISOString();
  assert.equal(derivePartnerApiStatus({ activeKeys: 1, lastActivityAt: atBoundary }, NOW, STALE), 'healthy');
});

test('derivePartnerApiStatus returns degraded beyond stale window', () => {
  const twelveDaysAgo = new Date(NOW - 12 * 86400000).toISOString();
  assert.equal(
    derivePartnerApiStatus({ activeKeys: 2, lastActivityAt: twelveDaysAgo }, NOW, STALE),
    'degraded'
  );
});

test('buildPartnerApiSummary formats status messages', () => {
  assert.equal(buildPartnerApiSummary('disabled', 0, null, NOW), 'No active partner API keys');
  assert.equal(
    buildPartnerApiSummary('unknown', 2, null, NOW),
    '2 active keys; no API usage recorded yet'
  );
  const twoDaysAgo = new Date(NOW - 2 * 86400000).toISOString();
  assert.match(
    buildPartnerApiSummary('healthy', 1, twoDaysAgo, NOW),
    /1 active key; last activity 2d ago/
  );
  const twelveDaysAgo = new Date(NOW - 12 * 86400000).toISOString();
  assert.match(
    buildPartnerApiSummary('degraded', 3, twelveDaysAgo, NOW),
    /3 active keys; last activity 12d ago/
  );
});
