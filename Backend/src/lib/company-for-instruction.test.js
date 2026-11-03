import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { companyChoiceMode, companyLabel, pickCompanyId } from './company-for-instruction.js';

describe('company-for-instruction', () => {
  it('hides the field until a port has a company', () => {
    assert.equal(companyChoiceMode(0), 'hidden');
    assert.deepEqual(pickCompanyId([], null), { companyId: null });
    assert.deepEqual(pickCompanyId([], 4), { error: 'Company is not used at this port' });
  });

  it('locks a one-company port to that company', () => {
    assert.equal(companyChoiceMode(1), 'locked');
    assert.deepEqual(pickCompanyId([7], null), { companyId: 7 });
    assert.deepEqual(pickCompanyId([7], 9), { companyId: 7 });
  });

  it('requires a mapped company when the port has several', () => {
    assert.equal(companyChoiceMode(4), 'required');
    assert.deepEqual(pickCompanyId([1, 2, 3], null), { error: 'Company is required' });
    assert.deepEqual(pickCompanyId([1, 2, 3], 2), { companyId: 2 });
    assert.deepEqual(pickCompanyId([1, 2, 3], 9), { error: 'Company is not used at this port' });
  });

  it('shows the short name and the full name together', () => {
    assert.equal(
      companyLabel({ short_name: 'EUP', name: 'PT ENERGI UNGGUL PERSADA' }),
      'EUP - PT ENERGI UNGGUL PERSADA'
    );
    assert.equal(companyLabel({ shortName: 'EUP', companyName: 'PT ENERGI UNGGUL PERSADA' }), 'EUP - PT ENERGI UNGGUL PERSADA');
    assert.equal(companyLabel({ name: 'PT ENERGI UNGGUL PERSADA' }), 'PT ENERGI UNGGUL PERSADA');
    assert.equal(companyLabel({ short_name: 'EUP', name: 'EUP' }), 'EUP');
  });

  it('keeps the previous company on update when the client omits the field', () => {
    assert.deepEqual(pickCompanyId([1, 2], undefined, { omitted: true, previousId: 2 }), { companyId: 2 });
    assert.deepEqual(pickCompanyId([1, 2], undefined, { omitted: true, previousId: null }), {
      error: 'Company is required',
    });
  });
});
