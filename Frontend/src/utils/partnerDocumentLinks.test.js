import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { partnerDocumentLinks } from './partnerDocumentLinks.js'

describe('partnerDocumentLinks', () => {
  it('returns nothing for an internal SI', () => {
    assert.deepEqual(partnerDocumentLinks({ partnerSiDocumentUrl: null }), [])
    assert.deepEqual(partnerDocumentLinks(null), [])
  })

  it('keeps fixed order and skips missing documents', () => {
    const links = partnerDocumentLinks({
      partnerBlDocumentUrl: 'https://host.example/bl.pdf',
      partnerSiDocumentUrl: 'http://host.example/si.pdf',
    })
    assert.deepEqual(links.map((l) => l.key), ['si', 'bl'])
    assert.equal(links[0].host, 'host.example')
    assert.equal(links[0].display, 'host.example/si.pdf')
  })

  it('ignores non-http(s) and invalid values', () => {
    const links = partnerDocumentLinks({
      partnerSiDocumentUrl: 'javascript:alert(1)',
      partnerContractDocumentUrl: 'not a url',
      partnerBlDocumentUrl: '   ',
    })
    assert.deepEqual(links, [])
  })

  it('shortens long URLs with an ellipsis but keeps the full href', () => {
    const long = `https://host.example/${'a'.repeat(120)}.pdf`
    const [link] = partnerDocumentLinks({ partnerContractDocumentUrl: long })
    assert.equal(link.url, long)
    assert.ok(link.display.endsWith('…'))
    assert.ok(link.display.length <= 48)
  })
})
