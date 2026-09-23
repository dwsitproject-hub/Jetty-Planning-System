import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeActualProgressPercent,
  computePlannedProgressPercent,
  evaluateCargoScheduleComparison,
  resolveScheduleStartMs,
} from './cargo-schedule-progress.js';

const HOSE_ON = '2026-08-20T08:00:00+07:00';
const ETC = '2026-08-25T08:00:00+07:00'; // 5 days

describe('resolveScheduleStartMs', () => {
  it('prefers opening hatch over TB', () => {
    const ms = resolveScheduleStartMs({
      openingHatchStartAt: HOSE_ON,
      tbAt: '2026-08-20T06:00:00+07:00',
    });
    assert.equal(ms, new Date(HOSE_ON).getTime());
  });

  it('falls back to TB when hose-on missing', () => {
    const tb = '2026-08-20T06:00:00+07:00';
    assert.equal(resolveScheduleStartMs({ tbAt: tb }), new Date(tb).getTime());
  });
});

describe('computePlannedProgressPercent', () => {
  it('returns 50% at midpoint', () => {
    const startMs = new Date(HOSE_ON).getTime();
    const etcMs = new Date(ETC).getTime();
    const midMs = startMs + (etcMs - startMs) / 2;
    assert.equal(
      computePlannedProgressPercent({ scheduleStartMs: startMs, etcMs, nowMs: midMs }),
      50
    );
  });

  it('caps at 100% after ETC', () => {
    const startMs = new Date(HOSE_ON).getTime();
    const etcMs = new Date(ETC).getTime();
    assert.equal(
      computePlannedProgressPercent({
        scheduleStartMs: startMs,
        etcMs,
        nowMs: etcMs + 86400000,
      }),
      100
    );
  });

  it('returns null when ETC <= start', () => {
    assert.equal(
      computePlannedProgressPercent({
        scheduleStartMs: new Date(ETC).getTime(),
        etcMs: new Date(HOSE_ON).getTime(),
        nowMs: Date.now(),
      }),
      null
    );
  });
});

describe('computeActualProgressPercent', () => {
  it('computes rounded percent', () => {
    assert.equal(computeActualProgressPercent({ movedQty: 5500, siQty: 22000 }), 25);
  });

  it('returns null when siQty invalid', () => {
    assert.equal(computeActualProgressPercent({ movedQty: 100, siQty: 0 }), null);
  });
});

describe('evaluateCargoScheduleComparison', () => {
  it('flags behind when actual < planned', () => {
    const startMs = new Date(HOSE_ON).getTime();
    const etcMs = new Date(ETC).getTime();
    const nowMs = startMs + (etcMs - startMs) * 0.4; // 40% planned

    const result = evaluateCargoScheduleComparison({
      openingHatchStartAt: HOSE_ON,
      etcMs: ETC,
      movedQty: 5500,
      siQty: 22000,
      nowMs,
    });

    assert.equal(result.evaluable, true);
    assert.equal(result.plannedPercent, 40);
    assert.equal(result.actualPercent, 25);
    assert.equal(result.isBehindSchedule, true);
    assert.equal(result.scheduleGapPercent, 15);
  });

  it('does not flag when actual >= planned', () => {
    const startMs = new Date(HOSE_ON).getTime();
    const etcMs = new Date(ETC).getTime();
    const nowMs = startMs + (etcMs - startMs) * 0.4;

    const result = evaluateCargoScheduleComparison({
      openingHatchStartAt: HOSE_ON,
      etcMs: ETC,
      movedQty: 11000,
      siQty: 22000,
      nowMs,
    });

    assert.equal(result.actualPercent, 50);
    assert.equal(result.isBehindSchedule, false);
    assert.equal(result.scheduleGapPercent, 0);
  });

  it('is not evaluable without timeline', () => {
    const result = evaluateCargoScheduleComparison({
      movedQty: 1000,
      siQty: 5000,
    });
    assert.equal(result.evaluable, false);
    assert.equal(result.isBehindSchedule, false);
  });

  it('stays behind after ETC when cargo incomplete', () => {
    const result = evaluateCargoScheduleComparison({
      openingHatchStartAt: HOSE_ON,
      etcMs: ETC,
      movedQty: 17600,
      siQty: 22000,
      nowMs: new Date(ETC).getTime() + 3600000,
    });

    assert.equal(result.plannedPercent, 100);
    assert.equal(result.actualPercent, 80);
    assert.equal(result.isBehindSchedule, true);
    assert.equal(result.scheduleGapPercent, 20);
  });
});
