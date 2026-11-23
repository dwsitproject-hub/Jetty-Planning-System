import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGanttStopsByOperation, mapGanttStop } from './no-flow-gantt-stops.js';

const row = (id, op, s, e) => ({
  id, operation_id: op, started_at: s, ended_at: e, note: null, code: 'OVT', name_en: 'Over tank', name_id: 'Overtank', category: 'terminal',
});

test('maps a stop to a Gantt mark and marks open stops', () => {
  const closed = mapGanttStop(row(1, 7, '2026-11-14T01:00:00Z', '2026-11-14T03:00:00Z'));
  assert.equal(closed.id, '1');
  assert.equal(closed.isOpen, false);
  assert.equal(closed.reasonCode, 'OVT');
  const open = mapGanttStop(row(2, 7, '2026-11-14T01:00:00Z', null));
  assert.equal(open.isOpen, true);
  assert.equal(open.endedAt, null);
});

test('groups stops per operation and skips the query for no ids', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push(params); return { rows: [row(1, 7, '2026-11-14T01:00:00Z', null), row(2, 8, '2026-11-14T02:00:00Z', '2026-11-14T03:00:00Z'), row(3, 7, '2026-11-14T05:00:00Z', '2026-11-14T06:00:00Z')] }; } };
  assert.equal((await loadGanttStopsByOperation(db, [])).size, 0);
  assert.equal(calls.length, 0);
  const map = await loadGanttStopsByOperation(db, [7, '8', 7, 'x', null]);
  assert.deepEqual(calls[0], [[7, 8]]);
  assert.deepEqual(map.get(7).map((s) => s.id), ['1', '3']);
  assert.equal(map.get(8).length, 1);
});
