import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isEmbedMode, isPipelineEmbedPath, withEmbedParam } from './embedMode.js'

describe('embedMode', () => {
  it('detects embed query flag', () => {
    assert.equal(isEmbedMode('?embed=1'), true)
    assert.equal(isEmbedMode('?foo=1&embed=1'), true)
    assert.equal(isEmbedMode(''), false)
  })

  it('appends embed param when active', () => {
    assert.equal(withEmbedParam('/loading/op-1/pre-checking', '?embed=1'), '/loading/op-1/pre-checking?embed=1')
    assert.equal(withEmbedParam('/loading/op-1/pre-checking', ''), '/loading/op-1/pre-checking')
  })

  it('recognizes pipeline embed paths', () => {
    assert.equal(isPipelineEmbedPath('/loading/op-12/pre-checking'), true)
    assert.equal(isPipelineEmbedPath('/verification'), true)
    assert.equal(isPipelineEmbedPath('/allocation-plans'), false)
  })
})
