import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildManualDailyBarsForLine,
  buildScheduleComparisonFromCargoSummary,
  mergeDailyBars,
  resolveCanonicalMovedQty,
  resolveLineMode,
  summarizeCargoProgressContext,
} from './operational-progress.js';
import {
  currentOperationalDateKey,
  DEFAULT_OPERATIONAL_DAY_START,
  listOperationalDateKeysInRange,
  operationalDateKey,
  operationalDayBounds,
  parseOperationalDayStart,
} from './operational-day.js';

describe('parseOperationalDayStart', () => {
  it('defaults to 06:00:00', () => {
    assert.equal(parseOperationalDayStart(null).formatted, '06:00:00');
  });

  it('parses HH:mm:ss', () => {
    assert.equal(parseOperationalDayStart('07:30:15').formatted, '07:30:15');
  });
});

describe('operationalDateKey', () => {
  it('maps before 06:00 to previous operational day', () => {
    assert.equal(
      operationalDateKey('2026-08-04T04:33:00+07:00', 'Asia/Jakarta', DEFAULT_OPERATIONAL_DAY_START),
      '2026-08-03'
    );
  });

  it('maps at 06:00:00 to same calendar operational day', () => {
    assert.equal(
      operationalDateKey('2026-08-05T06:00:00+07:00', 'Asia/Jakarta', DEFAULT_OPERATIONAL_DAY_START),
      '2026-08-05'
    );
  });
});

describe('operationalDayBounds', () => {
  it('uses 06:00:00 to next day 05:59:59 for default start', () => {
    const b = operationalDayBounds('2026-08-05', 'Asia/Jakarta', DEFAULT_OPERATIONAL_DAY_START);
    assert.ok(b);
    assert.equal(b.start.toISO(), '2026-08-05T06:00:00.000+07:00');
    assert.equal(b.end.toISO(), '2026-08-06T05:59:59.000+07:00');
  });

  it('supports custom port start time 07:00:00', () => {
    const b = operationalDayBounds('2026-08-05', 'Asia/Jakarta', '07:00:00');
    assert.ok(b);
    assert.equal(b.start.toISO(), '2026-08-05T07:00:00.000+07:00');
    assert.equal(b.end.toISO(), '2026-08-06T06:59:59.000+07:00');
  });
});

describe('buildManualDailyBarsForLine', () => {
  it('puts overnight entry entirely on start operational day', () => {
    const bars = buildManualDailyBarsForLine(
      {
        qty: 1530.692,
        startedAt: '2026-08-03T08:05:00+07:00',
        endedAt: '2026-08-04T04:33:00+07:00',
      },
      'Asia/Jakarta',
      DEFAULT_OPERATIONAL_DAY_START
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0].date, '2026-08-03');
    assert.ok(Math.abs(bars[0].qtyMoved - 1530.692) < 0.01);
  });

  it('splits proportionally across operational days when span crosses boundary', () => {
    const bars = buildManualDailyBarsForLine(
      {
        qty: 1000,
        startedAt: '2026-08-04T20:00:00+07:00',
        endedAt: '2026-08-05T10:00:00+07:00',
      },
      'Asia/Jakarta',
      DEFAULT_OPERATIONAL_DAY_START
    );
    assert.equal(bars.length, 2);
    assert.equal(bars[0].date, '2026-08-04');
    assert.equal(bars[1].date, '2026-08-05');
    const sum = bars.reduce((s, b) => s + b.qtyMoved, 0);
    assert.ok(Math.abs(sum - 1000) < 0.1);
  });
});

describe('resolveLineMode', () => {
  it('returns mixed when both tank types present', () => {
    assert.equal(
      resolveLineMode({
        commodityType: 'Liquid',
        atgTankIds: [1],
        manualTankIds: [2],
        atgQtyMode: 'auto',
      }),
      'mixed'
    );
  });

  it('forces manual when atg_qty_mode is manual', () => {
    assert.equal(
      resolveLineMode({
        commodityType: 'Liquid',
        atgTankIds: [1],
        manualTankIds: [],
        atgQtyMode: 'manual',
      }),
      'manual'
    );
  });

  it('forces manual for solid cargo', () => {
    assert.equal(
      resolveLineMode({
        commodityType: 'Solid',
        atgTankIds: [],
        manualTankIds: [],
        atgQtyMode: 'auto',
      }),
      'manual'
    );
  });

  it('returns atg when all tanks have ATG', () => {
    assert.equal(
      resolveLineMode({
        commodityType: 'Liquid',
        atgTankIds: [1, 2],
        manualTankIds: [],
        atgQtyMode: 'auto',
      }),
      'atg'
    );
  });
});

describe('mergeDailyBars', () => {
  it('sums by date with atg and manual portions', () => {
    const merged = mergeDailyBars(
      [{ date: '2026-08-04', qtyMoved: 100, atgQty: 100, manualQty: 0 }],
      [{ date: '2026-08-04', qtyMoved: 50, atgQty: 0, manualQty: 50 }]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyMoved, 150);
    assert.equal(merged[0].atgQty, 100);
    assert.equal(merged[0].manualQty, 50);
  });

  it('merges mid-operation ATG + manual segments across dates', () => {
    const merged = mergeDailyBars(
      [
        { date: '2026-08-04', qtyMoved: 400, atgQty: 400, manualQty: 0 },
        { date: '2026-08-05', qtyMoved: 200, atgQty: 200, manualQty: 0 },
      ],
      [{ date: '2026-08-05', qtyMoved: 300, atgQty: 0, manualQty: 300 }]
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].qtyMoved, 400);
    assert.equal(merged[1].qtyMoved, 500);
    assert.equal(merged[1].atgQty, 200);
    assert.equal(merged[1].manualQty, 300);
  });
});

describe('listOperationalDateKeysInRange', () => {
  it('lists consecutive operational days', () => {
    const keys = listOperationalDateKeysInRange(
      '2026-08-04T20:00:00+07:00',
      '2026-08-05T10:00:00+07:00',
      'Asia/Jakarta',
      DEFAULT_OPERATIONAL_DAY_START
    );
    assert.deepEqual(keys, ['2026-08-04', '2026-08-05']);
  });
});

describe('currentOperationalDateKey', () => {
  it('uses operational roll not midnight', () => {
    const key = currentOperationalDateKey(
      new Date('2026-08-04T04:00:00+07:00').getTime(),
      'Asia/Jakarta',
      DEFAULT_OPERATIONAL_DAY_START
    );
    assert.equal(key, '2026-08-03');
  });
});

function mockDbForCargoSummary({ atgTankIds = new Set(), atgDelta = 500 }) {
  return {
    query: async (sql, params) => {
      if (sql.includes('tank_gauging_tank_map')) {
        const tankId = Number(params[0]);
        return { rows: atgTankIds.has(tankId) ? [{ 1: 1 }] : [] };
      }
      return { rows: [] };
    },
    _atgDelta: atgDelta,
    async computeAtg() {
      return {
        ok: true,
        incomplete: false,
        sumDeltaMass: atgDelta,
        tanks: [],
      };
    },
  };
}

describe('summarizeCargoProgressContext', () => {
  const baseCtx = {
    operationId: 1,
    timezone: 'Asia/Jakarta',
    dayStartTime: DEFAULT_OPERATIONAL_DAY_START,
    commodityType: 'Liquid',
    siQty: 5000,
    siMetric: 'MT',
    lines: [],
  };

  it('returns null when no tank-connected lines', async () => {
    const db = mockDbForCargoSummary({});
    const result = await summarizeCargoProgressContext(db, {
      ...baseCtx,
      lines: [{ id: 1, qty: 100, startedAt: '2026-08-04T08:00:00+07:00', endedAt: null, tankIds: [] }],
    });
    assert.equal(result, null);
  });

  it('returns null when tanks assigned but cargo not started', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const result = await summarizeCargoProgressContext(db, {
      ...baseCtx,
      lines: [{ id: 1, qty: null, startedAt: null, endedAt: null, tankIds: [42], atgQtyMode: 'auto' }],
    });
    assert.equal(result, null);
  });

  it('sums closed manual segment qty', async () => {
    const db = mockDbForCargoSummary({});
    const result = await summarizeCargoProgressContext(db, {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 1530,
          manualQty: 1530,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T16:00:00+07:00',
          tankIds: [99],
        },
      ],
    });
    assert.ok(result);
    assert.equal(result.connected, true);
    assert.equal(result.source, 'manual');
    assert.equal(result.movedQty, 1530);
    assert.equal(result.completionPercent, 31);
    assert.equal(result.isLive, false);
  });

  it('sums closed ATG segment qty from saved line qty', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const result = await summarizeCargoProgressContext(db, {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 890,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T16:00:00+07:00',
          tankIds: [42],
        },
      ],
    });
    assert.ok(result);
    assert.equal(result.source, 'atg');
    assert.equal(result.movedQty, 890);
    assert.equal(result.completionPercent, 18);
  });

  it('computes live ATG delta for open segment', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const result = await summarizeCargoProgressContext(
      db,
      {
        ...baseCtx,
        siQty: 2100,
        lines: [
          {
            id: 1,
            qty: null,
            atgQtyMode: 'auto',
            startedAt: '2026-08-04T08:00:00+07:00',
            endedAt: null,
            tankIds: [42],
          },
        ],
      },
      {
        computeAtg: async () => ({
          ok: true,
          incomplete: false,
          sumDeltaMass: 420,
          tanks: [],
        }),
      }
    );
    assert.ok(result);
    assert.equal(result.source, 'atg');
    assert.equal(result.movedQty, 420);
    assert.equal(result.completionPercent, 20);
    assert.equal(result.isLive, true);
    assert.equal(result.hasActiveCargo, true);
  });

  it('reports hybrid when ATG and manual tanks present across lines', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const result = await summarizeCargoProgressContext(db, {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 500,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T12:00:00+07:00',
          tankIds: [42],
        },
        {
          id: 2,
          qty: 200,
          manualQty: 200,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T13:00:00+07:00',
          endedAt: '2026-08-04T16:00:00+07:00',
          tankIds: [99],
        },
      ],
    });
    assert.ok(result);
    assert.equal(result.source, 'hybrid');
    assert.equal(result.movedQty, 700);
  });
});

describe('resolveCanonicalMovedQty', () => {
  it('uses saved cargo summary when all segments are closed even if hourly under-reports', () => {
    const moved = resolveCanonicalMovedQty(
      { movedQty: 1797.008, hasActiveCargo: false },
      { movedQty: 403.794 },
      0
    );
    assert.equal(moved, 1797.008);
  });

  it('prefers hourly moved qty while a cargo segment is still open', () => {
    const moved = resolveCanonicalMovedQty(
      { movedQty: 500, hasActiveCargo: true },
      { movedQty: 763.2 },
      0
    );
    assert.equal(moved, 763.2);
  });

  it('falls back to closed line qty when cargo summary is absent', () => {
    assert.equal(resolveCanonicalMovedQty(null, { movedQty: 100 }, 850), 850);
  });
});

describe('buildScheduleComparisonFromCargoSummary', () => {
  it('uses hourly movedQty override when provided on cargo summary', () => {
    const ctx = {
      openingHatchStartAt: '2026-08-27T09:00:00+07:00',
      tbAt: '2026-08-27T09:00:00+07:00',
      dockingStartTime: null,
      etcAt: '2026-09-02T22:00:00+07:00',
      siMetric: 'MT',
      lines: [],
    };
    const nowMs = new Date('2026-08-31T10:00:00+07:00').getTime();
    const cmp = buildScheduleComparisonFromCargoSummary(
      ctx,
      { movedQty: 3803, siQty: 3001.443 },
      nowMs
    );
    assert.equal(cmp.movedQty, 3803);
    assert.equal(cmp.siQty, 3001.443);
    assert.equal(cmp.actualPercent, 100);
  });
});

describe('computeCompletionFromMovedQty integration', () => {
  it('re-exports SI variance helpers from hourly module', async () => {
    const { computeCompletionFromMovedQty } = await import('./atg-hourly-progress.js');
    const over = computeCompletionFromMovedQty(10050, 10000);
    assert.equal(over.completionPercent, 100);
    assert.equal(over.siQtyVariance?.kind, 'over');
    const under = computeCompletionFromMovedQty(9900, 10000);
    assert.equal(under.completionPercent, 99);
    assert.equal(under.siQtyVariance?.kind, 'under');
  });
});
