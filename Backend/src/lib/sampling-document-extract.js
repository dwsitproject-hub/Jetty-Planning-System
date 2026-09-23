/**
 * Extract per-palka sampling quality values (FFA / Moisture) from an operator-supplied
 * quality report — Excel workbook, PDF with a text layer, or a raster scan/photo.
 *
 * Reports such as "Update Quality CPO Incoming Barges" lay the palka rows out in two
 * side-by-side blocks (1P-4P and 1S-4S) plus a summary block, so both the workbook scan
 * and the text scan look for every table anchor rather than the first one.
 *
 * Values are a data-entry aid only: the operator reviews and confirms them before they
 * reach the sampling form.
 */
import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import { PSM } from 'tesseract.js';
import { extractRawTextFromBuffer, parseLooseDateToYmd } from './si-document-extract.js';
import { readSamplingTableFromImage } from './sampling-table-ocr.js';

/** Mirrors upload-mime's allowlist, plus xlsx which is the native format of these reports. */
const SUPPORTED_FOR_EXTRACT = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Bounds on how much of a sheet we scan, so a pathological file cannot stall the request. */
const MAX_SCAN_ROWS = 400;
const MAX_SCAN_COLS = 60;
/** Palka column width limit matches MAX_SAMPLING_PALKA_FIELD_CHARS on the client. */
const MAX_PALKA_CHARS = 20;
const MAX_RECORDS = 60;
/** Percentages; wide enough for any real cargo, tight enough to reject OCR noise. */
const METRIC_MIN = 0;
const METRIC_MAX = 100;

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/* ------------------------------------------------------------------ shared helpers */

/** @param {unknown} v */
function normText(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Numbers arrive as "5.47", "5,47" (Indonesian decimal comma) or a real number. Also used
 * on the save path, where Postgres hands back numeric columns as strings.
 * @returns {number|null}
 */
export function toMetricNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const s = normText(raw).replace(/%/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Keeps the report's own precision (usually 2dp) without float artefacts. */
export function metricToString(n) {
  const rounded = Math.round(n * 1000) / 1000;
  const trimmed = rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const decimals = (trimmed.split('.')[1] || '').length;
  return decimals >= 2 ? trimmed : rounded.toFixed(2);
}

function inMetricRange(n) {
  return n != null && n >= METRIC_MIN && n <= METRIC_MAX;
}

/**
 * Accepts a metric only when both FFA and Moisture parse and sit in range, so a half-read
 * row is dropped rather than silently filled with a wrong number.
 */
function buildRecord(palkaRaw, ffaRaw, moistureRaw) {
  const noPalka = normalizePalka(palkaRaw);
  if (!noPalka) return null;
  const ffa = toMetricNumber(ffaRaw);
  const moisture = toMetricNumber(moistureRaw);
  if (!inMetricRange(ffa) || !inMetricRange(moisture)) return null;
  return { noPalka, ffa: metricToString(ffa), moisture: metricToString(moisture) };
}

/**
 * Palka ids look like "1P", "2S", "10". Reject label text that shares the column
 * ("Average", "Total") and anything too long for the form field.
 */
function normalizePalka(raw) {
  const s = normText(raw).toUpperCase().replace(/^NO\.?\s*/, '');
  if (!s || s.length > MAX_PALKA_CHARS) return null;
  if (!/\d/.test(s)) return null;
  if (/AVERAGE|TOTAL|QUALITY|PALKA|DOBI|IODINE|MOIST|FFA/.test(s)) return null;
  if (!/^\d{1,3}\s*[A-Z]{0,2}$/.test(s)) return null;
  return s.replace(/\s+/g, '');
}

/**
 * Report headers use "25-Aug-26" style dates, which the SI numeric/long-form date helper
 * does not cover, so try month-name-with-separators first and fall back to it.
 * @returns {string|null} YYYY-MM-DD
 */
export function parseSamplingDate(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = normText(raw);
  if (!s) return null;

  const named = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{2,4})$/);
  if (named) {
    const day = parseInt(named[1], 10);
    const month = MONTHS[named[2].toLowerCase()];
    let year = parseInt(named[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month && day >= 1 && day <= 31 && year >= 1990 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return parseLooseDateToYmd(s);
}

/* ------------------------------------------------------------------ workbook parsing */

/** ExcelJS cell values may be rich text, formula results, hyperlinks or dates. */
function cellToText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return normText(value.richText.map((r) => r?.text ?? '').join(''));
    }
    if ('result' in value) return normText(value.result);
    if ('text' in value) return normText(value.text);
    if ('hyperlink' in value) return normText(value.hyperlink);
    return '';
  }
  return normText(value);
}

/**
 * Snapshot a worksheet as a bounded grid of raw values plus their normalised text, so the
 * anchor scan can look in any direction without repeated ExcelJS lookups.
 */
function sheetToGrid(sheet) {
  const rowCount = Math.min(sheet.rowCount || 0, MAX_SCAN_ROWS);
  const colCount = Math.min(sheet.columnCount || 0, MAX_SCAN_COLS);
  const text = [];
  const values = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const textRow = [];
    const valueRow = [];
    const row = sheet.getRow(r);
    for (let c = 1; c <= colCount; c += 1) {
      const v = row.getCell(c).value;
      valueRow.push(v);
      textRow.push(cellToText(v));
    }
    text.push(textRow);
    values.push(valueRow);
  }
  return { text, values, rowCount, colCount };
}

/** @returns {string} '' when out of bounds */
function gridText(grid, r, c) {
  return grid.text[r]?.[c] ?? '';
}

/**
 * Find a label cell and return the first meaningful value to its right, skipping the
 * separator ":" cell these templates put between label and value.
 * @returns {{ text: string, value: unknown }|null}
 */
function findLabeledValue(grid, labelRe, maxRight = 6) {
  for (let r = 0; r < grid.rowCount; r += 1) {
    for (let c = 0; c < grid.colCount; c += 1) {
      const cell = gridText(grid, r, c);
      if (!cell || !labelRe.test(cell)) continue;
      // Some templates put "Label : value" in one cell.
      const inline = cell.split(':').slice(1).join(':').trim();
      if (inline) return { text: inline, value: inline };
      for (let k = 1; k <= maxRight && c + k < grid.colCount; k += 1) {
        const t = gridText(grid, r, c + k);
        if (!t || t === ':' || t === '-') continue;
        return { text: t, value: grid.values[r]?.[c + k] };
      }
    }
  }
  return null;
}

/**
 * Locate the FFA and Moisture columns belonging to one "No. Palka" anchor. The template
 * merges a "Quality" cell across both, so the labels sit a row or two below the anchor and
 * ExcelJS reports merged neighbours with the master's text.
 * @returns {{ ffaCol: number, moistureCol: number, dataStartRow: number }|null}
 */
function resolveAnchorColumns(grid, anchorRow, anchorCol) {
  let ffaCol = -1;
  let moistureCol = -1;
  let labelRow = anchorRow;
  for (let dr = 0; dr <= 2; dr += 1) {
    for (let dc = 1; dc <= 5; dc += 1) {
      const t = gridText(grid, anchorRow + dr, anchorCol + dc);
      if (!t) continue;
      if (ffaCol === -1 && /ffa/i.test(t) && !/average/i.test(t)) {
        ffaCol = anchorCol + dc;
        labelRow = Math.max(labelRow, anchorRow + dr);
      } else if (moistureCol === -1 && /moist/i.test(t) && !/average/i.test(t)) {
        moistureCol = anchorCol + dc;
        labelRow = Math.max(labelRow, anchorRow + dr);
      }
    }
    if (ffaCol !== -1 && moistureCol !== -1) break;
  }
  if (ffaCol === -1 || moistureCol === -1) return null;
  return { ffaCol, moistureCol, dataStartRow: labelRow + 1 };
}

/**
 * Read palka rows under one anchor until the palka column runs out. Stops at the first
 * blank so a following block in the same columns is not absorbed.
 */
function readAnchorRecords(grid, anchorRow, anchorCol) {
  const cols = resolveAnchorColumns(grid, anchorRow, anchorCol);
  if (!cols) return [];
  const out = [];
  for (let r = cols.dataStartRow; r < grid.rowCount; r += 1) {
    const palkaText = gridText(grid, r, anchorCol);
    if (!palkaText) break;
    const rec = buildRecord(
      palkaText,
      grid.values[r]?.[cols.ffaCol] ?? gridText(grid, r, cols.ffaCol),
      grid.values[r]?.[cols.moistureCol] ?? gridText(grid, r, cols.moistureCol)
    );
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Parse per-palka records and header/summary values out of an xlsx buffer.
 * @param {Buffer} buffer
 */
export async function parseSamplingWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const records = [];
  const seen = new Set();
  let documentDate = null;
  let vesselName = null;
  let dobi = null;
  let iodineValue = null;
  let statedAvgFfa = null;
  let statedAvgMoisture = null;

  workbook.eachSheet((sheet) => {
    const grid = sheetToGrid(sheet);

    for (let r = 0; r < grid.rowCount; r += 1) {
      for (let c = 0; c < grid.colCount; c += 1) {
        if (!/^no\.?\s*palka$/i.test(gridText(grid, r, c))) continue;
        for (const rec of readAnchorRecords(grid, r, c)) {
          if (seen.has(rec.noPalka) || records.length >= MAX_RECORDS) continue;
          seen.add(rec.noPalka);
          records.push(rec);
        }
      }
    }

    if (!documentDate) {
      const hit = findLabeledValue(grid, /^(date|tanggal|tgl\.?)\b/i);
      if (hit) documentDate = parseSamplingDate(hit.value ?? hit.text);
    }
    if (!vesselName) {
      const hit = findLabeledValue(grid, /^(vessel|barge)s?\s*(\/\s*barges?)?\s*name\b|^vessel\s*\/\s*barges/i);
      if (hit) vesselName = hit.text.slice(0, 120) || null;
    }
    if (!dobi) {
      const hit = findLabeledValue(grid, /^dobi\b/i);
      const n = hit ? toMetricNumber(hit.value ?? hit.text) : null;
      if (n != null) dobi = metricToString(n);
    }
    if (!iodineValue) {
      const hit = findLabeledValue(grid, /iodine\s*value/i);
      const n = hit ? toMetricNumber(hit.value ?? hit.text) : null;
      if (n != null) iodineValue = metricToString(n);
    }
    if (statedAvgFfa == null) {
      const hit = findLabeledValue(grid, /ffa\s*average|average\s*ffa/i);
      const n = hit ? toMetricNumber(hit.value ?? hit.text) : null;
      if (n != null) statedAvgFfa = n;
    }
    if (statedAvgMoisture == null) {
      const hit = findLabeledValue(grid, /moist(ure)?\s*average|average\s*moist(ure)?/i);
      const n = hit ? toMetricNumber(hit.value ?? hit.text) : null;
      if (n != null) statedAvgMoisture = n;
    }
  });

  return { records, documentDate, vesselName, dobi, iodineValue, statedAvgFfa, statedAvgMoisture };
}

/* ------------------------------------------------------------------ text parsing */

/** Horizontal separators only — keeps a match inside one visual line. */
const SEP = '[ \\t|:.]{1,12}';
const DEC = '(\\d{1,3}[.,]\\d{1,3})';

/**
 * Every "<palka> <ffa> <moisture>" group in the text. The report's two side-by-side tables
 * flatten into a single line per visual row ("1P 5.47 0.38 1S 5.47 0.25"), so this is a
 * global scan rather than one match per line.
 */
const PALKA_ROW_RE = new RegExp(
  `\\b(\\d{1,3}[ \\t]?[A-Za-z]{1,2})\\b${SEP}${DEC}${SEP}${DEC}`,
  'g'
);

/** Fallback for templates whose palka column is bare numbers; anchored to whole lines. */
const NUMERIC_ROW_RE = new RegExp(`^[ \\t]*(\\d{1,3})${SEP}${DEC}${SEP}${DEC}[ \\t]*$`, 'gm');

/** First non-empty text after a label on the same line. */
function textAfterLabel(text, labelSource, maxLen = 160) {
  const re = new RegExp(`${labelSource}[ \\t]*[:.\\-]?[ \\t]*([^\\n]+)`, 'i');
  const m = text.match(re);
  if (!m?.[1]) return null;
  const v = normText(m[1]);
  if (!v) return null;
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function metricAfterLabel(text, labelSource) {
  const raw = textAfterLabel(text, labelSource, 40);
  if (!raw) return null;
  const m = raw.match(/(\d{1,3}[.,]\d{1,3})/);
  return m ? toMetricNumber(m[1]) : null;
}

/**
 * Parse per-palka records and header values out of PDF text or OCR output.
 * @param {string} rawText
 */
export function parseSamplingDocumentText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const records = [];
  const seen = new Set();

  const collect = (re, hasLetter) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (records.length >= MAX_RECORDS) break;
      const rec = buildRecord(m[1], m[2], m[3]);
      if (!rec || seen.has(rec.noPalka)) continue;
      // A bare-number fallback match must not contradict a lettered read.
      if (!hasLetter && [...seen].some((k) => k.replace(/[A-Z]+$/, '') === rec.noPalka)) continue;
      seen.add(rec.noPalka);
      records.push(rec);
    }
  };

  collect(PALKA_ROW_RE, true);
  if (!records.length) collect(NUMERIC_ROW_RE, false);

  // Word boundaries matter: "Update" contains "date", "Recived" contains "iv".
  const dateRaw = textAfterLabel(text, '(?:\\bDate\\b|\\bTanggal\\b|\\bTgl\\b\\.?)', 40);
  const documentDate = dateRaw ? parseSamplingDate(dateRaw.split(/\s{2,}|[;|]/)[0].trim()) : null;

  const vesselName = textAfterLabel(
    text,
    '(?:\\bVessel\\s*/?\\s*Barges?\\s*Name\\b|\\bVessel\\s*Name\\b|\\bBarges?\\s*Name\\b|\\bVessel\\b)',
    120
  );

  const dobiNum = metricAfterLabel(text, '\\bDOBI\\b');
  // OCR routinely reads the capital I of "Iodine" as a lowercase L.
  const iodineNum = metricAfterLabel(text, '(?:\\b[Il]odine\\s*Value\\b|\\bIV\\b)');

  return {
    records,
    documentDate,
    vesselName: vesselName || null,
    dobi: dobiNum != null ? metricToString(dobiNum) : null,
    iodineValue: iodineNum != null ? metricToString(iodineNum) : null,
    statedAvgFfa: metricAfterLabel(text, '(?:\\(%\\),?\\s*)?FFA\\s*Average'),
    statedAvgMoisture: metricAfterLabel(text, '(?:\\(%\\),?\\s*)?Moist(?:ure)?\\s*Average'),
  };
}

/* ------------------------------------------------------------------ entry point */

/**
 * Quality reports put the palka readings in a bordered table. Tesseract's default page
 * segmentation treats those borders as glyphs and returns junk for the data rows
 * (measured: 0 of 8 rows). Reading the page as a single column recovers them.
 */
const SAMPLING_OCR_PARAMS = { tessedit_pageseg_mode: PSM.SINGLE_COLUMN };

/**
 * Detect the file type by magic bytes and run the matching parser.
 * @param {Buffer} buffer
 * @throws {Error & { statusCode?: number }} 400 unsupported type, 422 unreadable content
 */
export async function runSamplingDocumentExtract(buffer) {
  const ft = await fileTypeFromBuffer(buffer);
  let mime = ft?.mime;
  // Some xlsx files are reported as plain zip; try the workbook parser before rejecting.
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    mime = WORKBOOK_MIME;
  }
  if (!mime || !SUPPORTED_FOR_EXTRACT.has(mime)) {
    const err = new Error('Unsupported file type for extraction (use Excel, PDF or an image).');
    err.statusCode = 400;
    throw err;
  }

  if (mime === WORKBOOK_MIME) {
    let fields;
    try {
      fields = await parseSamplingWorkbook(buffer);
    } catch {
      const err = new Error('Could not read this spreadsheet. Re-save it as .xlsx and try again.');
      err.statusCode = 422;
      throw err;
    }
    return { mime, source: 'xlsx', rawText: '', rawTextTruncated: false, fields };
  }

  const rawText = await extractRawTextFromBuffer(buffer, mime, { ocrParams: SAMPLING_OCR_PARAMS });
  if (mime === 'application/pdf' && (!rawText || rawText.length < 12)) {
    const err = new Error(
      'This PDF has very little selectable text (it may be a scan). Upload the Excel file, a PNG/JPEG scan, or a text-based PDF.'
    );
    err.statusCode = 422;
    throw err;
  }
  if (!rawText || rawText.length < 4) {
    const err = new Error(
      'Could not read enough text from this file. Try the Excel file or a clearer scan.'
    );
    err.statusCode = 422;
    throw err;
  }

  const fields = parseSamplingDocumentText(rawText);

  /*
   * Page OCR reads the header fine — those lines are plain text — but it cannot read the
   * palka tables, because every cell is boxed and tesseract reports the borders as glyphs.
   * Measured on three real reports, page OCR recovered 1 of 42 rows while reading the same
   * cells individually recovered 37, with no wrong values. So the header stays with the
   * page text and the rows come from the cell reader whenever it finds the grid.
   */
  if (mime.startsWith('image/')) {
    let table = null;
    try {
      table = await readSamplingTableFromImage(buffer);
    } catch {
      table = null;
    }
    const gridRecords = [];
    const seen = new Set();
    for (const r of table?.records || []) {
      const rec = buildRecord(r.noPalka, r.ffa, r.moisture);
      if (!rec || seen.has(rec.noPalka) || gridRecords.length >= MAX_RECORDS) continue;
      seen.add(rec.noPalka);
      gridRecords.push(rec);
    }
    if (gridRecords.length) fields.records = gridRecords;

    // Same story for the summary box: only fill what the page text could not supply.
    const summary = table?.summary || {};
    if (fields.dobi == null && summary.dobi) {
      const n = toMetricNumber(summary.dobi);
      if (n != null) fields.dobi = metricToString(n);
    }
    if (fields.iodineValue == null && summary.iodineValue) {
      const n = toMetricNumber(summary.iodineValue);
      if (n != null) fields.iodineValue = metricToString(n);
    }
    if (fields.statedAvgFfa == null) fields.statedAvgFfa = toMetricNumber(summary.statedAvgFfa);
    if (fields.statedAvgMoisture == null) {
      fields.statedAvgMoisture = toMetricNumber(summary.statedAvgMoisture);
    }
  }

  return {
    mime,
    source: mime === 'application/pdf' ? 'pdf_text' : 'ocr_image',
    rawText: rawText.length > 8000 ? `${rawText.slice(0, 8000)}…` : rawText,
    rawTextTruncated: rawText.length > 8000,
    fields,
  };
}

export { SUPPORTED_FOR_EXTRACT, WORKBOOK_MIME };
