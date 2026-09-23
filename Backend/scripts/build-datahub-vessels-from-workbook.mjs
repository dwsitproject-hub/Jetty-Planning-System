/**
 * Build a DHM vessel-master CSV from the "Vessel Cleanup (Jovin, Klip, SAP)"
 * workbook, sheet `Jovin_SAP_Mapping`.
 *
 *   node scripts/build-datahub-vessels-from-workbook.mjs [workbook.xlsx] [out.csv]
 *
 * Pass --jovin-only to drop the SAP-sourced rows. Those are international
 * vessels carrying nothing but a name and a SAP code; the Jovin-sourced rows
 * are the ones that actually call at the jetties and carry real attributes.
 *
 * Pass --with-type to keep only vessels that have a Vessel Type, i.e. the ones
 * the cleanup has actually classified.
 *
 * Output columns match Backend/exports/datahub/export-vessels.sql exactly, so
 * the workbook export and the JPS production export can be reconciled later.
 * `Code` is omitted: DHM assigns VSL-NNNN on create.
 *
 * The workbook covers the fields JPS cannot: Vessel Type, Capacity, Heater,
 * Type lambung, Type Charter and the SAP code. It has no IMO, MMSI, gross
 * tonnage, draft or LOA, so those export blank.
 *
 * Vessels are collapsed on the same normalised-name key the SQL export uses
 * (type prefix stripped, Roman numerals folded to digits, punctuation ignored)
 * to satisfy DHM's unique Vessel_Name rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const FLAGS = ['--jovin-only', '--with-type'];
const args = process.argv.slice(2).filter((a) => !FLAGS.includes(a));
const JOVIN_ONLY = process.argv.includes('--jovin-only');
const WITH_TYPE = process.argv.includes('--with-type');
const WORKBOOK = args[0] || 'c:/Users/04125050828/Downloads/Vessel Cleanup (Jovin, Klip, SAP) (1).xlsx';
const OUT =
  args[1] ||
  path.join(
    import.meta.dirname,
    '..',
    'exports',
    'datahub',
    WITH_TYPE
      ? 'vessels-from-workbook-typed.csv'
      : JOVIN_ONLY
        ? 'vessels-from-workbook-jovin.csv'
        : 'vessels-from-workbook.csv'
  );
const QA_OUT = OUT.replace(/\.csv$/, '-qa.txt');
const SHEET = 'Jovin_SAP_Mapping';

/** Workbook column positions, verified against the sheet header row. */
const COL = {
  source: 1,
  code: 2,
  name: 3,
  capacity: 6,
  type: 7,
  heating: 8,
  lambung: 9,
  terms: 10,
};

/** Workbook value -> DHM enum. Unmapped values are dropped and reported. */
const VESSEL_TYPE = { BARGE: 'barge', TANKER: 'tanker', SPOB: 'SPOB' };
const TYPE_LAMBUNG = {
  DHDB: 'Double hull Double Bottom',
  SHDB: 'Single hull Double Bottom',
  SHSB: 'Single hull Single Bottom',
};
const TYPE_CHARTER = { 'V/C': 'Voyage Charter', 'T/C': 'Time Charter' };

const ROMAN = {
  I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6',
  VII: '7', VIII: '8', IX: '9', X: '10', XI: '11', XII: '12',
};

function matchKey(name) {
  return String(name)
    .toUpperCase()
    .replace(/^(SPOB|LCT|MT|MV|BG|OB|TB|TK|KM)[.\s]+/, '')
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .map((t) => ROMAN[t] || t)
    .join('');
}

const alnum = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Longest common substring length, used to score SAP codes against a name. */
function overlap(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

/**
 * SAP holds duplicate master records for the same hull, which is why a single
 * row can list several codes -- that duplication is the point of the cleanup.
 * Prefer the code that most resembles the vessel name: for GLOBAL GLORY that
 * picks MTGLOGLORY over MM. Genuinely ambiguous rows land in the QA file.
 */
function pickSapCode(codes, name) {
  if (codes.length <= 1) return { chosen: codes[0] || '', rest: [], ambiguous: false };
  const target = alnum(name).replace(/^(SPOB|LCT|MT|MV|BG|OB|TB|TK|KM|KLM)/, '');
  const scored = codes
    .map((code, i) => ({ code, score: overlap(alnum(code), target), len: code.length, i }))
    // best name overlap wins; on a tie prefer the shorter, less suffixed code
    .sort((a, b) => b.score - a.score || a.len - b.len || a.i - b.i);
  return {
    chosen: scored[0].code,
    rest: scored.slice(1).map((s) => s.code),
    // nothing in any code resembles the name, or the top two tie
    ambiguous: scored[0].score <= 1 || scored[0].score === scored[1].score,
  };
}

function cellText(c) {
  const v = c?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    return String(v.text ?? v.result ?? v.richText?.map((r) => r.text).join('') ?? '').trim();
  }
  return String(v).trim();
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Trim the workbook's "4000.0" to "4000" without touching real decimals. */
function number(raw) {
  if (!raw) return '';
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : '';
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(WORKBOOK);
const ws = wb.getWorksheet(SHEET);
if (!ws) throw new Error(`sheet "${SHEET}" not found in ${WORKBOOK}`);

const unmapped = { type: new Set(), lambung: new Set(), charter: new Set(), heating: new Set() };
const byKey = new Map();
let skipped = 0;

for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const name = cellText(row.getCell(COL.name));
  if (!name) {
    skipped++;
    continue;
  }

  const source = cellText(row.getCell(COL.source));
  if (JOVIN_ONLY && !/jovin/i.test(source)) continue;

  const codes = cellText(row.getCell(COL.code))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sap = pickSapCode(codes, name);

  const rawType = cellText(row.getCell(COL.type)).toUpperCase();
  const rawLambung = cellText(row.getCell(COL.lambung)).toUpperCase();
  const rawTerms = cellText(row.getCell(COL.terms)).toUpperCase();
  const rawHeating = cellText(row.getCell(COL.heating)).toUpperCase();

  if (rawType && !VESSEL_TYPE[rawType]) unmapped.type.add(rawType);
  if (rawLambung && !TYPE_LAMBUNG[rawLambung]) unmapped.lambung.add(rawLambung);
  if (rawTerms && !TYPE_CHARTER[rawTerms]) unmapped.charter.add(rawTerms);
  if (rawHeating && !['YES', 'NO'].includes(rawHeating)) unmapped.heating.add(rawHeating);

  const rec = {
    name,
    source,
    sapCode: sap.chosen,
    extraCodes: sap.rest,
    codeAmbiguous: sap.ambiguous,
    capacity: number(cellText(row.getCell(COL.capacity))),
    vesselType: VESSEL_TYPE[rawType] || '',
    heater: rawHeating === 'YES' ? 'true' : rawHeating === 'NO' ? 'false' : '',
    lambung: TYPE_LAMBUNG[rawLambung] || '',
    charter: TYPE_CHARTER[rawTerms] || '',
  };

  const key = matchKey(name);
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, { ...rec, rowCount: 1, spellings: new Set([name]) });
    continue;
  }
  // Same vessel seen twice: keep the first non-empty value for each field.
  existing.rowCount++;
  existing.spellings.add(name);
  for (const f of ['sapCode', 'capacity', 'vesselType', 'heater', 'lambung', 'charter']) {
    if (!existing[f] && rec[f]) existing[f] = rec[f];
  }
  if (rec.extraCodes.length) existing.extraCodes.push(...rec.extraCodes);
}

// Filter after the merge, so a vessel whose type arrived on a second row is kept.
const vessels = [...byKey.values()]
  .filter((v) => !WITH_TYPE || v.vesselType)
  .sort((a, b) => a.name.localeCompare(b.name));

const HEADER = [
  'Vessel Name',
  'Vessel IMO',
  'Vessel MMSI',
  'Vessel Code SAP',
  'Vessel Capacity MT',
  'Vessel Gross Tonnage',
  'Vessel Draft',
  'Vessel Length Overral',
  'Vessel Type',
  'Heater',
  'Type lambung',
  'Type Charter',
];

const lines = [HEADER.join(',')];
for (const v of vessels) {
  lines.push(
    [
      v.name,
      '', // Vessel IMO      - not in the workbook
      '', // Vessel MMSI     - not in the workbook
      v.sapCode,
      v.capacity,
      '', // Vessel Gross Tonnage - not in the workbook
      '', // Vessel Draft         - not in the workbook
      '', // Vessel Length Overral- not in the workbook
      v.vesselType,
      v.heater,
      v.lambung,
      v.charter,
    ]
      .map(csvEscape)
      .join(',')
  );
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

const count = (pred) => vessels.filter(pred).length;
const fromJovin = count((v) => /jovin/i.test(v.source));

const qa = [];
const say = (line = '') => {
  qa.push(line);
  console.log(line);
};

say(`DHM vessel export from ${SHEET}${JOVIN_ONLY ? ' (Jovin-sourced rows only)' : ''}`);
say(`generated ${new Date().toISOString()}`);
say();
say(`  unique vessels          ${vessels.length}   (from ${ws.rowCount - 1} sheet rows, ${skipped} unnamed skipped)`);
say(`  sourced from Jovin      ${fromJovin}   <- the vessels that actually call at your jetties`);
say(`  SAP-only, name + code   ${vessels.length - fromJovin}`);
say();
say(`  with SAP code           ${count((v) => v.sapCode)}`);
say(`  with capacity           ${count((v) => v.capacity)}`);
say(`  with vessel type        ${count((v) => v.vesselType)}`);
say(`  with heater             ${count((v) => v.heater)}`);
say(`  with type lambung       ${count((v) => v.lambung)}`);
say(`  with type charter       ${count((v) => v.charter)}`);
say(`  name only, no attrs     ${count((v) => !v.sapCode && !v.capacity && !v.vesselType)}`);
say();
say(`  merged from >1 row      ${count((v) => v.rowCount > 1)}`);
say(`  held >1 SAP code        ${count((v) => v.extraCodes.length)}`);
say(`  SAP code AMBIGUOUS      ${count((v) => v.codeAmbiguous)}   <- review these by hand`);

for (const [field, set] of Object.entries(unmapped)) {
  if (set.size) say(`  UNMAPPED ${field}: ${[...set].join(', ')}`);
}

const ambiguous = vessels.filter((v) => v.codeAmbiguous);
if (ambiguous.length) {
  say();
  say(`AMBIGUOUS SAP CODE -- no candidate resembles the vessel name, pick by hand (${ambiguous.length})`);
  for (const v of ambiguous) {
    say(`  ${v.name}: using ${v.sapCode}, other candidates ${[...new Set(v.extraCodes)].join(', ')}`);
  }
}

const resolved = vessels.filter((v) => v.extraCodes.length && !v.codeAmbiguous);
if (resolved.length) {
  say();
  say(`DUPLICATE SAP CODES resolved by name similarity (${resolved.length})`);
  for (const v of resolved) {
    say(`  ${v.name}: kept ${v.sapCode}, dropped ${[...new Set(v.extraCodes)].join(', ')}`);
  }
}

const merged = vessels.filter((v) => v.spellings.size > 1);
if (merged.length) {
  say();
  say(`MERGED SPELLINGS -- verify the name kept (${merged.length})`);
  for (const v of merged) say(`  ${v.name}  <-  ${[...v.spellings].join(' | ')}`);
}

fs.writeFileSync(QA_OUT, qa.join('\n') + '\n', 'utf8');
console.log(`\nwrote ${OUT}`);
console.log(`wrote ${QA_OUT}`);
