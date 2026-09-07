/**
 * Sampling quality report parser smoke test: node scripts/test-sampling-document-parser.mjs
 *
 * Covers the "Update Quality CPO Incoming Barges" layout, which puts palka rows in two
 * side-by-side tables (1P-4P and 1S-4S) next to a summary block. Both the flattened text
 * form (PDF/OCR) and the original workbook form must return all eight rows.
 */
import ExcelJS from 'exceljs';
import {
  parseSamplingDocumentText,
  parseSamplingWorkbook,
  parseSamplingDate,
  runSamplingDocumentExtract,
} from '../src/lib/sampling-document-extract.js';
import {
  consistentLabels,
  metricsInCell,
  normaliseMetricCell,
  splitOversizedBands,
} from '../src/lib/sampling-table-ocr.js';

let failed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: got ${a} expected ${e}`);
    failed += 1;
    return false;
  }
  console.log(`OK   ${label}: ${a}`);
  return true;
}

const EXPECTED_RECORDS = [
  { noPalka: '1P', ffa: '5.47', moisture: '0.38' },
  { noPalka: '1S', ffa: '5.47', moisture: '0.25' },
  { noPalka: '2P', ffa: '5.36', moisture: '0.32' },
  { noPalka: '2S', ffa: '5.37', moisture: '0.29' },
  { noPalka: '3P', ffa: '5.51', moisture: '0.25' },
  { noPalka: '3S', ffa: '5.54', moisture: '0.32' },
  { noPalka: '4P', ffa: '5.41', moisture: '0.29' },
  { noPalka: '4S', ffa: '5.38', moisture: '0.24' },
];

const byPalka = (rows) => [...rows].sort((a, b) => a.noPalka.localeCompare(b.noPalka));

/* ---------------------------------------------------------------- text / OCR path */

// Both tables collapse onto one line per visual row, with summary values trailing.
const SAMPLE_TEXT = `
Update Quality CPO Incoming Barges
Date : 25-Aug-26
Product : CPO (Crude Palm Oil)
Vessel/Barges Name : MT Victoria II
Loading Port : Maloy
Quantity : 3.300.000 MT
Sampel Recived : PT Insurindo
Supplier : PT Tridaya Hutan Lestari
No. Palka Quality No. Palka Quality Quality CPO
(%), FFA (%), Moisture (%), FFA (%), Moisture (%), FFA Average : 5.44
1P 5.47 0.38 1S 5.47 0.25 (%), Moist Average : 0.29
2P 5.36 0.32 2S 5.37 0.29 DOBI : 1.58
3P 5.51 0.25 3S 5.54 0.32 (gI2/100g), Iodine Value : 51.25
4P 5.41 0.29 4S 5.38 0.24
Note : tidak dilakukan analisa bersama dengan surveyor/shipper
`;

console.log('--- text / OCR path');
const textFields = parseSamplingDocumentText(SAMPLE_TEXT);
check('text record count', textFields.records.length, 8);
check('text records', byPalka(textFields.records), EXPECTED_RECORDS);
check('text documentDate', textFields.documentDate, '2026-08-25');
check('text vesselName', textFields.vesselName, 'MT Victoria II');
check('text dobi', textFields.dobi, '1.58');
check('text iodineValue', textFields.iodineValue, '51.25');
check('text statedAvgFfa', textFields.statedAvgFfa, 5.44);
check('text statedAvgMoisture', textFields.statedAvgMoisture, 0.29);

console.log('--- date formats');
check('date 25-Aug-26', parseSamplingDate('25-Aug-26'), '2026-08-25');
check('date 25 August 2026', parseSamplingDate('25 August 2026'), '2026-08-25');
check('date 25/08/2026', parseSamplingDate('25/08/2026'), '2026-08-25');
check('date 2026-08-25', parseSamplingDate('2026-08-25'), '2026-08-25');
check('date junk', parseSamplingDate('not a date'), null);

console.log('--- rejects noise');
const noise = parseSamplingDocumentText(`
Quantity : 3.300.000 MT
Total loaded 12.500 MT at 09.30
Note : nothing useful here
`);
check('noise record count', noise.records.length, 0);

/* Verbatim tesseract output for a photographed report: "Iodine" comes back with a
   lowercase L, and "1S" as "18". The bad label must cost only its own row — never
   fabricate a palka, and never poison the rows that did read cleanly. */
console.log('--- real OCR output');
const ocr = parseSamplingDocumentText(`QUALITY REPORT - CPO INCOMING BARGES
Vessel Name : MT Victoria Il
Date : 25-Aug-26
No. Palka FFA (%) Moisture (%) No. Palka FFA (%) Moisture (%)
1P 5.47 0.38 18 5.47 0.25
2P 5.36 0.32 2S 5.37 0.29
3P 5.51 0.25 3S 5.54 0.32
4P 5.41 0.29 4S 5.38 0.24
FFA Average : 5.44
Moisture Average : 0.29
DOBI : 1.58
lodine Value : 51.25`);
check(
  'ocr keeps the 7 readable rows',
  byPalka(ocr.records),
  EXPECTED_RECORDS.filter((r) => r.noPalka !== '1S')
);
check('ocr invents no palka for the misread label', ocr.records.some((r) => r.noPalka === '18'), false);
check('ocr documentDate', ocr.documentDate, '2026-08-25');
check('ocr reads "lodine" as Iodine', ocr.iodineValue, '51.25');
check('ocr dobi', ocr.dobi, '1.58');
check('ocr statedAvgFfa', ocr.statedAvgFfa, 5.44);

/* ---------------------------------------------------------------- workbook path */

/** Rebuilds the report layout: two palka tables plus a summary block, with merged headers. */
async function buildFixtureWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quality');

  ws.getCell('B2').value = 'Update Quality CPO Incoming Barges';
  ws.getCell('B4').value = 'Date';
  ws.getCell('C4').value = ':';
  ws.getCell('D4').value = '25-Aug-26';
  ws.getCell('B5').value = 'Vessel/Barges Name';
  ws.getCell('C5').value = ':';
  ws.getCell('D5').value = 'MT Victoria II';
  ws.getCell('B6').value = 'Loading Port';
  ws.getCell('C6').value = ':';
  ws.getCell('D6').value = 'Maloy';

  // Left table: "No. Palka" spans two rows, "Quality" spans the two metric columns.
  ws.mergeCells('B8:B9');
  ws.getCell('B8').value = 'No. Palka';
  ws.mergeCells('C8:D8');
  ws.getCell('C8').value = 'Quality';
  ws.getCell('C9').value = '(%), FFA';
  ws.getCell('D9').value = '(%), Moisture';

  // Right table, same shape, different columns.
  ws.mergeCells('F8:F9');
  ws.getCell('F8').value = 'No. Palka';
  ws.mergeCells('G8:H8');
  ws.getCell('G8').value = 'Quality';
  ws.getCell('G9').value = '(%), FFA';
  ws.getCell('H9').value = '(%), Moisture';

  const left = [
    ['1P', 5.47, 0.38],
    ['2P', 5.36, 0.32],
    ['3P', 5.51, 0.25],
    ['4P', 5.41, 0.29],
  ];
  const right = [
    ['1S', 5.47, 0.25],
    ['2S', 5.37, 0.29],
    ['3S', 5.54, 0.32],
    ['4S', 5.38, 0.24],
  ];
  left.forEach(([p, ffa, moist], i) => {
    const r = 10 + i;
    ws.getCell(`B${r}`).value = p;
    ws.getCell(`C${r}`).value = ffa;
    ws.getCell(`D${r}`).value = moist;
  });
  right.forEach(([p, ffa, moist], i) => {
    const r = 10 + i;
    ws.getCell(`F${r}`).value = p;
    ws.getCell(`G${r}`).value = ffa;
    ws.getCell(`H${r}`).value = moist;
  });

  ws.getCell('J8').value = 'Quality CPO';
  ws.getCell('J9').value = '(%), FFA Average';
  ws.getCell('K9').value = ':';
  ws.getCell('L9').value = 5.44;
  ws.getCell('J10').value = '(%), Moist Average';
  ws.getCell('K10').value = ':';
  ws.getCell('L10').value = 0.29;
  ws.getCell('J11').value = 'DOBI';
  ws.getCell('K11').value = ':';
  ws.getCell('L11').value = 1.58;
  ws.getCell('J12').value = '(gI2/100g), Iodine Value';
  ws.getCell('K12').value = ':';
  ws.getCell('L12').value = 51.25;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

console.log('--- workbook path');
const wbBuffer = await buildFixtureWorkbook();
const wbFields = await parseSamplingWorkbook(wbBuffer);
check('xlsx record count (both tables)', wbFields.records.length, 8);
check('xlsx records', byPalka(wbFields.records), EXPECTED_RECORDS);
check('xlsx documentDate', wbFields.documentDate, '2026-08-25');
check('xlsx vesselName', wbFields.vesselName, 'MT Victoria II');
check('xlsx dobi', wbFields.dobi, '1.58');
check('xlsx iodineValue', wbFields.iodineValue, '51.25');
check('xlsx statedAvgFfa', wbFields.statedAvgFfa, 5.44);
check('xlsx statedAvgMoisture', wbFields.statedAvgMoisture, 0.29);

/* ---------------------------------------------------------------- entry point */

// Exercises magic-byte detection and parser routing, the way the HTTP route does.
console.log('--- runSamplingDocumentExtract');
const wbOut = await runSamplingDocumentExtract(wbBuffer);
check('entry point source', wbOut.source, 'xlsx');
check('entry point record count', wbOut.fields.records.length, 8);
check('entry point rawText empty for xlsx', wbOut.rawText, '');

let rejected = null;
try {
  await runSamplingDocumentExtract(Buffer.from('just some notes, not a report'));
} catch (e) {
  rejected = e?.statusCode ?? 'no status';
}
check('unsupported type rejected with 400', rejected, 400);

/* ---------------------------------------------------------------- image cell reader */

/*
 * Reading a photographed report cell by cell is the only thing that works on these
 * reports (page OCR reads the cell borders as glyphs). These checks cover the value
 * normalisation and the two structural rules that stop a misread label from filing
 * correct readings against the wrong palka.
 */
console.log('--- image cell reader');
check('metric keeps a well-formed value', normaliseMetricCell('6.26'), '6.26');
// The columns always hold one integer digit and two decimals, so a lost point is safe to
// restore — but only then.
check('metric restores a dropped decimal point', normaliseMetricCell('025'), '0.25');
check('metric restores a dropped point on FFA', normaliseMetricCell('626'), '6.26');
check('metric refuses a two-digit read', normaliseMetricCell('62'), null);
check('metric refuses a one-decimal read', normaliseMetricCell('6.2'), null);
check('metric refuses an empty cell', normaliseMetricCell(''), null);
check('metric ignores stray ink', normaliseMetricCell('|6.26|'), '6.26');

// When a column rule is too faint to detect, both values land in one cell.
check('merged cell yields both metrics', metricsInCell('8.52 0.26'), ['8.52', '0.26']);
check('single cell yields one metric', metricsInCell('8.52'), ['8.52']);
check('label cell yields no metrics', metricsInCell('4S'), []);

// A band measuring a whole multiple of the row pitch is several rows whose divider was
// missed everywhere; it gets split back up. Real case: 4C and 5C shared one band.
check('oversized band is split back into rows', splitOversizedBands([0, 40, 80, 160, 200]), [
  0, 40, 80, 120, 160, 200,
]);
check('evenly pitched rows are left alone', splitOversizedBands([0, 40, 80, 120]), [0, 40, 80, 120]);

// Labels must agree with the column they sit in: one suffix, counting upwards.
const labelCells = [
  { strip: 0, y0: 10, text: '1P' },
  { strip: 0, y0: 50, text: '1P' }, // real misread of "2P"; must not shadow the true 1P
  { strip: 0, y0: 90, text: '3P' },
  { strip: 0, y0: 130, text: '1S' }, // stray suffix from a neighbouring table
  { strip: 1, y0: 10, text: '6.26' },
];
check(
  'inconsistent labels are dropped',
  consistentLabels(labelCells).map((c) => `${c.num}${c.suffix}@${c.y0}`),
  ['1P@10', '3P@90']
);
// One bad label near the top must not discard every row beneath it.
check(
  'a high misread at the top does not sink the rest',
  consistentLabels([
    { strip: 0, y0: 10, text: '7P' },
    { strip: 0, y0: 50, text: '2P' },
    { strip: 0, y0: 90, text: '3P' },
    { strip: 0, y0: 130, text: '4P' },
  ]).map((c) => `${c.num}${c.suffix}`),
  ['2P', '3P', '4P']
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sampling parser checks passed');
