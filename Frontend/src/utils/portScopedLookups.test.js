import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterJettiesForPort, jettySelectLabel } from './portScopedLookups.js'

const jetties = [
  { id: 1, name: 'Jetty 1A', portId: 10, portName: 'Dumai', label: 'Jetty 1A' },
  { id: 2, name: 'Jetty 2', portId: 10, portName: 'Dumai', label: 'Jetty 2' },
  { id: 3, name: 'Jetty 9', portId: 20, portName: 'Belawan', label: 'Jetty 9' },
]

describe('filterJettiesForPort', () => {
  it('returns only jetties for the selected port', () => {
    const list = filterJettiesForPort(jetties, 10)
    assert.deepEqual(list.map((j) => j.id), [1, 2])
  })

  it('returns empty when port is missing', () => {
    assert.deepEqual(filterJettiesForPort(jetties, null), [])
    assert.deepEqual(filterJettiesForPort(jetties, ''), [])
  })

  it('keeps a selected jetty from another port', () => {
    const list = filterJettiesForPort(jetties, 10, 3)
    assert.equal(list.length, 3)
    const extra = list.find((j) => Number(j.id) === 3)
    assert.equal(extra.otherPort, true)
    assert.equal(jettySelectLabel(extra), 'Jetty 9 (Belawan)')
  })

  it('synthesizes an other-port option when the selected id is not in the list', () => {
    const list = filterJettiesForPort(jetties, 10, 99, 'Legacy jetty')
    const extra = list.find((j) => String(j.id) === '99')
    assert.equal(extra.otherPort, true)
    assert.equal(jettySelectLabel(extra), 'Legacy jetty (other port)')
  })

  it('does not duplicate a selected jetty that already belongs to the port', () => {
    const list = filterJettiesForPort(jetties, 10, 1)
    assert.equal(list.filter((j) => Number(j.id) === 1).length, 1)
    assert.equal(list.find((j) => Number(j.id) === 1).otherPort, undefined)
  })
})
