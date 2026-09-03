import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCargoSegmentHourlyRequests,
  cargoSegmentHourlySignature,
  mapCargoSegmentHourlyResponse,
} from './cargoSegmentHourlyHelpers.js'

describe('cargoSegmentHourlyHelpers', () => {
  const tankMeta = new Map([
    ['5102', { hasAtg: true }],
    ['3002', { hasAtg: true }],
    ['99', { hasAtg: false }],
  ])

  const normalize = (local) => {
    if (local === '2026-09-03T00:01') return '2026-09-02T17:01:00.000Z'
    if (local === '2026-09-03T05:00') return '2026-09-02T22:00:00.000Z'
    if (local === '2026-09-03T05:01') return '2026-09-02T22:01:00.000Z'
    if (local === '2026-09-03T07:00') return '2026-09-03T00:00:00.000Z'
    throw new Error('bad')
  }

  it('buildCargoSegmentHourlyRequests scopes each entry to its window and ATG tanks', () => {
    const segments = buildCargoSegmentHourlyRequests(
      [
        {
          key: '101',
          start: '2026-09-03T00:01',
          end: '2026-09-03T05:00',
          tankIds: ['5102', '99'],
          atgQtyMode: 'auto',
        },
        {
          key: '102',
          start: '2026-09-03T05:01',
          end: '2026-09-03T07:00',
          tankIds: ['3002'],
          atgQtyMode: 'auto',
        },
        {
          key: 'draft-new',
          start: '2026-09-03T05:01',
          end: '',
          tankIds: ['3002'],
          atgQtyMode: 'auto',
        },
      ],
      tankMeta,
      normalize
    )
    assert.equal(segments.length, 3)
    assert.equal(segments[0].clientKey, '101')
    assert.equal(segments[0].loadLineId, '101')
    assert.equal(segments[0].tankIds.join(','), '5102')
    assert.equal(segments[0].endAt, '2026-09-02T22:00:00.000Z')
    assert.equal(segments[1].tankIds.join(','), '3002')
    assert.equal(segments[2].loadLineId, undefined)
    assert.equal(segments[2].endAt, null)
  })

  it('skips manual mode and rows without start or ATG tanks', () => {
    const segments = buildCargoSegmentHourlyRequests(
      [
        { key: 'a', start: '', end: '', tankIds: ['5102'], atgQtyMode: 'auto' },
        { key: 'b', start: '2026-09-03T00:01', end: '', tankIds: ['99'], atgQtyMode: 'auto' },
        { key: 'c', start: '2026-09-03T00:01', end: '', tankIds: ['5102'], atgQtyMode: 'manual' },
      ],
      tankMeta,
      normalize
    )
    assert.equal(segments.length, 0)
  })

  it('mapCargoSegmentHourlyResponse indexes by clientKey', () => {
    const map = mapCargoSegmentHourlyResponse({
      segments: [
        {
          clientKey: '101',
          hourlyBuckets: [{ hourStart: 'a' }],
          movedQty: 10,
          rateSummary: { currentHourLine: 'x' },
        },
      ],
    })
    assert.equal(map.get('101')?.movedQty, 10)
    assert.equal(map.get('101')?.hourlyBuckets.length, 1)
  })

  it('cargoSegmentHourlySignature changes when segment windows differ', () => {
    const a = cargoSegmentHourlySignature([
      { clientKey: '1', startAt: 's1', endAt: 'e1', tankIds: ['5102'], atgQtyMode: 'auto' },
    ])
    const b = cargoSegmentHourlySignature([
      { clientKey: '1', startAt: 's1', endAt: 'e2', tankIds: ['5102'], atgQtyMode: 'auto' },
    ])
    assert.notEqual(a, b)
  })
})
