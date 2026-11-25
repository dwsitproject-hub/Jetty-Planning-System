import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchPlansToMasterVessels } from './plan-master-vessel-backfill.js';

describe('matchPlansToMasterVessels', () => {
  const vessels = [
    { id: 1, vessel_name: 'BG. LUMINOR 9' },
    { id: 2, vessel_name: 'BG. LUMINOR' },
    { id: 3, vessel_name: 'TWIN STAR' },
    { id: 4, vessel_name: 'Twin  Star' },
  ];

  it('links on an exact name match ignoring case and punctuation', () => {
    const out = matchPlansToMasterVessels([{ id: 10, vessel_name: 'bg luminor 9' }], vessels);
    assert.deepEqual(out.matched, [{ planId: 10, masterVesselId: 1 }]);
  });

  it('keeps numbered hulls apart and reports names with no match', () => {
    const out = matchPlansToMasterVessels([{ id: 11, vessel_name: 'BG LUMINOR 99' }], vessels);
    assert.equal(out.matched.length, 0);
    assert.deepEqual(out.unmatched, [{ planId: 11, vesselName: 'BG LUMINOR 99' }]);
  });

  it('does not guess when two master vessels share the name', () => {
    const out = matchPlansToMasterVessels([{ id: 12, vessel_name: 'TWIN STAR' }], vessels);
    assert.deepEqual(out.ambiguous, [{ planId: 12, vesselName: 'TWIN STAR', masterVesselIds: [3, 4] }]);
  });
});
