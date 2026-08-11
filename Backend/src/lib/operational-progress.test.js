import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildManualDailyBarsForLine,
  mergeDailyBars,
  resolveLineMode,
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
