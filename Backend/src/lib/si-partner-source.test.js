import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SI_PARTNER_SOURCE_JOIN, mapSiPartnerFields } from './si-partner-source.js';

describe('si-partner-source', () => {
  it('maps the partner name and document URLs for a partner SI', () => {
    const out = mapSiPartnerFields({
      partner_name: 'Acme',
      partner_si_document_url: 'https://host.example/si.pdf',
      partner_contract_document_url: null,
      partner_bl_document_url: 'https://host.example/bl.pdf',
    });
    assert.deepEqual(out, {
      partnerName: 'Acme',
      partnerSiDocumentUrl: 'https://host.example/si.pdf',
      partnerContractDocumentUrl: null,
      partnerBlDocumentUrl: 'https://host.example/bl.pdf',
    });
  });

  it('returns null partner name and no URLs for an internal SI', () => {
    const out = mapSiPartnerFields({ id: 7 });
    assert.deepEqual(out, {
      partnerName: null,
      partnerSiDocumentUrl: null,
      partnerContractDocumentUrl: null,
      partnerBlDocumentUrl: null,
    });
  });

  it('joins one submission per SI so the join cannot duplicate rows', () => {
    assert.match(SI_PARTNER_SOURCE_JOIN, /LEFT JOIN LATERAL/);
    assert.match(SI_PARTNER_SOURCE_JOIN, /ORDER BY isub\.id DESC\s+LIMIT 1/);
    assert.match(SI_PARTNER_SOURCE_JOIN, /isub\.shipping_instruction_id = si\.id/);
  });
});
