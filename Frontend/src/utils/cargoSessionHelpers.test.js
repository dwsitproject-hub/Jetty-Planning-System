import { describe, expect, it } from 'vitest'
import {
  deriveCargoSessionPhase,
  getSessionTankIdsFromDraft,
  partitionDraftTanks,
  pickSegmentStartLocal,
} from './cargoSessionHelpers.js'

describe('cargoSessionHelpers', () => {
  it('deriveCargoSessionPhase detects setup, in_progress, segment_done', () => {
    expect(deriveCargoSessionPhase([])).toBe('setup')
    expect(deriveCargoSessionPhase([{ start: '2026-01-01T10:00', end: '' }])).toBe('in_progress')
    expect(
      deriveCargoSessionPhase([{ start: '2026-01-01T10:00', end: '2026-01-01T12:00' }])
    ).toBe('segment_done')
  })

  it('getSessionTankIdsFromDraft prefers open line tanks', () => {
    const lines = [
      { start: 'a', end: 'b', tankIds: ['1'] },
      { start: 'c', end: '', tankIds: ['2', '3'] },
    ]
    expect(getSessionTankIdsFromDraft(lines)).toEqual(['2', '3'])
  })

  it('partitionDraftTanks splits ATG vs manual', () => {
    const meta = new Map([
      ['1', { hasAtg: true }],
      ['2', { hasAtg: false }],
    ])
    expect(partitionDraftTanks(['1', '2'], meta)).toEqual({
      atgTankIds: ['1'],
      manualTankIds: ['2'],
    })
  })

  it('pickSegmentStartLocal uses later of window and now', () => {
    const tz = 'Asia/Jakarta'
    const window = '2026-08-26T08:00'
    const now = '2026-08-26T14:00'
    expect(pickSegmentStartLocal(window, now, tz)).toBe(now)
    expect(pickSegmentStartLocal(window, '2026-08-26T07:00', tz)).toBe(window)
  })
})
