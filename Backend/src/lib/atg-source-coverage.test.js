import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoverageBlocks,
  recoveredRangesFromBlocks,
  resolveSourceSilentMs,
  summarizeSourceCoverage,
} from './atg-source-coverage.js';

const NOW = Date.parse('2026-11-26T06:00:00Z');
const MIN = 60000;

function pollEvery15(fromMs, toMs, origin = 'live') {
  const out = [];
  for (let t = fromMs; t <= toMs; t += 15 * MIN) out.push({ sampledAt: new Date(t), origin });
  return out;
}

describe('buildCoverageBlocks', () => {
  it('marks every block live when polls run every 15 minutes', () => {
    const blocks = buildCoverageBlocks(pollEvery15(NOW - 24 * 60 * MIN, NOW), NOW);
    assert.equal(blocks.length, 48);
    assert.equal(blocks, 'l'.repeat(48));
  });

  it('marks blocks without samples as missing', () => {
    const samples = [
      ...pollEvery15(NOW - 24 * 60 * MIN, NOW - 12 * 60 * MIN - 15 * MIN),
      ...pollEvery15(NOW - 6 * 60 * MIN, NOW),
    ];
    const blocks = buildCoverageBlocks(samples, NOW);
    assert.equal(blocks.slice(0, 24), 'l'.repeat(24));
    assert.equal(blocks.slice(24, 36), 'm'.repeat(12));
    assert.equal(blocks.slice(36), 'l'.repeat(12));
  });

  it('marks blocks with only archive-backfill samples as recovered', () => {
    const samples = [
      ...pollEvery15(NOW - 24 * 60 * MIN, NOW - 12 * 60 * MIN),
      ...pollEvery15(NOW - 11 * 60 * MIN, NOW - 6 * 60 * MIN, 'archive-backfill'),
      ...pollEvery15(NOW - 5 * 60 * MIN, NOW),
    ];
    const blocks = buildCoverageBlocks(samples, NOW);
    assert.ok(blocks.includes('r'));
    assert.equal(blocks.includes('m'), true);
    const ranges = recoveredRangesFromBlocks(blocks, NOW);
    assert.equal(ranges.length, 1);
    assert.ok(ranges[0].blocks >= 9);
  });

  it('ignores samples outside the window', () => {
    const blocks = buildCoverageBlocks(
      [{ sampledAt: new Date(NOW - 30 * 60 * 60 * 1000) }, { sampledAt: new Date(NOW + 5 * MIN) }],
      NOW
    );
    assert.equal(blocks, 'm'.repeat(48));
  });
});

describe('summarizeSourceCoverage', () => {
  it('reports live for an uninterrupted source', () => {
    const s = summarizeSourceCoverage(pollEvery15(NOW - 24 * 60 * MIN, NOW), { nowMs: NOW });
    assert.equal(s.status, 'live');
    assert.equal(s.silentNow, false);
    assert.deepEqual(s.gaps, []);
  });

  it('ignores a single missed poll', () => {
    const samples = pollEvery15(NOW - 24 * 60 * MIN, NOW).filter(
      (s) => s.sampledAt.getTime() !== NOW - 60 * MIN
    );
    const s = summarizeSourceCoverage(samples, { nowMs: NOW });
    assert.equal(s.status, 'live');
    assert.deepEqual(s.gaps, []);
  });

  it('reports a gap that has since ended', () => {
    const samples = [
      ...pollEvery15(NOW - 24 * 60 * MIN, NOW - 14 * 60 * MIN),
      ...pollEvery15(NOW - 6 * 60 * MIN, NOW),
    ];
    const s = summarizeSourceCoverage(samples, { nowMs: NOW });
    assert.equal(s.status, 'gap');
    assert.equal(s.silentNow, false);
    assert.equal(s.gaps.length, 1);
    assert.equal(s.gaps[0].ongoing, false);
    assert.ok(s.gaps[0].durationMinutes >= 480);
  });

  it('reports silent when the source stopped and nothing arrived since', () => {
    const s = summarizeSourceCoverage(pollEvery15(NOW - 24 * 60 * MIN, NOW - 2 * 60 * MIN), {
      nowMs: NOW,
    });
    assert.equal(s.status, 'silent');
    assert.equal(s.silentNow, true);
    assert.equal(s.silentMinutes, 120);
    assert.equal(s.gaps.at(-1).ongoing, true);
  });

  it('stays silent when only recovered samples are recent', () => {
    const samples = [
      ...pollEvery15(NOW - 24 * 60 * MIN, NOW - 3 * 60 * MIN),
      ...pollEvery15(NOW - 2 * 60 * MIN, NOW, 'archive-backfill'),
    ];
    const s = summarizeSourceCoverage(samples, { nowMs: NOW });
    assert.equal(s.silentNow, true);
    assert.equal(s.status, 'silent');
    assert.equal(s.silentMinutes, 180);
  });

  it('reports silent for a source with no samples at all', () => {
    const s = summarizeSourceCoverage([], { nowMs: NOW });
    assert.equal(s.status, 'silent');
    assert.equal(s.lastSampleAt, null);
    assert.equal(s.silentMinutes, null);
  });

  it('reports recovered once archive samples fill the gap', () => {
    const samples = [
      ...pollEvery15(NOW - 24 * 60 * MIN, NOW - 14 * 60 * MIN),
      ...pollEvery15(NOW - 14 * 60 * MIN + 15 * MIN, NOW - 6 * 60 * MIN - 15 * MIN, 'archive-backfill'),
      ...pollEvery15(NOW - 6 * 60 * MIN, NOW),
    ];
    const s = summarizeSourceCoverage(samples, { nowMs: NOW });
    assert.equal(s.status, 'recovered');
    assert.deepEqual(s.gaps, []);
    assert.equal(s.recoveredRanges.length, 1);
  });
});

describe('resolveSourceSilentMs', () => {
  it('defaults to 45 minutes and honours the env override', () => {
    assert.equal(resolveSourceSilentMs({}), 45 * MIN);
    assert.equal(resolveSourceSilentMs({ ATG_SOURCE_SILENT_MINUTES: '60' }), 60 * MIN);
    assert.equal(resolveSourceSilentMs({ ATG_SOURCE_SILENT_MINUTES: 'abc' }), 45 * MIN);
  });
});
