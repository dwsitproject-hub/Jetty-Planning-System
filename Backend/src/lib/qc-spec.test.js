import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardMetricFields,
  fallbackSpec,
  parseCardMetrics,
  sampleCodes,
  typedColumnsFromMetrics,
} from './qc-spec.js';

describe('fallbackSpec', () => {
  it('keeps the four current QC fields', () => {
    assert.deepEqual(
      fallbackSpec().parameters.map((p) => p.code),
      ['ffa', 'moisture', 'dobi', 'iodine']
    );
    assert.deepEqual(sampleCodes(fallbackSpec()), ['ffa', 'moisture']);
  });
});

describe('parseCardMetrics', () => {
  it('reads the legacy body keys', () => {
    const out = parseCardMetrics({ ffaAverage: '4,91', moistureAverage: '0.25', dobi: '', iodineValue: '52' });
    assert.equal(out.metricsJson.ffa, '4.91');
    assert.equal(out.typed.moisture_average, 0.25);
    assert.equal(out.typed.dobi, null);
    assert.equal(out.typed.iodine_value, 52);
  });

  it('rejects a code that is not on the template', () => {
    assert.throws(() => parseCardMetrics({ metrics: { dirt: '1' } }), { statusCode: 400 });
  });

  it('accepts extra codes when the spec lists them', () => {
    const spec = { parameters: [{ code: 'dirt', labelEn: 'Dirt', kind: 'number', maxValue: 100, scope: 'both' }] };
    const out = parseCardMetrics({ metrics: { dirt: '1,4' } }, spec);
    assert.equal(out.metricsJson.dirt, '1.40');
    assert.equal(out.typed.ffa_average, null);
  });
});

describe('cardMetricFields', () => {
  it('fills the four aliases from metrics_json', () => {
    const out = cardMetricFields({ ffa: '4.1', mi: '0.2', dobi: '2.5' });
    assert.equal(out.ffaAverage, '4.10');
    assert.equal(out.moistureAverage, '0.20');
    assert.equal(out.dobi, '2.50');
    assert.equal(typedColumnsFromMetrics({ ffa: '4.1' }).ffa_average, 4.1);
  });
});
