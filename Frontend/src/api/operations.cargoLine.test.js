import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapCargoLoadLineForApi } from './operations.js'

const TZ = 'Asia/Jakarta'

describe('mapCargoLoadLineForApi', () => {
  it('sends per-tank manual override quantities and the note to the server', () => {
    const row = mapCargoLoadLineForApi(
      {
        startAt: '2026-08-23T19:00:00.000Z',
        endAt: '2026-08-24T02:15:00.000Z',
        qty: 500,
        tankIds: [37],
        atgQtyMode: 'auto',
        manualOverrides: [{ tankId: 37, qty: 500 }],
        manualOverrideNote: 'Counted by shore tank dip',
      },
      TZ
    )
    assert.deepEqual(row.manualOverrides, [{ tankId: 37, qty: 500 }])
    assert.equal(row.manualOverrideNote, 'Counted by shore tank dip')
  })

  it('leaves the override fields out when the line has none', () => {
    const row = mapCargoLoadLineForApi(
      { startAt: '2026-08-23T19:00:00.000Z', endAt: null, tankIds: [37], atgQtyMode: 'auto' },
      TZ
    )
    assert.equal('manualOverrides' in row, false)
    assert.equal('manualOverrideNote' in row, false)
  })
})
