import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addRecord, parseRecordInput, removeRecord, updateRecord } from './sampling-records.js';

describe('parseRecordInput', () => {
  it('requires a palka label and one metric when creating', () => {
    assert.throws(() => parseRecordInput({ ffa: '4' }), { statusCode: 400 });
    assert.throws(() => parseRecordInput({ noPalka: '1' }), { statusCode: 400 });
    assert.throws(() => parseRecordInput({ noPalka: 'x'.repeat(21), ffa: '4' }), { statusCode: 400 });
  });

  it('normalises comma decimals and rejects out-of-range values', () => {
    assert.deepEqual(parseRecordInput({ noPalka: ' 1P ', ffa: '4,91', moisture: '' }), {
      noPalka: '1P',
      ffa: '4.91',
      moisture: '',
    });
    assert.throws(() => parseRecordInput({ noPalka: '1', ffa: '101' }), { statusCode: 400 });
    assert.throws(() => parseRecordInput({ noPalka: '1', ffa: 'abc' }), { statusCode: 400 });
  });

  it('only validates the fields sent on a partial update', () => {
    assert.deepEqual(parseRecordInput({ moisture: '0.25' }, { partial: true }), { moisture: '0.25' });
    assert.throws(() => parseRecordInput({ noPalka: ' ' }, { partial: true }), { statusCode: 400 });
  });

  it('Loading requires a resolved tank and copies its code', () => {
    assert.throws(
      () => parseRecordInput({ noPalka: 'TK-99', ffa: '4' }, { purpose: 'Loading', requireTank: true }),
      { statusCode: 400, message: 'tankId is required' }
    );
    assert.deepEqual(
      parseRecordInput({ tankId: 9, noPalka: 'typed', ffa: '4' }, { purpose: 'Loading', tank: { id: 9, code: ' TK-01 ' } }),
      { tankId: 9, noPalka: 'TK-01', ffa: '4.00', moisture: '' }
    );
  });

  it('Unloading keeps free-text palka and drops tankId', () => {
    assert.deepEqual(parseRecordInput({ noPalka: '2P', tankId: 9, ffa: '4' }, { purpose: 'Unloading' }), {
      noPalka: '2P',
      ffa: '4.00',
      moisture: '',
    });
  });

  it('Loading partial update can change metrics without a tank', () => {
    assert.deepEqual(parseRecordInput({ moisture: '0.25', noPalka: 'typed' }, { partial: true, purpose: 'Loading' }), {
      moisture: '0.25',
    });
  });

  it('Loading rejects an unresolved tankId on a card save', () => {
    assert.throws(
      () => parseRecordInput({ tankId: 99, noPalka: 'TK-99', ffa: '4' }, { purpose: 'Loading' }),
      { statusCode: 400, message: 'Tank is not on this port' }
    );
  });
});

describe('record operations', () => {
  const base = [{ id: 'a', noPalka: '1', ffa: '4.00', moisture: '0.20' }];

  it('adds, updates and removes without mutating the input', () => {
    const added = addRecord(base, { noPalka: '2', ffa: '5.00', moisture: '' }, 'b');
    assert.equal(added.records.length, 2);
    assert.equal(base.length, 1);

    const updated = updateRecord(added.records, 'b', { ffa: '5.50' });
    assert.equal(updated.record.ffa, '5.50');
    assert.equal(updated.records[0].ffa, '4.00');

    const removed = removeRecord(updated.records, 'a');
    assert.deepEqual(removed.records.map((r) => r.id), ['b']);
  });

  it('reports a 404 for an unknown sample id', () => {
    assert.throws(() => updateRecord(base, 'zzz', { ffa: '1' }), { statusCode: 404 });
    assert.throws(() => removeRecord(base, 'zzz'), { statusCode: 404 });
  });
});
