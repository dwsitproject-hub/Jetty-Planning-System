/**
 * Plan-centric SI column display + merge (no incoming SI sub-slice filters).
 * Run: node scripts/test-incoming-si-filter.mjs
 */
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toFile = (p) => pathToFileURL(join(__dirname, p)).href;

const { mergeQueueRowsForPlanPov } = await import(toFile('../../Frontend/src/utils/allocationPlanPovMerge.js'));
const {
  planCentricSiColumnDisplay,
  planCentricQueueRowHasSi,
  rowPassesAllocationStatusFilter,
} = await import(toFile('../../Frontend/src/utils/allocationQueueStatusFilter.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const incomingFilter = { showIncoming: true, showBerthed: false };

// Plan-only row: SI column is —, not plan ref
const planOnlyFlat = [
  {
    id: '99',
    source: 'incoming-plan',
    shipmentPlanId: 99,
    planReference: 'SP-26-06-00020',
    shippingInstruction: 'SP-26-06-00020',
    vesselName: 'Vessel plan only',
    operationId: null,
    shippingInstructionId: null,
  },
];
const planOnlyMerged = mergeQueueRowsForPlanPov(planOnlyFlat).mergedRows[0];
assert(!planCentricQueueRowHasSi(planOnlyMerged), 'plan-only has no SI');
assert(planCentricSiColumnDisplay(planOnlyMerged) === '—', 'plan-only SI column is dash');
assert(
  rowPassesAllocationStatusFilter(planOnlyMerged, 'incoming', incomingFilter, true),
  'plan-only still in incoming list'
);

// Samudra-like: two SIs
const samudraFlat = [
  {
    id: '20',
    shipmentPlanId: 19,
    shippingInstructionId: 20,
    shippingInstruction: '046/PT.EUP-BD/II/2026',
    planReference: 'SP-26-05-00019',
    vesselName: 'MT. SAMUDRA SAKTI VIII',
    operationId: null,
  },
  {
    id: '21',
    shipmentPlanId: 19,
    shippingInstructionId: 21,
    shippingInstruction: 'SI/EUP/2026/I/014',
    planReference: 'SP-26-05-00019',
    vesselName: 'MT. SAMUDRA SAKTI VIII',
    operationId: null,
  },
];
const samudraMerged = mergeQueueRowsForPlanPov(samudraFlat, { idMode: 'representative' }).mergedRows[0];
assert(samudraMerged.source === 'incoming-si', 'missing source → merged source incoming-si');
assert(planCentricQueueRowHasSi(samudraMerged), 'Samudra merged row has SI');
assert(
  planCentricSiColumnDisplay(samudraMerged).includes('046/PT.EUP-BD/II/2026'),
  'Samudra SI column shows SI refs'
);
assert(
  rowPassesAllocationStatusFilter(samudraMerged, 'incoming', incomingFilter, true),
  'Samudra in incoming list (no sub-slice)'
);

console.log('test-incoming-si-filter.mjs: all checks passed');
