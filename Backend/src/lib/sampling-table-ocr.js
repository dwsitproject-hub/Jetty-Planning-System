/**
 * Cell-based OCR for the "Update Quality CPO Incoming Barges" quality report.
 *
 * Whole-page OCR is unusable on these reports: every cell is boxed, and tesseract reads
 * the borders as glyphs ("ap | sw | ox || as | sw"). Reading each cell in isolation with a
 * numeric whitelist is accurate instead, because the report is a ruled grid — the same
 * borders that defeat page OCR are what let us locate the cells.
 *
 * The reports are also ragged: one sample has three tables of 4, 4 and 8 rows, so
 * horizontal rules do not span the page. Rules are therefore detected per column strip
 * rather than globally.
 *
 * This reader only ever omits rows, it does not invent them: a cell has to read as a palka
 * label followed by two well-formed metrics to be accepted.
 */
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

/** Width the grid is detected at; keeps thresholds independent of upload size. */
const DETECT_WIDTH = 2048;
/** Width cells are OCR'd at. WhatsApp ships 1024px screenshots, which need ~6x to read. */
const OCR_WIDTH = 6144;
const OCR_MAX_PIXELS = 32_000_000;
/** Below this grey value a pixel counts as ink. */
const INK = 140;
/** A column strip must be at least this wide to hold a value. */
const MIN_STRIP = 14;
/** Guards runtime: each cell is a separate OCR call. */
const MAX_CELLS = 420;
/** Shortest unbroken run accepted as a vertical rule, at DETECT_WIDTH. */
const MIN_RULE_RUN = 35;
/** How far inside its rules a cell is cropped, at DETECT_WIDTH. */
const CELL_INSET = 5;
/** Ink from every cell is scaled to this height so glyph size never varies. */
const GLYPH_HEIGHT = 110;
const GLYPH_MARGIN = 45;

const PALKA_CELL_RE = /^(\d{1,2})\s*([PSC])$/i;

/** Returned whenever the grid cannot be read, so the caller falls back to page OCR. */
const EMPTY_READ = Object.freeze({ records: [], summary: {} });

/** Adjacent indices collapsed to a single centre, so a 2px rule yields one line. */
function collapse(indices) {
  const groups = [];
  for (const i of indices) {
    const last = groups[groups.length - 1];
    if (last && i - last[last.length - 1] <= 2) last.push(i);
    else groups.push([i]);
  }
  return groups.map((g) => Math.round((g[0] + g[g.length - 1]) / 2));
}

/**
 * Longest unbroken ink run along one axis, tolerating single-pixel gaps.
 *
 * Counting total ink cannot separate rules from text: a column of digits inks as many
 * pixels as a rule does. Run length can — a rule is continuous, glyphs are not.
 */
function longestRun(isInk, length) {
  let run = 0;
  let gap = 0;
  let best = 0;
  for (let i = 0; i < length; i++) {
    if (isInk(i)) {
      run += gap + 1;
      gap = 0;
      if (run > best) best = run;
    } else if (run && gap === 0) {
      gap = 1;
    } else {
      run = 0;
      gap = 0;
    }
  }
  return best;
}

/**
 * The FFA and Moisture columns always carry one integer digit and two decimals, so a
 * three-digit read is a dropped decimal point ("025" is 0.25). Anything else is refused
 * rather than guessed.
 */
export function normaliseMetricCell(raw) {
  const t = String(raw ?? '').replace(/[^\d.]/g, '');
  if (/^\d\.\d{2}$/.test(t)) return t;
  if (/^\d{3}$/.test(t)) return `${t[0]}.${t.slice(1)}`;
  return null;
}

/**
 * Metrics inside one cell. Usually one, but when a column rule is too faint to detect,
 * FFA and Moisture land in the same cell and both are recovered.
 */
export function metricsInCell(text) {
  return String(text ?? '')
    .split(/[^\d.]+/)
    .filter(Boolean)
    .map(normaliseMetricCell)
    .filter(Boolean);
}

/**
 * Summary-box values are not bound to one integer digit the way the columns are — an
 * iodine value reads 52.11 — so they take the decimal point as written.
 */
function parseSummaryMetric(text) {
  const m = String(text ?? '').match(/\d{1,3}[.,]\d{1,2}/);
  return m ? m[0].replace(',', '.') : null;
}

/** Labels in the summary box, in the order they are reported back. */
const SUMMARY_LABELS = [
  ['statedAvgFfa', /FFA\s*A[vy]erage/i],
  ['statedAvgMoisture', /Mo?ist(ure)?\s*A[vy]erage/i],
  ['dobi', /\bDOB[I1]\b/i],
  ['iodineValue', /[Il1]odine\s*Va[lI]ue/i],
];

/** @returns {{ vLines: number[], cells: Array<{strip:number,y0:number,y1:number,x0:number,x1:number}> }} */
function detectGrid(data, width, height) {
  const vIdx = [];
  for (let x = 0; x < width; x++) {
    const run = longestRun((y) => data[y * width + x] < INK, height);
    if (run >= Math.max(MIN_RULE_RUN, height * 0.04)) vIdx.push(x);
  }
  const vLines = collapse(vIdx);

  const strips = [];
  for (let s = 0; s + 1 < vLines.length; s++) {
    const x0 = vLines[s];
    const x1 = vLines[s + 1];
    const span = x1 - x0 - 4;
    if (span < MIN_STRIP || x1 - x0 > width * 0.5) continue;

    // Within one strip a horizontal rule runs nearly the full width of that strip.
    const hIdx = [];
    for (let y = 0; y < height; y++) {
      const run = longestRun((i) => data[y * width + (x0 + 2 + i)] < INK, span);
      if (run >= span * 0.8) hIdx.push(y);
    }
    strips.push({ s, x0, x1, hLines: collapse(hIdx) });
  }

  // A row rule belongs to the whole table, so a rule too faint to register in one column
  // can be recovered from the columns beside it. Without this, two rows merge into one
  // cell and both are lost.
  const pooled = [];
  for (const strip of strips) {
    for (const y of strip.hLines) {
      const near = pooled.find((p) => Math.abs(p - y) <= 3);
      if (near === undefined) pooled.push(y);
    }
  }
  pooled.sort((a, b) => a - b);

  const cells = [];
  for (const strip of strips) {
    if (!strip.hLines.length) continue;
    const lo = strip.hLines[0];
    const hi = strip.hLines[strip.hLines.length - 1];
    const lines = splitOversizedBands(pooled.filter((y) => y >= lo && y <= hi));
    for (let r = 0; r + 1 < lines.length; r++) {
      const y0 = lines[r];
      const y1 = lines[r + 1];
      const h = y1 - y0;
      if (h < 10 || h > 120) continue;
      cells.push({ strip: strip.s, x0: strip.x0, x1: strip.x1, y0, y1 });
    }
  }
  return { vLines, cells };
}

/**
 * Rows in a table share one pitch, so a band that measures a whole multiple of that pitch
 * is really several rows whose divider went undetected everywhere. Splitting it back up
 * only proposes cells — OCR still has to read something out of them.
 */
export function splitOversizedBands(lines) {
  const gaps = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const g = lines[i + 1] - lines[i];
    if (g >= 10 && g <= 120) gaps.push(g);
  }
  if (gaps.length < 2) return lines;
  gaps.sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 2)];
  if (!pitch) return lines;

  const out = [lines[0]];
  for (let i = 0; i + 1 < lines.length; i++) {
    const y0 = lines[i];
    const y1 = lines[i + 1];
    const n = Math.round((y1 - y0) / pitch);
    if (n >= 2 && n <= 8 && Math.abs(y1 - y0 - n * pitch) <= pitch * 0.25) {
      for (let j = 1; j < n; j++) out.push(Math.round(y0 + ((y1 - y0) * j) / n));
    }
    out.push(y1);
  }
  return out;
}

/**
 * Walk right from a palka label to the first two readable metrics on the same row,
 * stopping at the next palka label so tables are never pooled together.
 */
function metricsRightOf(label, byStrip, stripCount) {
  const mid = (label.y0 + label.y1) / 2;
  const found = [];
  for (let s = label.strip + 1; s <= label.strip + 5 && s < stripCount; s++) {
    const candidates = byStrip.get(s);
    if (!candidates) continue;
    const cell = candidates.find((c) => mid >= c.y0 && mid <= c.y1);
    if (!cell) continue;
    if (PALKA_CELL_RE.test(cell.text.replace(/\s+/g, ''))) break;
    for (const metric of metricsInCell(cell.text)) {
      found.push(metric);
      if (found.length === 2) return found;
    }
  }
  return found.length === 2 ? found : null;
}

/**
 * Read per-palka rows and the summary box out of a photographed or scanned quality report.
 * Returns no records when the grid cannot be found, leaving the caller on page OCR.
 *
 * @param {Buffer} buffer original upload
 * @returns {Promise<{ records: Array<{noPalka:string,ffa:string,moisture:string}>,
 *   summary: { statedAvgFfa?: string, statedAvgMoisture?: string, dobi?: string,
 *     iodineValue?: string } }>}
 */
export async function readSamplingTableFromImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) return EMPTY_READ;

  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .resize({ width: DETECT_WIDTH })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { vLines, cells } = detectGrid(data, info.width, info.height);
  if (!cells.length || cells.length > MAX_CELLS) return EMPTY_READ;

  const ocrWidth = Math.min(
    OCR_WIDTH,
    Math.max(info.width, Math.floor(Math.sqrt((OCR_MAX_PIXELS * info.width) / info.height)))
  );
  const big = await sharp(buffer, { failOn: 'none' })
    .resize({ width: ocrWidth })
    .greyscale()
    .png()
    .toBuffer();
  const bigMeta = await sharp(big).metadata();
  const k = bigMeta.width / info.width;

  /**
   * Crop a cell well inside its rules, trim to the ink, then scale the ink to a fixed
   * height on a white margin. Tesseract reads a small glyph adrift in a wide cell far
   * worse than the same glyph normalised this way — that alone was the difference
   * between "5P" reading as nothing and reading correctly. Returns null for a cell with
   * no ink, which also saves an OCR call.
   */
  async function normaliseCell(cell) {
    const rect = {
      left: Math.round((cell.x0 + CELL_INSET) * k),
      top: Math.round((cell.y0 + CELL_INSET) * k),
      width: Math.round((cell.x1 - cell.x0 - CELL_INSET * 2) * k),
      height: Math.round((cell.y1 - cell.y0 - CELL_INSET * 2) * k),
    };
    if (rect.left < 0 || rect.top < 0 || rect.width < 10 || rect.height < 10) return null;
    if (rect.left + rect.width > bigMeta.width) return null;
    if (rect.top + rect.height > bigMeta.height) return null;
    try {
      const cropped = await sharp(big).extract(rect).png().toBuffer();
      const trimmed = await sharp(cropped)
        .trim({ background: '#ffffff', threshold: 40 })
        .png()
        .toBuffer({ resolveWithObject: true });
      if (trimmed.info.width < 8 || trimmed.info.height < 8) return null;
      return await sharp(trimmed.data)
        .resize({ height: GLYPH_HEIGHT, fit: 'inside', kernel: 'lanczos3' })
        .extend({
          top: GLYPH_MARGIN,
          bottom: GLYPH_MARGIN,
          left: GLYPH_MARGIN,
          right: GLYPH_MARGIN,
          background: '#ffffff',
        })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }

  const worker = await createWorker('eng', undefined, { logger: () => {} });
  const read = [];
  try {
    const ocr = async (img) => {
      try {
        const res = await worker.recognize(img);
        // Spaces are kept: they are what separates two metrics sharing one cell.
        return (res?.data?.text || '').trim().replace(/\s+/g, ' ');
      } catch {
        return '';
      }
    };

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: '0123456789.PSC',
      user_defined_dpi: '300',
    });
    for (const cell of cells) {
      const img = await normaliseCell(cell);
      if (!img) {
        read.push({ ...cell, text: '', img: null });
        continue;
      }
      read.push({ ...cell, text: await ocr(img), img });
    }

    // Values read reliably; it is the palka labels that drop characters. Those cells get a
    // second look as a single word, with the decimal point out of the whitelist so a label
    // cannot come back as a number. Re-reading beats inferring a label from its
    // neighbours: a mislabelled row would file correct readings against the wrong palka.
    const perStrip = new Map();
    for (const c of read) {
      if (!PALKA_CELL_RE.test(c.text.replace(/\s+/g, ''))) continue;
      perStrip.set(c.strip, (perStrip.get(c.strip) || 0) + 1);
    }
    const labelStrips = new Set([...perStrip].filter(([, n]) => n >= 2).map(([s]) => s));

    const retry = read.filter(
      (c) => c.img && labelStrips.has(c.strip) && !PALKA_CELL_RE.test(c.text.replace(/\s+/g, ''))
    );
    if (retry.length) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
        tessedit_char_whitelist: '0123456789PSC',
        user_defined_dpi: '300',
      });
      for (const cell of retry) {
        const text = await ocr(cell.img);
        if (PALKA_CELL_RE.test(text.replace(/\s+/g, ''))) cell.text = text;
      }
    }

    // The summary box ("FFA Average", "DOBI", "Iodine Value") is boxed too, so page OCR
    // garbles it. Its label column is far wider than a value column, which is enough to
    // find it; those cells are re-read with letters allowed.
    const wide = read.filter((c) => c.img && c.x1 - c.x0 >= info.width * 0.12);
    if (wide.length) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: '',
        user_defined_dpi: '300',
      });
      for (const cell of wide) cell.labelText = await ocr(cell.img);
    }
  } finally {
    await worker.terminate();
  }
  for (const c of read) delete c.img;

  const byStrip = new Map();
  for (const c of read) {
    if (!byStrip.has(c.strip)) byStrip.set(c.strip, []);
    byStrip.get(c.strip).push(c);
  }

  const records = [];
  const seen = new Set();
  for (const cell of consistentLabels(read)) {
    const noPalka = `${cell.num}${cell.suffix}`;
    if (seen.has(noPalka)) continue;
    const metrics = metricsRightOf(cell, byStrip, vLines.length);
    if (!metrics) continue;
    seen.add(noPalka);
    records.push({ noPalka, ffa: metrics[0], moisture: metrics[1] });
  }

  return { records, summary: readSummary(read, byStrip, vLines.length) };
}

/** Pair each summary label with the first value to its right on the same row. */
function readSummary(read, byStrip, stripCount) {
  const summary = {};
  for (const cell of read) {
    if (!cell.labelText) continue;
    const hit = SUMMARY_LABELS.find(([key, re]) => !summary[key] && re.test(cell.labelText));
    if (!hit) continue;
    const mid = (cell.y0 + cell.y1) / 2;
    for (let s = cell.strip + 1; s <= cell.strip + 3 && s < stripCount; s++) {
      const found = (byStrip.get(s) || []).find((c) => mid >= c.y0 && mid <= c.y1);
      const value = found && parseSummaryMetric(found.text);
      if (value) {
        summary[hit[0]] = value;
        break;
      }
    }
  }
  return summary;
}

/**
 * Keep only labels that agree with the column they sit in. A label column carries one
 * suffix and counts upwards, so an odd suffix or a number that fails to increase is a
 * misread and the row is dropped.
 *
 * This is the check that matters most for trust: without it a "2S" misread as "1S" would
 * file 2S's readings against 1S, which is worse than reporting nothing at all.
 */
export function consistentLabels(read) {
  const byStrip = new Map();
  for (const cell of read) {
    const m = PALKA_CELL_RE.exec(String(cell.text).replace(/\s+/g, ''));
    if (!m) continue;
    const entry = { ...cell, num: Number(m[1]), suffix: m[2].toUpperCase() };
    if (!byStrip.has(cell.strip)) byStrip.set(cell.strip, []);
    byStrip.get(cell.strip).push(entry);
  }

  const kept = [];
  for (const labels of byStrip.values()) {
    const tally = new Map();
    for (const l of labels) tally.set(l.suffix, (tally.get(l.suffix) || 0) + 1);
    const [dominant] = [...tally].sort((a, b) => b[1] - a[1])[0];

    const ordered = labels.filter((l) => l.suffix === dominant).sort((a, b) => a.y0 - b.y0);
    kept.push(...longestIncreasingRun(ordered));
  }
  return kept;
}

/**
 * The largest subset of labels that still counts upwards. Taking them greedily from the
 * top instead would let one misread near the top discard every row beneath it.
 */
function longestIncreasingRun(labels) {
  const n = labels.length;
  if (n < 2) return labels;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (labels[j].num < labels[i].num && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (len[i] > len[best]) best = i;
  }
  const out = [];
  for (let i = best; i >= 0; i = prev[i]) out.push(labels[i]);
  return out.reverse();
}
