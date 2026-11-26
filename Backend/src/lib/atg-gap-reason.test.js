import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleGapSources } from './atg-gap-reason.js';

const MIN = 60000;
const START = Date.parse('2026-11-25T14:30:00Z');
const END = Date.parse('2026-11-26T05:37:00Z');

function polls(fromMs, toMs) {
  const out = [];
  for (let t = fromMs; t <= toMs; t += 15 * MIN) out.push(new Date(t));
  return out;
}

const bt1 = { sourceBaseUrl: 'http://172.16.250.15', sourceLabel: 'NXA820_BT_1' };
const bt3 = { sourceBaseUrl: 'http://172.16.11.77', sourceLabel: 'NXA820_BT_3' };

describe('assembleGapSources', () => {
  it('returns nothing when every tank has continuous samples', () => {
    const samplesByTank = new Map([[27, polls(START, END)]]);
    const out = assembleGapSources({
      tanks: [{ tankId: 27, code: '3203', ...bt1 }],
      samplesByTank,
      startAt: new Date(START),
      endAt: new Date(END),
    });
    assert.deepEqual(out, []);
  });

  it('reports the missing range under the tank source', () => {
    const samples = [
      ...polls(START, START + 60 * MIN),
      ...polls(START + 9 * 60 * MIN, END),
    ];
    const out = assembleGapSources({
      tanks: [{ tankId: 27, code: '3203', ...bt1 }],
      samplesByTank: new Map([[27, samples]]),
      startAt: new Date(START),
      endAt: new Date(END),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'NXA820_BT_1');
    assert.deepEqual(out[0].tankCodes, ['3203']);
    assert.equal(out[0].gaps.length, 1);
    assert.ok(out[0].gaps[0].durationMinutes >= 450);
  });

  it('groups tanks on the same source and keeps other sources apart', () => {
    const gappy = [...polls(START, START + 60 * MIN), ...polls(START + 9 * 60 * MIN, END)];
    const full = polls(START, END);
    const out = assembleGapSources({
      tanks: [
        { tankId: 27, code: '3203', ...bt1 },
        { tankId: 28, code: '3502', ...bt1 },
        { tankId: 1, code: '5104', ...bt3 },
      ],
      samplesByTank: new Map([
        [27, gappy],
        [28, gappy],
        [1, full],
      ]),
      startAt: new Date(START),
      endAt: new Date(END),
    });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].tankCodes, ['3203', '3502']);
    assert.equal(out[0].gaps.length, 1);
  });

  it('treats a tank with no samples as one gap over the whole window', () => {
    const out = assembleGapSources({
      tanks: [{ tankId: 27, code: '3203', ...bt1 }],
      samplesByTank: new Map(),
      startAt: new Date(START),
      endAt: new Date(END),
    });
    assert.equal(out[0].gaps.length, 1);
    assert.equal(out[0].gaps[0].startAt, new Date(START).toISOString());
  });
});
