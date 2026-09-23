import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatCargoLineTanksLabel } from './cargoProgressResolvers.js'

describe('formatCargoLineTanksLabel', () => {
  it('returns tank code from line tanks', () => {
    assert.equal(
      formatCargoLineTanksLabel({ tanks: [{ code: '3502' }] }),
      '3502'
    )
  })

  it('joins multiple tanks with comma', () => {
    assert.equal(
      formatCargoLineTanksLabel({
        tanks: [{ code: '3502' }, { code: '3503' }],
      }),
      '3502, 3503'
    )
  })

  it('falls back to activity-level tanks when line has none', () => {
    assert.equal(
      formatCargoLineTanksLabel({}, [{ code: '5102', name: 'TK 5102' }]),
      '5102'
    )
  })

  it('uses name when code is missing', () => {
    assert.equal(
      formatCargoLineTanksLabel({ tanks: [{ name: 'TK 3502' }] }),
      'TK 3502'
    )
  })

  it('returns em dash when no tanks available', () => {
    assert.equal(formatCargoLineTanksLabel({}, []), '—')
    assert.equal(formatCargoLineTanksLabel(null, null), '—')
  })
})
