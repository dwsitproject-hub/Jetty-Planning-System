import test from 'node:test';
import assert from 'node:assert/strict';
import { POST_CHECK_AUTO_KEYS, promoteAfterOperationalSave } from './operation-auto-status.js';

function fakeClient(rowCounts) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: rowCounts[calls.length - 1] ?? 0 };
    },
  };
}

test('promoteAfterOperationalSave promotes DOCKED then checks final post-check', async () => {
  const client = fakeClient([1, 0]);
  const r = await promoteAfterOperationalSave(client, 7);
  assert.deepEqual(r, { promoted: true, postOps: false });
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[0].sql, /status = 'DOCKED'/);
  assert.match(client.calls[1].sql, /status = 'POST_OPS'/);
  assert.deepEqual(client.calls[1].params, [7, [...POST_CHECK_AUTO_KEYS]]);
});

test('promoteAfterOperationalSave reports POST_OPS when final step already saved', async () => {
  const client = fakeClient([0, 1]);
  assert.deepEqual(await promoteAfterOperationalSave(client, 7), { promoted: true, postOps: true });
});

test('promoteAfterOperationalSave is a no-op when nothing matches', async () => {
  const client = fakeClient([0, 0]);
  assert.deepEqual(await promoteAfterOperationalSave(client, 7), { promoted: false, postOps: false });
});
