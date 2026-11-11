import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveClearanceStatus, toClearanceSummary } from './custom-clearance-queue.js';

test('deriveClearanceStatus: no row, draft row, Done row', () => {
  assert.equal(deriveClearanceStatus(undefined), 'not_started');
  assert.equal(deriveClearanceStatus({ status: 'In Progress' }), 'draft');
  assert.equal(deriveClearanceStatus({ status: null }), 'draft');
  assert.equal(deriveClearanceStatus({ status: 'Done' }), 'done');
});

test('toClearanceSummary shapes times, documents and editor', () => {
  const summary = toClearanceSummary({
    status: 'Done',
    start_at: new Date('2026-11-10T01:00:00Z'),
    end_at: new Date('2026-11-10T03:30:00Z'),
    remark: 'PEB cleared',
    document_count: '2',
    updated_at: new Date('2026-11-10T03:31:00Z'),
    updated_by_name: 'rian',
  });
  assert.deepEqual(summary, {
    status: 'done',
    startAt: '2026-11-10T01:00:00.000Z',
    endAt: '2026-11-10T03:30:00.000Z',
    remark: 'PEB cleared',
    documentCount: 2,
    updatedAt: '2026-11-10T03:31:00.000Z',
    updatedByName: 'rian',
  });
});

test('toClearanceSummary for an operation with no step yet', () => {
  assert.deepEqual(toClearanceSummary(undefined), {
    status: 'not_started',
    startAt: null,
    endAt: null,
    remark: '',
    documentCount: 0,
    updatedAt: null,
    updatedByName: null,
  });
});
