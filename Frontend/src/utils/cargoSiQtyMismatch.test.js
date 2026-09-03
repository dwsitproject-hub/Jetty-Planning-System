import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectCargoLoadLines,
  collectCargoLoadLinesWithPending,
  detectCargoSiQtyMismatch,
  formatCargoSiQtyMismatchConfirm,
} from './cargoSiQtyMismatch.js'

const t = (key, params) => `${key}:${JSON.stringify(params)}`

describe('detectCargoSiQtyMismatch', () => {
  it('returns null when total matches SI', () => {
    const lines = [
      { qty: 1000, endAt: '2026-08-25T10:00:00Z' },
      { qty: 3000, endAt: '2026-08-26T10:00:00Z' },
    ]
    assert.equal(detectCargoSiQtyMismatch({ siQty: 4000, lines }), null)
  })

  it('detects over SI', () => {
    const lines = [
      { qty: 2000, endAt: '2026-08-25T10:00:00Z' },
      { qty: 2100, endAt: '2026-08-26T10:00:00Z' },
    ]
    const m = detectCargoSiQtyMismatch({ siQty: 4000, lines })
    assert.equal(m?.kind, 'over')
    assert.equal(m?.delta, 100)
    assert.equal(m?.total, 4100)
  })

  it('detects under SI when all segments closed', () => {
    const lines = [
      { qty: 1500, endAt: '2026-08-25T10:00:00Z' },
      { qty: 2000, endAt: '2026-08-26T10:00:00Z' },
    ]
    const m = detectCargoSiQtyMismatch({ siQty: 4000, lines })
    assert.equal(m?.kind, 'under')
    assert.equal(m?.delta, 500)
    assert.equal(m?.total, 3500)
  })

  it('does not warn under SI when a segment is open', () => {
    const lines = [
      { qty: 1500, endAt: '2026-08-25T10:00:00Z' },
      { qty: 500, endAt: null },
    ]
    assert.equal(detectCargoSiQtyMismatch({ siQty: 4000, lines }), null)
  })
})

describe('collectCargoLoadLines', () => {
  it('excludes editing entry and includes draft lines', () => {
    const activities = [
      {
        id: '1',
        cargoLoadLines: [{ qty: 1000, endAt: '2026-08-25T10:00:00Z' }],
      },
      {
        id: '2',
        cargoLoadLines: [{ qty: 500, endAt: '2026-08-26T10:00:00Z' }],
      },
    ]
    const draftLines = [{ qty: 763.69, end: '2026-08-26T11:40:00Z' }]
    const lines = collectCargoLoadLines(activities, { excludeEntryId: '2', draftLines })
    assert.equal(lines.length, 2)
    assert.equal(lines[0].qty, 1000)
    assert.equal(lines[1].qty, 763.69)
  })
})

describe('collectCargoLoadLinesWithPending', () => {
  it('substitutes pending lines for the target entry', () => {
    const activities = [
      {
        id: '10',
        category: 'CARGO OPERATIONS',
        cargoLoadLines: [{ qty: 100, endAt: '2026-08-25T08:00:00Z', startAt: '2026-08-25T06:00:00Z' }],
      },
    ]
    const pendingLines = [
      { qty: 100, endAt: '2026-08-25T08:00:00Z' },
      { qty: 3900, endAt: '2026-08-26T10:00:00Z' },
    ]
    const lines = collectCargoLoadLinesWithPending(activities, {
      pendingEntryId: '10',
      pendingLines,
    })
    assert.equal(lines.length, 2)
    assert.equal(lines.reduce((s, l) => s + Number(l.qty), 0), 4000)
  })
})

describe('formatCargoSiQtyMismatchConfirm', () => {
  it('formats over confirm', () => {
    const msg = formatCargoSiQtyMismatchConfirm(
      { kind: 'over', siQty: 4000, total: 4080, delta: 80 },
      t
    )
    assert.match(msg, /cargoOpsQtyOverSiConfirm/)
  })
})
