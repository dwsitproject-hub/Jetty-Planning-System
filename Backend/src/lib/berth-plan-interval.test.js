import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateBerthPlanJettyAssignment } from './berth-plan-interval.js';

const ETB_A = new Date('2026-06-10T08:00:00').toISOString();
const ETB_B = new Date('2026-06-12T10:00:00').toISOString();

describe('validateBerthPlanJettyAssignment (backend)', () => {
  it('blocks overlapping assignment on single-lane jetty when incumbent lacks ETC', () => {
    const schedule = [
      { vesselId: 'a', vesselName: 'MT CHANG LONG 79', jetty: '3A', etbDateTime: ETB_A },
      { vesselId: 'b', vesselName: 'MT ALINYA', jetty: '3A', etbDateTime: ETB_B },
    ];
    const result = validateBerthPlanJettyAssignment({
      candidate: schedule[1],
      scheduleRows: schedule,
      jettyShortId: '3A',
      jettyCapacity: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing_etc');
  });

  it('allows second vessel on double-bank jetty when incumbent lacks ETC', () => {
    const schedule = [
      { vesselId: 'a', vesselName: 'Vessel A', jetty: '2A', etbDateTime: ETB_A },
      { vesselId: 'x', vesselName: 'Vessel X', jetty: '2A', etbDateTime: ETB_B },
    ];
    const result = validateBerthPlanJettyAssignment({
      candidate: schedule[1],
      scheduleRows: schedule,
      jettyShortId: '2A',
      jettyCapacity: 2,
    });
    assert.equal(result.ok, true);
  });
});
