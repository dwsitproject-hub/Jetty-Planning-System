import {
  formatSiCargoDisplay,
  EMPTY_CARGO_DISPLAY,
} from '../src/lib/siBreakdownDisplay.js';

function assert(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`OK ${label}`);
  }
}

// Case A: single line RPO 5000 MT
assert(
  'single commodity',
  formatSiCargoDisplay([
    { commodityId: 1, commodityName: 'RPO', metricId: 1, metricCode: 'MT', qty: 5000 },
  ]).totalQtyDisplay,
  'RPO 5.000 MT'
);

// Case B: two lines same commodity — sum
assert(
  'same commodity sum',
  formatSiCargoDisplay([
    { commodityId: 1, commodityName: 'RPO', metricId: 1, metricCode: 'MT', qty: 3000 },
    { commodityId: 1, commodityName: 'RPO', metricId: 1, metricCode: 'MT', qty: 2000 },
  ]).totalQtyDisplay,
  'RPO 5.000 MT'
);

// Case C: two commodities
const multi = formatSiCargoDisplay([
  { commodityId: 1, commodityName: 'RPO', metricId: 1, metricCode: 'MT', qty: 3000 },
  { commodityId: 2, commodityName: 'CPO', metricId: 1, metricCode: 'MT', qty: 2000 },
]);
assert('multi commodity names', multi.commodityDisplay, 'RPO · CPO');
assert('multi commodity qty', multi.totalQtyDisplay, 'RPO 3.000 MT\nCPO 2.000 MT');

// Case D: empty
assert(
  'empty breakdown',
  formatSiCargoDisplay([]).commodityDisplay,
  EMPTY_CARGO_DISPLAY
);

if (process.exitCode !== 1) {
  console.log('All siBreakdownDisplay tests passed.');
}
