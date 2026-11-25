import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoFlowReport, stopPhaseLabel } from './no-flow-report.js';

const iso = (h) => new Date(Date.parse('2026-11-14T00:00:00Z') + h * 3600000).toISOString();
const range = { from: iso(0), to: iso(100) };
const nowMs = Date.parse(iso(200));

const voyages = [
  { id: 1, vessel: 'BG ONE', jetty: 'J1', purpose: 'Unloading', siRef: 'SI-1', tb: iso(0), castOff: iso(50), cargoStart: iso(10), cargoEnd: iso(40) },
  { id: 2, vessel: 'BG TWO', jetty: 'J2', purpose: 'Loading', siRef: 'SI-2', tb: iso(60), castOff: iso(150), cargoStart: iso(70), cargoEnd: iso(120) },
];
const ev = (id, operationId, s, e, code, category, extra = {}) => ({
  id, operationId, startedAt: iso(s), endedAt: e == null ? null : iso(e), reasonCode: code,
  reasonNameEn: code, reasonNameId: code, category, note: null, source: 'manual', ...extra,
});

test('totals, reasons, who-caused and phases add up', () => {
  const r = buildNoFlowReport({
    voyages, range, nowMs,
    events: [
      ev(1, 1, 2, 6, 'HOA', 'external'),
      ev(2, 1, 20, 25, 'OVT', 'terminal'),
      ev(3, 1, 26, 27, 'OVT', 'terminal'),
      ev(4, 2, 80, 83, 'OVT', 'terminal'),
    ],
  });
  assert.equal(r.summary.stopHours, 13);
  assert.equal(r.summary.stopCount, 4);
  assert.equal(r.summary.voyagesWithStops, 2);
  assert.deepEqual(r.byPhase, { before: 4, during: 9, after: 0 });
  assert.equal(r.byReason[0].code, 'OVT');
  assert.equal(r.byReason[0].hours, 9);
  assert.equal(r.byReason[0].count, 3);
  assert.equal(r.byReason[0].pct, 69.23);
  assert.deepEqual(r.byCategory.map((c) => [c.category, c.hours]), [['terminal', 9], ['external', 4]]);
  assert.equal(r.summary.biggestReason.code, 'OVT');
  assert.deepEqual(r.byVoyage[0].byReason, { HOA: 4, OVT: 6 });
  assert.equal(r.byVoyage[0].vessel, 'BG ONE');
  assert.deepEqual(r.byJetty.map((j) => j.jetty), ['J1', 'J2']);
});

test('berth hours and stop share are cut to the period', () => {
  const r = buildNoFlowReport({
    voyages, nowMs,
    range: { from: iso(40), to: iso(100) },
    events: [ev(1, 2, 90, 110, 'CHL', 'terminal')],
  });
  // voyage 1 berthed 40..50 (10 h), voyage 2 60..100 (40 h)
  assert.equal(r.summary.berthHours, 50);
  assert.equal(r.summary.stopHours, 10);
  assert.equal(r.summary.stopPctOfBerth, 20);
  assert.equal(r.summary.voyagesBerthed, 2);
});

test('open stop runs until now; empty period gives zeros and no biggest reason', () => {
  const open = buildNoFlowReport({ voyages, range: { from: iso(0), to: iso(300) }, nowMs, events: [ev(1, 2, 140, null, 'HOA', 'external')] });
  assert.equal(open.stops[0].isOpen, true);
  assert.equal(open.summary.stopHours, 60);
  const empty = buildNoFlowReport({ voyages: [], events: [], range, nowMs });
  assert.equal(empty.summary.stopHours, 0);
  assert.equal(empty.summary.biggestReason, null);
  assert.equal(empty.summary.stopPctOfBerth, null);
});

test('stop phase label', () => {
  assert.equal(stopPhaseLabel({ before: 2, during: 0, after: 0 }), 'before');
  assert.equal(stopPhaseLabel({ before: 0, during: 3, after: 0 }), 'during');
  assert.equal(stopPhaseLabel({ before: 1, during: 3, after: 0 }), 'mixed');
  assert.equal(stopPhaseLabel({ before: 0, during: 0, after: 0 }), 'during');
});

test('detected stops without a reason are reported as "No reason yet" and kept out of the biggest cause', () => {
  const r = buildNoFlowReport({
    voyages, range, nowMs,
    events: [ev(1, 1, 20, 22, 'OVT', 'terminal')],
    unexplained: [
      { operationId: 1, startedAt: iso(25), endedAt: iso(31), source: 'gap' },
      { operationId: 2, startedAt: iso(80), endedAt: iso(81), source: 'atg_flat' },
    ],
  });
  assert.equal(r.summary.stopHours, 9);
  assert.equal(r.summary.explainedHours, 2);
  assert.equal(r.summary.unexplainedHours, 7);
  assert.equal(r.summary.unexplainedCount, 2);
  assert.equal(r.summary.biggestReason.code, 'OVT');
  const nr = r.byReason.find((x) => x.code === 'NO_REASON');
  assert.equal(nr.category, 'unexplained');
  assert.equal(nr.hours, 7);
  assert.equal(r.byReason[0].code, 'NO_REASON');
  assert.deepEqual(r.byVoyage.find((v) => v.operationId === 1).byReason, { OVT: 2, NO_REASON: 6 });
  assert.equal(r.stops.filter((s) => s.needsReason).length, 2);
});
