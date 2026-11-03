import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBerthedQueueRow } from './berthed-queue.js';

describe('isBerthedQueueRow', () => {
  it('requires an operation', () => {
    assert.equal(isBerthedQueueRow({ tbDateTime: '2026-10-01T00:00:00Z' }), false);
    assert.equal(isBerthedQueueRow(null), false);
  });

  it('accepts a TB timestamp or a docked-or-later status', () => {
    assert.equal(isBerthedQueueRow({ operationId: 1, tbDateTime: '2026-10-01T00:00:00Z' }), true);
    assert.equal(isBerthedQueueRow({ operationId: 1, status: 'in_progress' }), true);
    assert.equal(isBerthedQueueRow({ operationId: 1, status: 'PLANNED' }), false);
  });

  it('excludes vessels shifted out', () => {
    assert.equal(
      isBerthedQueueRow({ operationId: 1, tbDateTime: '2026-10-01T00:00:00Z', shiftingOut: true }),
      false
    );
  });
});
