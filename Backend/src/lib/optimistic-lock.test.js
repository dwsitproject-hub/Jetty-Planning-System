import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNotStale } from './optimistic-lock.js';

describe('assertNotStale', () => {
  const current = new Date('2026-10-28T03:00:00.000Z');

  it('allows saves with no expected version or a matching one', () => {
    assert.doesNotThrow(() => assertNotStale(current, undefined));
    assert.doesNotThrow(() => assertNotStale(current, ''));
    assert.doesNotThrow(() => assertNotStale(current, '2026-10-28T03:00:00.000Z'));
  });

  it('rejects an older version with 409', () => {
    assert.throws(() => assertNotStale(current, '2026-10-28T02:59:00.000Z'), { statusCode: 409 });
  });

  it('rejects an unparseable version with 400', () => {
    assert.throws(() => assertNotStale(current, 'nope'), { statusCode: 400 });
  });
});
