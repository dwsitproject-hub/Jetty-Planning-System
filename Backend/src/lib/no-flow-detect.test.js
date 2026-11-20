import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUnexplainedStops, flowWindow } from './no-flow-detect.js';

const H = (s, e, status) => ({ hourStart: `2026-10-19T${s}:00:00Z`, hourEnd: `2026-10-19T${e}:00:00Z`, status });

test('gap between two entries is flagged when long enough', () => {
  const stops = detectUnexplainedStops({
    lines: [
      { startedAt: '2026-10-19T00:00:00Z', endedAt: '2026-10-19T01:00:00Z' },
      { startedAt: '2026-10-19T03:00:00Z', endedAt: null },
    ],
    minMinutes: 60,
  });
  assert.deepEqual(stops, [
    { startedAt: '2026-10-19T01:00:00.000Z', endedAt: '2026-10-19T03:00:00.000Z', minutes: 120, source: 'gap' },
  ]);
});

test('short gaps are ignored and overlapping entries are not gaps', () => {
  const stops = detectUnexplainedStops({
    lines: [
      { startedAt: '2026-10-19T00:00:00Z', endedAt: '2026-10-19T05:00:00Z' },
      { startedAt: '2026-10-19T02:00:00Z', endedAt: '2026-10-19T04:00:00Z' },
      { startedAt: '2026-10-19T05:30:00Z', endedAt: '2026-10-19T06:00:00Z' },
    ],
    minMinutes: 60,
  });
  assert.deepEqual(stops, []);
});

test('consecutive flat hours merge; an hour with any flowing row is not flat', () => {
  const stops = detectUnexplainedStops({
    hours: [
      H('01', '02', 'flat_movement'),
      H('02', '03', 'flat_movement'),
      H('03', '04', 'flat_movement'),
      H('03', '04', 'active'),
      H('05', '06', 'flat_movement'),
    ],
    minMinutes: 60,
  });
  assert.equal(stops.length, 2);
  assert.equal(stops[0].minutes, 120);
  assert.equal(stops[0].source, 'atg_flat');
  assert.equal(stops[1].startedAt, '2026-10-19T05:00:00.000Z');
});

test('recorded stops cut out what is already explained', () => {
  const stops = detectUnexplainedStops({
    hours: [H('01', '02', 'flat_movement'), H('02', '03', 'flat_movement'), H('03', '04', 'flat_movement')],
    events: [{ startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T02:30:00Z' }],
    minMinutes: 60,
  });
  assert.deepEqual(
    stops.map((s) => [s.startedAt, s.minutes]),
    [['2026-10-19T02:30:00.000Z', 90]]
  );
});

test('flowWindow spans first start to last end, or now while open', () => {
  const lines = [
    { startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T02:00:00Z' },
    { startedAt: '2026-10-19T03:00:00Z', endedAt: '2026-10-19T05:00:00Z' },
  ];
  assert.deepEqual(flowWindow(lines), {
    startedAt: '2026-10-19T01:00:00.000Z',
    endedAt: '2026-10-19T05:00:00.000Z',
    isOpen: false,
  });
  const open = flowWindow([{ startedAt: '2026-10-19T01:00:00Z', endedAt: null }], Date.parse('2026-10-19T04:00:00Z'));
  assert.equal(open.endedAt, '2026-10-19T04:00:00.000Z');
  assert.equal(flowWindow([]), null);
});
