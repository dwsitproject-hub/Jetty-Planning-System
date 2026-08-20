/**
 * Shared time axis for cargo movement board rows.
 */

/**
 * @param {string|number} fromIso
 * @param {string|number} toIso
 * @param {number} widthPx
 */
export function createCargoMovementTimeScale(fromIso, toIso, widthPx) {
  const fromMs = Date.parse(String(fromIso));
  const toMs = Date.parse(String(toIso));
  const span = toMs - fromMs;
  const width = Math.max(Number(widthPx) || 0, 1);

  return {
    fromMs,
    toMs,
    span: span > 0 ? span : 1,
    width,
    toX(ms) {
      const t = Number(ms);
      if (!Number.isFinite(t)) return 0;
      const clamped = Math.max(fromMs, Math.min(toMs, t));
      return ((clamped - fromMs) / (span > 0 ? span : 1)) * width;
    },
    toMsFromX(x) {
      const ratio = Math.max(0, Math.min(1, Number(x) / width));
      return fromMs + ratio * (span > 0 ? span : 1);
    },
  };
}

/**
 * Detect overlapping segments (same tank, time overlap).
 * @param {Array<{ startAt: string|null, endAt: string|null, loadLineId: string }>} segments
 * @param {number} [nowMs]
 * @returns {Map<string, number>} loadLineId → lane index
 */
export function assignSegmentLanes(segments, nowMs = Date.now()) {
  const laneById = new Map();
  const lanes = [];

  const sorted = [...segments].sort((a, b) => {
    const ta = a.startAt ? Date.parse(a.startAt) : 0;
    const tb = b.startAt ? Date.parse(b.startAt) : 0;
    return ta - tb;
  });

  for (const seg of sorted) {
    const start = seg.startAt ? Date.parse(seg.startAt) : 0;
    const end = seg.endAt ? Date.parse(seg.endAt) : nowMs;
    if (!Number.isFinite(start)) continue;

    let lane = 0;
    while (true) {
      if (!lanes[lane]) {
        lanes[lane] = [];
      }
      const overlaps = lanes[lane].some((other) => {
        const oStart = other.startAt ? Date.parse(other.startAt) : 0;
        const oEnd = other.endAt ? Date.parse(other.endAt) : nowMs;
        return start < oEnd && end > oStart;
      });
      if (!overlaps) break;
      lane += 1;
    }
    lanes[lane].push(seg);
    laneById.set(seg.loadLineId, lane);
  }

  return laneById;
}

/**
 * Split sample series into contiguous runs separated by gaps.
 * @param {Array<{ sampledAt: string, totalMass: number }>} samples
 * @param {number} [gapMs=120000] — default 2× typical poll interval
 */
export function splitSampleRuns(samples, gapMs = 120_000) {
  if (!samples?.length) return [];
  const runs = [];
  let run = [samples[0]];

  for (let i = 1; i < samples.length; i += 1) {
    const prev = Date.parse(samples[i - 1].sampledAt);
    const cur = Date.parse(samples[i].sampledAt);
    if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev > gapMs) {
      runs.push(run);
      run = [samples[i]];
    } else {
      run.push(samples[i]);
    }
  }
  runs.push(run);
  return runs;
}
