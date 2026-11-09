import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankSimilarVessels } from './vessel-name-similarity.js';

function vessel(id, vesselName, extra = {}) {
  return {
    id,
    vesselName,
    vesselType: extra.vesselType ?? 'barge',
    hubCode: extra.hubCode ?? null,
    isActive: extra.isActive !== false,
    vesselImo: extra.vesselImo ?? null,
    vesselMmsi: extra.vesselMmsi ?? null,
  };
}

const fleet = [
  vessel(1, 'BG. LUMINOR', { hubCode: 'VSL-0001' }),
  vessel(2, 'LUMINOR'),
  vessel(3, 'BG. LUMINOR 2'),
  vessel(4, 'TB. LUMINOR', { vesselType: 'tugboat' }),
  vessel(5, 'MT. OTHER STAR', { vesselType: 'tanker' }),
];

function reasonsFor(name, rows = fleet) {
  return rankSimilarVessels({ name }, rows);
}

describe('vessel name similarity', () => {
  it('matches the same barge when punctuation differs', () => {
    const matches = reasonsFor('BG LUMINOR');
    const hit = matches.find((row) => row.id === 1);
    assert.ok(hit);
    assert.equal(hit.reason, 'barge_label');
    assert.equal(hit.hubCode, 'VSL-0001');
  });

  it('matches a small typo', () => {
    const matches = reasonsFor('Luminer', [vessel(2, 'LUMINOR')]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 2);
    assert.equal(matches[0].reason, 'typo');
  });

  it('treats TK and BG as the same barge', () => {
    const matches = reasonsFor('TK Luminor');
    const barge = matches.find((row) => row.id === 1);
    assert.ok(barge);
    assert.equal(barge.reason, 'barge_label');
    assert.equal(matches.some((row) => row.id === 3), false);
  });

  it('keeps a numbered hull separate', () => {
    const matches = reasonsFor('LUMINOR 2');
    assert.equal(matches.some((row) => row.id === 1), false);
    assert.equal(matches.some((row) => row.id === 2), false);
    assert.equal(matches.some((row) => row.id === 3), true);
  });

  it('shows a tug with the same words as a close name, not as the same barge', () => {
    const matches = reasonsFor('TB Luminor');
    const barge = matches.find((row) => row.id === 1);
    assert.ok(barge);
    assert.equal(barge.reason, 'similar_name');
    assert.notEqual(barge.reason, 'barge_label');
  });

  it('matches the same words in a different order', () => {
    const matches = reasonsFor('Luminor BG', [vessel(1, 'BG. LUMINOR')]);
    assert.equal(matches[0]?.id, 1);
  });

  it('does not suggest from a short token', () => {
    assert.deepEqual(reasonsFor('AS'), []);
    assert.deepEqual(reasonsFor('A 2'), []);
  });

  it('matches the same IMO across different names', () => {
    const rows = [
      vessel(8, 'MT. BINTANG', { vesselType: 'tanker', vesselImo: '9123456' }),
    ];
    const matches = rankSimilarVessels({ name: 'Completely Different', imo: '9123456' }, rows);
    assert.equal(matches[0]?.reason, 'imo');
    assert.equal(matches[0]?.id, 8);
  });

  it('skips the vessel being edited and caps the list', () => {
    const rows = Array.from({ length: 12 }, (_, i) => vessel(i + 1, `GLORY VESSEL ${String.fromCharCode(65 + i)}`));
    const matches = rankSimilarVessels({ name: 'GLORY', excludeId: 1 }, rows);
    assert.equal(matches.some((row) => row.id === 1), false);
    assert.equal(matches.length, 8);
  });
});
