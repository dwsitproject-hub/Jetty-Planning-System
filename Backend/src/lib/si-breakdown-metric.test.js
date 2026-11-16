import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateIntegrationCargoMetricRules } from './si-breakdown-metric.js';

describe('validateIntegrationCargoMetricRules', () => {
  const normalize = (s) => String(s || '').trim().toUpperCase();

  it('allows any unit when commodity has no default', () => {
    const map = new Map([['FAME', { id: 4, default_metric_id: null, default_metric_code: null }]]);
    assert.equal(
      validateIntegrationCargoMetricRules([{ cargoType: 'FAME', unit: 'MT' }], map, normalize),
      null
    );
  });

  it('blocks wrong unit when default is configured', () => {
    const map = new Map([
      ['FAME', { id: 4, default_metric_id: 1, default_metric_code: 'KL' }],
    ]);
    const issues = validateIntegrationCargoMetricRules(
      [{ cargoType: 'FAME', unit: 'MT' }],
      map,
      normalize
    );
    assert.ok(issues);
    assert.equal(issues[0].expected_unit, 'KL');
  });

  it('uses the commodity attached to the line when the short name is empty', () => {
    const issues = validateIntegrationCargoMetricRules(
      [{ cargoType: null, cargoHubCode: 'CMD-0099', unit: 'MT', commodity: { id: 11, default_metric_id: 2, default_metric_code: 'KL' } }],
      new Map(),
      normalize
    );
    assert.equal(issues[0].expected_unit, 'KL');
    assert.match(issues[0].issue, /CMD-0099/);
  });

  it('passes when unit matches default', () => {
    const map = new Map([
      ['FAME', { id: 4, default_metric_id: 1, default_metric_code: 'KL' }],
    ]);
    assert.equal(
      validateIntegrationCargoMetricRules([{ cargoType: 'FAME', unit: 'KL' }], map, normalize),
      null
    );
  });
});
