import assert from 'node:assert/strict'
import test from 'node:test'
import { viewModelFromOperationalEntries } from './operationalMilestones.js'

test('viewModelFromOperationalEntries preserves cargo line commodityId from API', () => {
  const { activities } = viewModelFromOperationalEntries(
    [
      {
        id: '900',
        entryType: 'activity',
        milestoneKey: 'cargo_operations',
        remark: 'load',
        startAt: '2026-09-24T07:55:00.000Z',
        endAt: '2026-09-27T12:50:00.000Z',
        cargoLoadLines: [
          {
            id: '1118',
            lineOrder: 1,
            qty: 2226.668,
            commodityId: '11',
            commodityShortDisplay: 'RG',
            startAt: '2026-09-24T07:05:00.000Z',
            endAt: '2026-09-24T15:56:00.000Z',
            tankIds: ['7'],
          },
          {
            id: '1120',
            line_order: 3,
            qty: 1952.901,
            commodity_id: 14,
            start_at: '2026-09-25T17:00:00.000Z',
            end_at: '2026-09-26T04:15:00.000Z',
            tank_ids: ['79'],
          },
        ],
      },
    ],
    'Loading'
  )
  assert.equal(activities.length, 1)
  const lines = activities[0].cargoLoadLines
  assert.equal(lines.length, 2)
  assert.equal(lines[0].commodityId, '11')
  assert.equal(lines[0].commodityShortDisplay, 'RG')
  assert.equal(lines[1].commodityId, '14')
})

test('viewModelFromOperationalEntries leaves commodityId null when API omits it', () => {
  const { activities } = viewModelFromOperationalEntries(
    [
      {
        id: '901',
        entryType: 'activity',
        milestoneKey: 'cargo_operations',
        cargoLoadLines: [{ id: '1', qty: 100, startAt: null, endAt: null }],
      },
    ],
    'Loading'
  )
  assert.equal(activities[0].cargoLoadLines[0].commodityId, null)
})
