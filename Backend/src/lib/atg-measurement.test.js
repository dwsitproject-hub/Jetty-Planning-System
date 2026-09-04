import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attachAtgQtyFields,
  litersToKl,
  observedVolumeToKl,
  observedVolumeToLiters,
  readAtgQtyFromResult,
  resolveAtgMeasurementBasis,
  resolveFlatThresholds,
} from './atg-measurement.js';

describe('observedVolumeToLiters', () => {
  it('treats small values as m3 and converts to liters', () => {
    assert.equal(observedVolumeToLiters(1234.5), 1234500);
  });

  it('treats large values as already liters', () => {
    assert.equal(observedVolumeToLiters(1234500), 1234500);
  });
});

describe('litersToKl', () => {
  it('divides by 1000', () => {
    assert.equal(litersToKl(5000), 5);
  });
});

describe('observedVolumeToKl', () => {
  it('converts m3 storage to KL', () => {
    assert.equal(observedVolumeToKl(1000), 1000);
  });

  it('converts liter storage to KL', () => {
    assert.equal(observedVolumeToKl(2500000), 2500);
  });
});

describe('resolveAtgMeasurementBasis', () => {
  it('returns volume for KL', () => {
    assert.equal(resolveAtgMeasurementBasis('KL'), 'volume');
  });

  it('returns mass for MT and default', () => {
    assert.equal(resolveAtgMeasurementBasis('MT'), 'mass');
    assert.equal(resolveAtgMeasurementBasis(null), 'mass');
  });
});

describe('resolveFlatThresholds', () => {
  it('returns MT defaults for MT SI', () => {
    const t = resolveFlatThresholds('MT');
    assert.equal(t.flatRateThresholdTph, 2);
    assert.equal(t.minQtyMovedT, 1);
    assert.equal(t.qtyUnit, 'MT');
    assert.equal(t.measurementBasis, 'mass');
  });

  it('returns KL defaults for KL SI', () => {
    const t = resolveFlatThresholds('KL');
    assert.equal(t.flatRateThresholdTph, 2);
    assert.equal(t.minQtyMovedT, 1);
    assert.equal(t.qtyUnit, 'KL');
    assert.equal(t.measurementBasis, 'volume');
  });
});

describe('readAtgQtyFromResult / attachAtgQtyFields', () => {
  it('prefers sumAtgQty', () => {
    assert.equal(readAtgQtyFromResult({ sumAtgQty: 42, sumDeltaMass: 1 }), 42);
  });

  it('falls back to sumDeltaVolumeKl then sumDeltaMass', () => {
    assert.equal(readAtgQtyFromResult({ sumDeltaVolumeKl: 10 }), 10);
    assert.equal(readAtgQtyFromResult({ sumDeltaMass: 5 }), 5);
  });

  it('attachAtgQtyFields sets sumDeltaMass for mass basis only', () => {
    const mass = attachAtgQtyFields({ sumDeltaMass: 100 }, 'mass');
    assert.equal(mass.sumAtgQty, 100);
    assert.equal(mass.sumDeltaMass, 100);

    const vol = attachAtgQtyFields({ sumDeltaVolumeKl: 50 }, 'volume');
    assert.equal(vol.sumAtgQty, 50);
    assert.equal(vol.sumDeltaMass, undefined);
  });
});
