/**
 * Pre-berth SI edit helpers — material vs cosmetic diff (no DB).
 * Run: node scripts/test-si-pre-berth-edit.mjs
 */
import {
  hasSiUpdateMaterialChanges,
  POST_BERTH_EDIT_ERROR,
  POST_BERTH_PLAN_EDIT_ERROR,
  SUBMITTED_MATERIAL_EDIT_ERROR,
} from '../src/lib/si-pre-berth-edit.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const beforeRow = {
  trade_term_id: 1,
  loading_port_id: 2,
  surveyor_id: 3,
  preferred_jetty_id: 4,
  destination_text: 'Jakarta',
  freight_terms: 'FOB',
  bill_of_lading_clause: 'Clause A',
  consignee_text: 'Consignee',
  notify_party_text: 'Notify',
  bl_split_text: null,
  bl_indicated: 'Yes',
};

const beforeBd = [
  {
    commodity_id: 10,
    metric_id: 1,
    qty: 1000,
    shipper_id: 5,
    contract_no: 'C-1',
    po_no: null,
    so_no: null,
    remarks: null,
  },
];

const nextCosmetic = {
  tradeTermId: 1,
  loadingPortId: 2,
  surveyorId: 3,
  preferredJettyId: 4,
  destinationText: 'Jakarta',
  freightTerms: 'FOB',
  billOfLadingClause: 'Clause A',
  consigneeText: 'Consignee',
  notifyPartyText: 'Notify',
  blSplitText: null,
  blIndicated: 'Yes',
};

assert(
  !hasSiUpdateMaterialChanges(beforeRow, beforeBd, nextCosmetic, beforeBd),
  'identical payload is not material'
);

assert(
  hasSiUpdateMaterialChanges(beforeRow, beforeBd, { ...nextCosmetic, destinationText: 'Surabaya' }, beforeBd),
  'destination change is material'
);

assert(
  hasSiUpdateMaterialChanges(
    beforeRow,
    beforeBd,
    nextCosmetic,
    [{ ...beforeBd[0], qty: 2000 }]
  ),
  'breakdown qty change is material'
);

assert(
  !hasSiUpdateMaterialChanges(beforeRow, beforeBd, nextCosmetic, undefined),
  'undefined breakdown in request is not material diff'
);

assert(
  POST_BERTH_EDIT_ERROR.includes('after berthing'),
  'post-berth error message'
);
assert(
  POST_BERTH_PLAN_EDIT_ERROR.includes('Shipment plan'),
  'post-berth plan error message'
);
assert(
  SUBMITTED_MATERIAL_EDIT_ERROR.includes('submitted'),
  'submitted material error message'
);

console.log('test-si-pre-berth-edit.mjs: all assertions passed');
