import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  materialDisplayFromRow,
  resolveGanttBarDensity,
  formatGanttMilestoneLine,
  formatMaterialQtyLine,
  buildPlannedBlockModel,
  buildActualBlockModel,
  parseRowActualCompMs,
} from './ganttBarDisplay.js'

describe('materialDisplayFromRow', () => {
  it('joins unique shippingTable materials', () => {
    assert.equal(
      materialDisplayFromRow({
        shippingTable: [{ material: 'CPO' }, { material: 'FAME' }, { material: 'CPO' }],
      }),
      'CPO - FAME'
    )
  })

  it('falls back to commodity', () => {
    assert.equal(materialDisplayFromRow({ commodity: 'POME' }), 'POME')
  })

  it('falls back to commodityDisplay from merged plan rows', () => {
    assert.equal(
      materialDisplayFromRow({ commodityDisplay: 'CPO', totalQtyDisplay: '5,000 MT' }),
      'CPO'
    )
  })
})

describe('resolveGanttBarDensity', () => {
  it('returns narrow, medium, full by width pct', () => {
    assert.equal(resolveGanttBarDensity(10), 'narrow')
    assert.equal(resolveGanttBarDensity(20), 'medium')
    assert.equal(resolveGanttBarDensity(40), 'full')
  })
})

describe('formatGanttMilestoneLine', () => {
  it('joins labeled milestones with em dash separator', () => {
    const line = formatGanttMilestoneLine([
      { label: 'ETA', ms: new Date('2026-06-01T08:00:00Z').getTime() },
      { label: 'ETB', ms: null },
    ])
    assert.match(line, /^ETA .+ · ETB —$/)
  })
})

describe('formatMaterialQtyLine', () => {
  it('combines material and cargo', () => {
    assert.equal(formatMaterialQtyLine('CPO', '5,000 MT'), 'CPO · 5,000 MT')
  })

  it('returns null when both empty', () => {
    assert.equal(formatMaterialQtyLine(null, null), null)
  })

  it('filters em-dash placeholders', () => {
    assert.equal(formatMaterialQtyLine('—', '5,000 MT'), '5,000 MT')
    assert.equal(formatMaterialQtyLine('CPO', '—'), 'CPO')
    assert.equal(formatMaterialQtyLine('—', '—'), null)
  })
})

describe('buildPlannedBlockModel', () => {
  it('includes ETA ETB ETC and material qty', () => {
    const model = buildPlannedBlockModel({
      vesselName: 'MV TEST',
      purposeLabel: 'Loading',
      etaMs: 1,
      plannedEtbMs: 2,
      estCompMs: 3,
      materialDisplay: 'CPO',
      cargoDisplay: '5,000 MT',
    })
    assert.equal(model.vesselName, 'MV TEST')
    assert.match(model.milestoneLine, /ETA/)
    assert.match(model.milestoneLine, /ETB/)
    assert.match(model.milestoneLine, /ETC/)
    assert.equal(model.materialQtyLine, 'CPO · 5,000 MT')
  })
})

describe('buildActualBlockModel', () => {
  it('uses segment actualCompMs when present', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20, actualCompMs: 30, cargoDisplay: '1 MT' },
      null
    )
    assert.equal(model.actualCompMs, 30)
    assert.match(model.milestoneLine, /Done/)
  })

  it('falls back to row completion timestamps', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      { actualCompletionDateTime: '2026-06-10T12:00:00Z' }
    )
    assert.ok(model.actualCompMs != null)
  })

  it('builds material qty from merged plan row commodityDisplay', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      { commodityDisplay: 'CPO', totalQtyDisplay: '5,000 MT' }
    )
    assert.equal(model.materialQtyLine, 'CPO · 5,000 MT')
  })
})

describe('parseRowActualCompMs', () => {
  it('prefers actualCompletion over castOff', () => {
    const ms = parseRowActualCompMs({
      actualCompletionDateTime: '2026-06-10T12:00:00Z',
      castOffDateTime: '2026-06-11T12:00:00Z',
    })
    assert.equal(new Date(ms).toISOString(), '2026-06-10T12:00:00.000Z')
  })
})
