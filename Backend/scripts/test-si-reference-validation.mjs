/**
 * SI reference berthing validation — unit checks.
 * Run: node scripts/test-si-reference-validation.mjs
 */
import {
  SI_REFERENCE_BERTHING_ERROR,
  isSiReferenceValidForBerthing,
  validatePlanSiReferencesForBerthing,
  validateSiReferenceForBerthing,
} from '../src/lib/si-reference-validation.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

assert(validateSiReferenceForBerthing('', 'MV TEST') === SI_REFERENCE_BERTHING_ERROR, 'empty ref');
assert(validateSiReferenceForBerthing('   ', 'MV TEST') === SI_REFERENCE_BERTHING_ERROR, 'whitespace ref');
assert(validateSiReferenceForBerthing("'", 'MV TEST') === SI_REFERENCE_BERTHING_ERROR, 'single quote ref');
assert(
  validateSiReferenceForBerthing('MV TEST', 'MV TEST') === SI_REFERENCE_BERTHING_ERROR,
  'same as vessel'
);
assert(
  validateSiReferenceForBerthing('mv test', 'MV TEST') === SI_REFERENCE_BERTHING_ERROR,
  'same as vessel case insensitive'
);
assert(validateSiReferenceForBerthing('SI/EUP/2026/1', 'MV TEST') == null, 'valid ref');
assert(isSiReferenceValidForBerthing('SI/EUP/2026/1', 'MV TEST'), 'is valid helper');

assert(
  validatePlanSiReferencesForBerthing([], 'MV TEST') != null,
  'no SIs on plan'
);
assert(
  validatePlanSiReferencesForBerthing([{ reference_number: null }], 'MV TEST') ===
    SI_REFERENCE_BERTHING_ERROR,
  'null ref on plan'
);
assert(
  validatePlanSiReferencesForBerthing([{ reference_number: 'SI-OK-1' }], 'MV TEST') == null,
  'valid plan SIs'
);
assert(
  validatePlanSiReferencesForBerthing(
    [{ reference_number: 'SI-OK-1' }, { reference_number: "'" }],
    'MV TEST'
  ) === SI_REFERENCE_BERTHING_ERROR,
  'one invalid ref fails whole plan'
);

console.log('test-si-reference-validation: ok');
