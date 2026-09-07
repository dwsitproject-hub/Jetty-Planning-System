import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAndNormalizeTankReadings } from './sounding-tank-readings.js';

describe('validateAndNormalizeTankReadings', () => {
  it('requires at least one reading when requireReadings is true', () => {
    assert.throws(
      () => validateAndNormalizeTankReadings([], { requireReadings: true }),
      (err) => err.statusCode === 400
    );
  });

  it('allows empty array for draft saves', () => {
    assert.deepEqual(validateAndNormalizeTankReadings([], { requireReadings: false }), []);
  });

  it('normalizes a valid mass reading', () => {
    const out = validateAndNormalizeTankReadings(
      [
        {
          tankId: 12,
          tankCode: 'TK-5201',
          captureMode: 'auto',
          massMt: 12345.67,
          temperatureC: 32.4,
          lockedAt: '2026-09-07T08:00:00.000Z',
        },
      ],
      { siMetric: 'MT' }
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].tankId, 12);
    assert.equal(out[0].massMt, 12345.67);
    assert.equal(out[0].measurementBasis, 'mass');
  });

  it('normalizes a valid dual reading with ATG and manual sides', () => {
    const out = validateAndNormalizeTankReadings(
      [
        {
          tankId: 12,
          tankCode: 'TK-5104',
          captureMode: 'dual',
          atg: {
            massMt: 2720.413,
            temperatureC: 44,
            lockedAt: '2026-09-07T07:25:00.000Z',
          },
          manual: {
            massMt: 2720,
            temperatureC: 44,
            capturedAt: '2026-09-07T07:26:00.000Z',
          },
          lockedAt: '2026-09-07T07:26:00.000Z',
        },
      ],
      { siMetric: 'MT' }
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].captureMode, 'dual');
    assert.equal(out[0].atg.massMt, 2720.413);
    assert.equal(out[0].manual.massMt, 2720);
  });

  it('requires volumeKl for KL SI metric', () => {
    assert.throws(
      () =>
        validateAndNormalizeTankReadings(
          [
            {
              tankId: 1,
              massMt: 100,
              temperatureC: 30,
              lockedAt: '2026-09-07T08:00:00.000Z',
            },
          ],
          { siMetric: 'KL' }
        ),
      (err) => err.statusCode === 400
    );
  });
});
