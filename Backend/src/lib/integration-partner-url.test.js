import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePartnerDocumentUrl } from './integration-partner-url.js';

describe('integration-partner-url', () => {
  it('accepts https URLs', () => {
    const r = parsePartnerDocumentUrl('https://partner.example/si.pdf');
    assert.equal(r.ok, true);
    assert.equal(r.value, 'https://partner.example/si.pdf');
  });

  it('accepts http URLs', () => {
    const r = parsePartnerDocumentUrl('http://172.28.1.10/docs/si.pdf');
    assert.equal(r.ok, true);
    assert.equal(r.value, 'http://172.28.1.10/docs/si.pdf');
  });

  it('rejects non-http(s) schemes', () => {
    assert.equal(parsePartnerDocumentUrl('ftp://files/doc.pdf').ok, false);
  });

  it('empty becomes null', () => {
    assert.deepEqual(parsePartnerDocumentUrl(''), { ok: true, value: null });
  });
});
