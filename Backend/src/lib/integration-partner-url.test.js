import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parsePartnerDocumentUrl } from './integration-partner-url.js';

describe('integration-partner-url', () => {
  afterEach(() => {
    delete process.env.INTEGRATION_WEBHOOK_ALLOW_HTTP;
  });

  it('accepts https URLs', () => {
    const r = parsePartnerDocumentUrl('https://partner.example/si.pdf');
    assert.equal(r.ok, true);
    assert.equal(r.value, 'https://partner.example/si.pdf');
  });

  it('rejects http unless allow flag set', () => {
    assert.equal(parsePartnerDocumentUrl('http://local/doc').ok, false);
    process.env.INTEGRATION_WEBHOOK_ALLOW_HTTP = 'true';
    const r = parsePartnerDocumentUrl('http://local/doc');
    assert.equal(r.ok, true);
  });

  it('empty becomes null', () => {
    assert.deepEqual(parsePartnerDocumentUrl(''), { ok: true, value: null });
  });
});
