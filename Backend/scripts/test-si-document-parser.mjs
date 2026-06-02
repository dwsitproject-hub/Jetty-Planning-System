/**
 * Quick parser smoke test: node scripts/test-si-document-parser.mjs
 */
import { parseShippingInstructionText, parseLooseDateToYmd } from '../src/lib/si-document-extract.js';

const sample = `
SHIPPING INSTRUCTION
No.: SI/EUP/2026/I/014
VESSEL NAME : MT VAST CORAL
MESSRS : PT.BEN LINE AGENCY
SHIPPER : PT ENERGI UNGGUL PERSADA
SHIPMENT FROM : BONTANG, INDONESIA
QUANTITY : 5,000 MTS
DESCR. OF GOOD : REFINED POME OIL
BL SPLIT : 1 X 5,000 MTS
BL INDICATED : FREIGHT PREPAID, CLEAN ON BOARD
CONSIGNEE
TO ORDER
NOTIFY PARTY
ADAMANT ECODEV S.R.L
19 JANUARY 2026
`;

const fields = parseShippingInstructionText(sample);
const checks = [
  ['referenceNumber', 'SI/EUP/2026/I/014'],
  ['vesselName', 'MT VAST CORAL'],
  ['documentDate', '2026-01-19'],
  ['shipper', 'PT ENERGI UNGGUL PERSADA'],
  ['loadingPort', 'BONTANG, INDONESIA'],
  ['blIndicated', /FREIGHT PREPAID/i],
];

let failed = 0;
for (const [key, expected] of checks) {
  const v = fields[key];
  const ok =
    expected instanceof RegExp ? expected.test(String(v || '')) : String(v || '').includes(expected);
  if (!ok) {
    console.error(`FAIL ${key}: got ${JSON.stringify(v)} expected ${expected}`);
    failed += 1;
  } else {
    console.log(`OK ${key}: ${v}`);
  }
}

if (parseLooseDateToYmd('19 JANUARY 2026') !== '2026-01-19') {
  console.error('FAIL parseLooseDateToYmd month name');
  failed += 1;
}

if (!fields.breakdown?.[0]?.qty) {
  console.error('FAIL breakdown qty');
  failed += 1;
}

process.exit(failed > 0 ? 1 : 0);
