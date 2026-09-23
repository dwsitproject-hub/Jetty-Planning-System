import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePortIdParam,
  parseVizTabParam,
  popoutModeToVizTab,
  withPortScopeParam,
  withAllocationReturnParams,
  stripPortScopeParam,
  stripVizTabParam,
  PORT_SCOPE_URL_PARAM,
  ALLOCATION_VIZ_TAB_PARAM,
} from './portScopeUrl.js'

describe('parsePortIdParam', () => {
  it('parses a positive port id', () => {
    assert.equal(parsePortIdParam('?portId=1'), 1)
    assert.equal(parsePortIdParam(new URLSearchParams('portId=42')), 42)
  })

  it('returns null for missing or invalid values', () => {
    assert.equal(parsePortIdParam(''), null)
    assert.equal(parsePortIdParam('?portId=abc'), null)
    assert.equal(parsePortIdParam('?portId=0'), null)
    assert.equal(parsePortIdParam('?portId=-3'), null)
  })
})

describe('withPortScopeParam', () => {
  it('appends portId query param', () => {
    assert.equal(withPortScopeParam('/allocation-plans', 1), '/allocation-plans?portId=1')
  })

  it('returns path unchanged when portId is invalid', () => {
    assert.equal(withPortScopeParam('/allocation-plans', null), '/allocation-plans')
  })
})

describe('stripPortScopeParam', () => {
  it('removes portId and keeps other params', () => {
    assert.equal(stripPortScopeParam('?portId=1&embed=1'), '?embed=1')
    assert.equal(stripPortScopeParam('?portId=1'), '')
  })

  it('uses PORT_SCOPE_URL_PARAM constant', () => {
    assert.equal(PORT_SCOPE_URL_PARAM, 'portId')
  })
})

describe('parseVizTabParam', () => {
  it('parses valid visualization tabs', () => {
    assert.equal(parseVizTabParam('?vizTab=schematic'), 'schematic')
    assert.equal(parseVizTabParam('?vizTab=jettySchedule'), 'jettySchedule')
  })

  it('returns null for invalid values', () => {
    assert.equal(parseVizTabParam('?vizTab=schedule'), null)
    assert.equal(parseVizTabParam(''), null)
  })
})

describe('popoutModeToVizTab', () => {
  it('maps popout modes to allocation tabs', () => {
    assert.equal(popoutModeToVizTab('schematic'), 'schematic')
    assert.equal(popoutModeToVizTab('schedule'), 'jettySchedule')
    assert.equal(popoutModeToVizTab('other'), null)
  })
})

describe('withAllocationReturnParams', () => {
  it('includes port and visualization tab', () => {
    assert.equal(
      withAllocationReturnParams('/allocation-plans', { portId: 1, vizTab: 'jettySchedule' }),
      '/allocation-plans?portId=1&vizTab=jettySchedule'
    )
  })
})

describe('stripVizTabParam', () => {
  it('removes vizTab and keeps other params', () => {
    assert.equal(stripVizTabParam('?portId=1&vizTab=schematic'), '?portId=1')
    assert.equal(stripVizTabParam('?vizTab=jettySchedule'), '')
  })

  it('uses ALLOCATION_VIZ_TAB_PARAM constant', () => {
    assert.equal(ALLOCATION_VIZ_TAB_PARAM, 'vizTab')
  })
})
