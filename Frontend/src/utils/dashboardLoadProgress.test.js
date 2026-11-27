import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LOAD_STAGES, loadLabel, loadPercent } from './dashboardLoadProgress.js'

describe('loadPercent', () => {
  it('weights add up to 100', () => {
    assert.equal(LOAD_STAGES.reduce((s, x) => s + x.weight, 0), 100)
  })

  it('starts at 0 and passes through each step in order', () => {
    assert.equal(loadPercent('ops', 0, 0), 0)
    assert.equal(loadPercent('rates', 0, 4), 10)
    assert.equal(loadPercent('rates', 2, 4), 23)
    assert.equal(loadPercent('acts', 0, 60), 35)
    assert.equal(loadPercent('timelines', 0, 100), 60)
    assert.equal(loadPercent('timelines', 100, 100), 100)
  })

  it('never goes past a step, or backwards, on odd counts', () => {
    assert.equal(loadPercent('acts', 90, 60), 60)
    assert.equal(loadPercent('acts', -3, 60), 35)
    assert.equal(loadPercent('nope', 1, 1), 0)
  })

  it('has a label for each step', () => {
    assert.equal(loadLabel('timelines'), 'Loading activity timelines')
    assert.equal(loadLabel('x'), 'Loading')
  })
})
