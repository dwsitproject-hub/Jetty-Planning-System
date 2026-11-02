import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cargoDoneAtFromTimeline,
  cargoDoneToSailDisplayHours,
  cargoDoneToSailFromTimeline,
  cargoDoneToSailHours,
  idleHoursAtBerth,
} from './managementDashboardCargoDone.js'

describe('cargoDoneAtFromTimeline', () => {
  it('uses max endAt across cargo ops and post-checking', () => {
    const events = [
      {
        milestoneKey: 'cargo_operations',
        source: 'operational_activity',
        startAt: '2026-06-01T08:00:00Z',
        endAt: '2026-06-01T20:00:00Z',
      },
      {
        subProcessKey: 'final_sounding',
        startAt: '2026-06-01T21:00:00Z',
        endAt: '2026-06-01T22:00:00Z',
      },
      {
        subProcessKey: 'key_meeting',
        endAt: '2026-06-01T06:00:00Z',
      },
    ]
    assert.equal(cargoDoneAtFromTimeline(events), '2026-06-01T22:00:00.000Z')
  })

  it('falls back to startAt when endAt missing', () => {
    const events = [
      {
        milestoneKey: 'cargo_operations',
        source: 'operational_activity',
        startAt: '2026-06-01T10:00:00Z',
      },
    ]
    assert.equal(cargoDoneAtFromTimeline(events), '2026-06-01T10:00:00.000Z')
  })

  it('returns null when no matching events', () => {
    assert.equal(cargoDoneAtFromTimeline([]), null)
    assert.equal(
      cargoDoneAtFromTimeline([{ subProcessKey: 'key_meeting', endAt: '2026-06-01T08:00:00Z' }]),
      null
    )
  })
})

describe('cargoDoneToSailHours', () => {
  it('returns hours when castOff is after cargo done', () => {
    const h = cargoDoneToSailHours({
      cargoDoneAt: '2026-06-01T22:00:00Z',
      castOff: '2026-06-02T04:00:00Z',
    })
    assert.equal(h, 6)
  })

  it('returns null when castOff is not after cargo done', () => {
    assert.equal(
      cargoDoneToSailHours({
        cargoDoneAt: '2026-06-02T04:00:00Z',
        castOff: '2026-06-01T22:00:00Z',
      }),
      null
    )
    assert.equal(
      cargoDoneToSailHours({
        cargoDoneAt: '2026-06-01T22:00:00Z',
        castOff: '2026-06-01T22:00:00Z',
      }),
      null
    )
  })
})

describe('cargoDoneToSailDisplayHours', () => {
  it('returns cargo-done-to-sail hours and ignores post-checking duration', () => {
    assert.equal(cargoDoneToSailDisplayHours({ cargoDoneToSailH: 22.6, post: 4.5 }), 22.6)
    assert.equal(cargoDoneToSailDisplayHours({ cargoDoneToSailH: null, post: 4.5 }), null)
    assert.equal(cargoDoneToSailDisplayHours({ post: 4.5 }), null)
  })
})

describe('idleHoursAtBerth', () => {
  it('shrinks idle by cargo-done-to-sail, not by post', () => {
    assert.equal(
      idleHoursAtBerth({ berth: 100, pre: 10, opsH: 40, cargoDoneToSailH: 22, post: 4 }),
      28
    )
  })

  it('treats missing phases as 0 and floors at 0', () => {
    assert.equal(idleHoursAtBerth({ berth: 10, pre: null, opsH: null, cargoDoneToSailH: null }), 10)
    assert.equal(idleHoursAtBerth({ berth: 10, pre: 8, opsH: 8, cargoDoneToSailH: 8 }), 0)
    assert.equal(idleHoursAtBerth({ berth: null, cargoDoneToSailH: 5 }), null)
  })
})

describe('cargoDoneToSailFromTimeline', () => {
  it('combines timeline max and castOff', () => {
    const events = [
      {
        milestoneKey: 'cargo_operations',
        source: 'operational_activity',
        endAt: '2026-06-01T20:00:00Z',
      },
    ]
    assert.equal(cargoDoneToSailFromTimeline(events, '2026-06-01T23:00:00Z'), 3)
    assert.equal(cargoDoneToSailFromTimeline(events, null), null)
  })
})
