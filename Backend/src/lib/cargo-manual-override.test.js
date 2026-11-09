import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildManualOverrideJson,
  checkOverrideEntries,
  parseOverrideEntries,
  totalManualQty,
} from './cargo-manual-override.js';

const base = {
  entries: [{ tankId: 2, qty: 820 }],
  note: 'Counted by shore tank dip',
  atgTankIds: [1, 2],
  activeIds: new Set([2]),
  grandfatheredIds: new Set(),
  hasEnd: true,
  atgQtyMode: 'auto',
  codeById: new Map([[2, '5102']]),
};

describe('cargo-manual-override', () => {
  it('parses entries and the note', () => {
    const r = parseOverrideEntries({ manualOverrides: [{ tankId: '2', qty: '820' }], manualOverrideNote: ' dip ' }, 0);
    assert.deepEqual(r, { ok: true, entries: [{ tankId: 2, qty: 820 }], note: 'dip' });
  });

  it('treats a missing list as no override', () => {
    assert.deepEqual(parseOverrideEntries({}, 0), { ok: true, entries: [], note: '' });
  });

  it('rejects bad quantities, bad tanks and duplicates', () => {
    assert.equal(parseOverrideEntries({ manualOverrides: [{ tankId: 2, qty: 0 }] }, 1).ok, false);
    assert.equal(parseOverrideEntries({ manualOverrides: [{ tankId: 'x', qty: 5 }] }, 1).ok, false);
    assert.equal(parseOverrideEntries({ manualOverrides: [{ tankId: 2, qty: 5 }, { tankId: 2, qty: 6 }] }, 1).ok, false);
    assert.equal(parseOverrideEntries({ manualOverrides: 'x' }, 1).ok, false);
  });

  it('accepts an active override with a note', () => {
    assert.equal(checkOverrideEntries(base), null);
  });

  it('rejects a tank whose override is off', () => {
    assert.match(checkOverrideEntries({ ...base, activeIds: new Set() }), /not enabled for tank 5102/);
  });

  it('keeps an already stored segment valid after the override expired', () => {
    assert.equal(checkOverrideEntries({ ...base, activeIds: new Set(), grandfatheredIds: new Set([2]) }), null);
  });

  it('requires a note, an end time, and a tank that is on ATG', () => {
    assert.match(checkOverrideEntries({ ...base, note: '' }), /note/);
    assert.match(checkOverrideEntries({ ...base, hasEnd: false }), /ends/);
    assert.match(checkOverrideEntries({ ...base, atgTankIds: [1] }), /not an ATG tank/);
  });

  it('refuses to mix with "ATG not available"', () => {
    assert.match(checkOverrideEntries({ ...base, atgQtyMode: 'manual' }), /not both/);
  });

  it('adds non-ATG manual quantity and overridden tanks', () => {
    assert.equal(totalManualQty(100, [{ qty: 820 }, { qty: 30 }]), 950);
    assert.equal(totalManualQty(null, [{ qty: 820 }]), 820);
  });

  it('builds the stored JSON, or null when there is no override', () => {
    assert.deepEqual(buildManualOverrideJson([{ tankId: 2, qty: 820 }], 'dip'), { note: 'dip', tanks: [{ tankId: 2, qty: 820 }] });
    assert.equal(buildManualOverrideJson([], 'x'), null);
  });
});
