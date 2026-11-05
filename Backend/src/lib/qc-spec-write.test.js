import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseParameterInput, parseTemplateInput } from './qc-spec-write.js';

describe('parseTemplateInput', () => {
  it('requires a name, at least one parameter, and unique commodity ids', () => {
    assert.throws(() => parseTemplateInput({ parameters: [{ parameterId: 1 }] }), { statusCode: 400 });
    assert.throws(() => parseTemplateInput({ name: 'CPO' }), { statusCode: 400 });
    const out = parseTemplateInput({
      name: ' CPO ',
      commodityIds: [3, 3, 'x', 8],
      parameters: [{ parameterId: 1, scope: 'both' }, { id: 2, scope: 'report' }],
    });
    assert.equal(out.name, 'CPO');
    assert.deepEqual(out.commodityIds, [3, 8]);
    assert.equal(out.items[1].parameterId, 2);
  });
});

describe('parseParameterInput', () => {
  it('slugifies the code', () => {
    const out = parseParameterInput({ code: 'Total Metal!', labelEn: 'Total Metal', maxValue: 50 });
    assert.equal(out.code, 'total_metal');
    assert.equal(out.maxValue, 50);
  });

  it('keeps unit and method as their own fields', () => {
    const out = parseParameterInput({
      code: 'ffa',
      labelEn: 'FFA',
      unit: ' % ',
      method: ' AOCS Ca 5a-40 ',
    });
    assert.equal(out.unit, '%');
    assert.equal(out.method, 'AOCS Ca 5a-40');
    assert.equal(out.labelEn, 'FFA');
  });
});
