import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGanttLayerMode, resolveGanttLayerVisibility } from './ganttLayerMode.js'

describe('ganttLayerMode', () => {
  it('normalizeGanttLayerMode defaults invalid values to both', () => {
    assert.equal(normalizeGanttLayerMode('planned'), 'planned')
    assert.equal(normalizeGanttLayerMode('invalid'), 'both')
    assert.equal(normalizeGanttLayerMode(null), 'both')
  })

  it('resolveGanttLayerVisibility for each mode', () => {
    assert.deepEqual(resolveGanttLayerVisibility('both'), {
      layerMode: 'both',
      showPlanned: true,
      showActual: true,
      showDualLanes: true,
    })
    assert.deepEqual(resolveGanttLayerVisibility('planned'), {
      layerMode: 'planned',
      showPlanned: true,
      showActual: false,
      showDualLanes: false,
    })
    assert.deepEqual(resolveGanttLayerVisibility('actual'), {
      layerMode: 'actual',
      showPlanned: false,
      showActual: true,
      showDualLanes: false,
    })
  })
})
