import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateHourOfDayRates,
  buildFlowInsight,
  clockHourInTimeZone,
} from './at-berth-flow-pattern.js';

describe('clockHourInTimeZone', () => {
  it('maps Jakarta midnight correctly', () => {
    assert.equal(clockHourInTimeZone('2026-06-01T17:00:00Z', 'Asia/Jakarta'), 0);
    assert.equal(clockHourInTimeZone('2026-06-01T10:30:00Z', 'Asia/Jakarta'), 17);
  });
});

describe('aggregateHourOfDayRates', () => {
  it('averages Loading and Unloading separately by clock hour', () => {
    const hours = aggregateHourOfDayRates(
      [
        { hourStart: '2026-06-01T17:00:00Z', purpose: 'Loading', rateTph: 100 },
        { hourStart: '2026-06-02T17:00:00Z', purpose: 'Loading', rateTph: 50 },
        { hourStart: '2026-06-01T17:00:00Z', purpose: 'Unloading', rateTph: 80 },
      ],
      'Asia/Jakarta'
    );
    assert.equal(hours[0].loading, 75);
    assert.equal(hours[0].unloading, 80);
    assert.equal(hours[0].loadingN, 2);
    assert.equal(hours[1].loading, null);
  });
});

describe('buildFlowInsight', () => {
  it('reports night loading below standard', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      loading: hour < 6 ? 86 : 100,
      unloading: 100,
    }));
    const insight = buildFlowInsight(hours, { loading: 100, unloading: 100 });
    assert.match(insight, /Loading 00:00–06:00 14% below standard/);
  });

  it('falls back when no standard and no contrast', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      loading: null,
      unloading: null,
    }));
    assert.match(buildFlowInsight(hours, {}), /Not enough hourly cargo data/);
  });
});
