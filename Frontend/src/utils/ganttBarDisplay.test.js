import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  materialDisplayFromRow,
  resolveGanttBarDensity,
  formatGanttMilestoneLine,
  formatMaterialQtyLine,
  formatHoseConveyorOnLine,
  buildPlannedBlockModel,
  buildActualBlockModel,
  buildGanttBarTooltipItems,
  buildGanttPlannedMilestoneEntries,
  buildGanttEstimateMilestoneEntries,
  buildGanttActualMilestoneEntries,
  buildGanttCombinedActualMilestoneEntries,
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

  it('does not repeat the material when the cargo already names it', () => {
    assert.equal(
      formatMaterialQtyLine('CRUDE PALM OIL', 'CRUDE PALM OIL 2.500 MT'),
      'CRUDE PALM OIL 2.500 MT'
    )
  })

  it('drops a multi-material label when all parts appear in the cargo', () => {
    assert.equal(
      formatMaterialQtyLine('CPO - FAME', 'CPO 4.000 MT FAME 500 MT'),
      'CPO 4.000 MT FAME 500 MT'
    )
  })
})

describe('formatHoseConveyorOnLine', () => {
  it('returns Hose on with compact timestamp', () => {
    const line = formatHoseConveyorOnLine('Hose', '2026-07-23T08:48:00Z')
    assert.ok(line)
    assert.match(line, /^Hose on \d+ \w+ \d{2}:\d{2}$/)
  })

  it('returns Conveyor on for conveyor method', () => {
    const line = formatHoseConveyorOnLine('Conveyor', '2026-07-23T08:48:00Z')
    assert.ok(line)
    assert.match(line, /^Conveyor on /)
  })

  it('returns null when start time is missing', () => {
    assert.equal(formatHoseConveyorOnLine('Hose', null), null)
    assert.equal(formatHoseConveyorOnLine('Hose', ''), null)
  })
})

describe('buildPlannedBlockModel', () => {
  it('includes ETB ETC on the bar and ETA on arrival, plus material qty', () => {
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
    assert.match(model.milestoneLine, /ETB/)
    assert.match(model.milestoneLine, /ETC/)
    assert.doesNotMatch(model.milestoneLine, /ETA/)
    assert.match(model.arrivalLine, /ETA/)
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
    assert.match(model.milestoneLine, /TC/)
  })

  it('falls back to row completion timestamps', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      { actualCompletionDateTime: '2026-06-10T12:00:00Z' }
    )
    assert.ok(model.actualCompMs != null)
  })

  it('builds material qty from merged plan row commodityDisplay, defaulting moved qty and rate to 0', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      { commodityDisplay: 'CPO', totalQtyDisplay: '5,000 MT' }
    )
    assert.equal(model.materialQtyLine, 'CPO · 0 MT / 5,000 MT -- Rate 0 MT / Hour')
  })

  it('shows actual moved-vs-total progress when cargoMovedQty is logged, with 0 rate when no logged window', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      { commodityDisplay: 'CPO', totalQtyDisplay: 'CPO 2,500 MT', cargoMovedQty: 500 }
    )
    assert.equal(model.cargoDisplay, '500 MT / 2,500 MT -- Rate 0 MT / Hour')
    assert.equal(model.materialQtyLine, 'CPO · 500 MT / 2,500 MT -- Rate 0 MT / Hour')
  })

  it('computes the hourly rate from the logged Cargo Operations window', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      {
        commodityDisplay: 'CPO',
        totalQtyDisplay: 'CPO 2,500 MT',
        cargoMovedQty: 500,
        cargoFirstLoggedAt: '2026-06-01T00:00:00Z',
        cargoLastLoggedAt: '2026-06-01T10:00:00Z',
      }
    )
    assert.equal(model.cargoDisplay, '500 MT / 2,500 MT -- Rate 50 MT / Hour')
    assert.equal(model.avgRateLine, 'Rate 50 MT / Hour')
  })

  it('formats wait days (TB − TA) on actual bars', () => {
    const ta = Date.parse('2026-06-01T00:00:00Z')
    const tb = Date.parse('2026-06-18T12:00:00Z')
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: ta, tbMs: tb, waitMs: tb - ta, cargoDisplay: '1 MT' },
      null
    )
    assert.equal(model.waitLine, '17.5 d')
  })

  it('formats sub-day waits as decimal days', () => {
    const ta = Date.parse('2026-06-01T00:00:00Z')
    const tb = Date.parse('2026-06-01T12:00:00Z')
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: ta, tbMs: tb, waitMs: tb - ta, cargoDisplay: '1 MT' },
      null
    )
    assert.equal(model.waitLine, '0.5 d')
  })

  it('prefers commodityShortDisplay over commodityDisplay for the material name, without duplicating the full name', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      {
        commodityShortDisplay: 'CPO',
        commodityDisplay: 'CRUDE PALM OIL',
        totalQtyDisplay: 'CRUDE PALM OIL 2,500 MT',
        cargoMovedQty: 500,
      }
    )
    assert.equal(model.materialDisplay, 'CPO')
    assert.equal(model.commodityTitle, 'CRUDE PALM OIL')
    assert.equal(model.materialQtyLine, 'CPO · 500 MT / 2,500 MT -- Rate 0 MT / Hour')
  })

  it('appends hose/conveyor on timestamp after rate on actual bars', () => {
    const model = buildActualBlockModel(
      { vesselName: 'V1', taMs: 10, tbMs: 20 },
      {
        commodityDisplay: 'CPO',
        totalQtyDisplay: '2,500 MT',
        cargoMovedQty: 600,
        cargoFirstLoggedAt: '2026-06-01T00:00:00Z',
        cargoLastLoggedAt: '2026-06-01T02:00:00Z',
        openingCargoHandlingMethodName: 'Hose',
        openingHatchStartAt: '2026-07-23T08:48:00Z',
      }
    )
    assert.match(model.materialQtyLine, /Rate 300 MT \/ Hour · Hose on/)
  })
})

describe('buildGanttMilestoneEntries', () => {
  it('orders planned in-bar entries as ETB ETC', () => {
    const entries = buildGanttPlannedMilestoneEntries({ etaMs: 1, etbMs: 2, etcMs: 3 })
    assert.deepEqual(
      entries.map((e) => e.label),
      ['ETB', 'ETC']
    )
  })

  it('includes ETC on estimate entries for actual bars', () => {
    const entries = buildGanttEstimateMilestoneEntries({ etaMs: 1, etbMs: 2, estCompMs: 3 })
    assert.deepEqual(
      entries.map((e) => e.label),
      ['ETB', 'ETC']
    )
    assert.equal(entries[1].ms, 3)
  })

  it('uses TC for actual completion entries', () => {
    const entries = buildGanttActualMilestoneEntries({ taMs: 10, tbMs: 20, actualCompMs: 30 })
    assert.deepEqual(
      entries.map((e) => e.label),
      ['TB', 'TC']
    )
  })

  it('combines estimate and actual entries for medium actual bars', () => {
    const entries = buildGanttCombinedActualMilestoneEntries({
      etaMs: 1,
      etbMs: 2,
      estCompMs: 3,
      taMs: 10,
      tbMs: 20,
      actualCompMs: 30,
    })
    assert.deepEqual(
      entries.map((e) => e.label),
      ['ETB', 'ETC', 'TB', 'TC']
    )
  })
})

describe('buildGanttBarTooltipItems', () => {
  it('includes milestones, cargo, and click hint for planned bars', () => {
    const model = buildPlannedBlockModel({
      vesselName: 'MV TEST',
      purposeLabel: 'Loading',
      etaMs: 1,
      plannedEtbMs: 2,
      estCompMs: 3,
      materialDisplay: 'CPO',
      cargoDisplay: '5,000 MT',
      status: 'Arriving',
    })
    const items = buildGanttBarTooltipItems(model, 'planned', { clickHint: 'Click me' })
    assert.ok(items.some((i) => i.primary === 'Planned milestones'))
    assert.ok(items.some((i) => i.primary === 'Cargo' && i.secondary?.includes('CPO')))
    assert.ok(items.some((i) => i.primary === 'Click me'))
  })

  it('includes estimate line, wait, and avg rate for actual bars', () => {
    const ta = Date.parse('2026-06-01T00:00:00Z')
    const tb = Date.parse('2026-06-01T04:00:00Z')
    const model = buildActualBlockModel(
      { vesselName: 'V1', etaMs: 1, plannedEtbMs: 2, taMs: ta, tbMs: tb, actualCompMs: 30 },
      null
    )
    const items = buildGanttBarTooltipItems(model, 'actual')
    assert.ok(items.some((i) => i.primary === 'Estimate'))
    assert.ok(items.some((i) => i.primary === 'Actual milestones'))
    assert.ok(items.some((i) => i.primary === 'Arrival'))
    assert.ok(items.some((i) => i.primary === 'Waiting days (Berth − Arrival)' && i.secondary === '0.2 d'))
    assert.ok(items.some((i) => i.primary === 'Avg flow rate'))
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
