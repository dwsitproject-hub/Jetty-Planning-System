import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  signWebhookPayload,
  generateWebhookSecret,
  webhookSecretPrefix,
  isValidWebhookEndpointUrl,
} from './integration-webhooks.js';

describe('integration-webhooks', () => {
  it('signWebhookPayload is deterministic HMAC sha256', () => {
    const secret = 'whsec_test_secret_123456';
    const body = '{"event":"status.changed"}';
    const ts = 1_700_000_000_000;
    const sig1 = signWebhookPayload(secret, ts, body);
    const sig2 = signWebhookPayload(secret, ts, body);
    assert.equal(sig1, sig2);
    assert.match(sig1, /^[a-f0-9]{64}$/);
  });

  it('isValidWebhookEndpointUrl accepts http and https', () => {
    assert.equal(isValidWebhookEndpointUrl('https://partner.example/jps/webhook'), true);
    assert.equal(isValidWebhookEndpointUrl('http://172.28.1.10/jps/webhook'), true);
    assert.equal(isValidWebhookEndpointUrl('ftp://x/y'), false);
  });

  it('generateWebhookSecret uses whsec_ prefix', () => {
    const s = generateWebhookSecret();
    assert.ok(s.startsWith('whsec_'));
    assert.ok(s.length > 20);
    assert.equal(webhookSecretPrefix(s), s.slice(0, 14));
  });
});
