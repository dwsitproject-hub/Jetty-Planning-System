import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIncotermSyncPlan, diffIncotermFields } from './datahub-incoterm-sync.js';
import { buildCommoditySyncPlan, deriveShortNameFromCommodityName } from './datahub-commodity-sync.js';
import { normalizeHubIncoterm, normalizeHubCommodity } from './datahub-client.js';

describe('datahub-incoterm-sync', () => {
  it('maps hub name to local code', () => {
    const hub = normalizeHubIncoterm({
      id: 'uuid-1',
      version: 1,
      data: { code: 'INC-0001', name: 'fob', description: 'Free on board' },
    });
    assert.equal(hub.values.code, 'FOB');
  });

  it('matches existing row by code and detects description change', () => {
    const hub = [
      normalizeHubIncoterm({
        id: 'uuid-1',
        version: 2,
        data: { code: 'INC-0001', name: 'FOB', description: 'Updated' },
      }),
    ];
    const local = [{ id: 5, hub_code: 'INC-0001', code: 'FOB', description: 'Old' }];
    const { items } = buildIncotermSyncPlan(hub, local);
    assert.equal(items.length, 1);
    assert.equal(items[0].diffKind, 'changed');
    assert.ok(diffIncotermFields(local[0], hub[0].values).description);
  });
});

describe('datahub-commodity-sync', () => {
  it('derives short name acronym', () => {
    assert.equal(deriveShortNameFromCommodityName('CRUDE PALM OIL'), 'CPO');
  });

  it('defaults liquid type from KL uom', () => {
    const hub = [
      normalizeHubCommodity({
        id: 'u1',
        version: 1,
        data: { code: 'CMD-0001', name: 'CRUDE PALM OIL', uom: 'KL' },
      }),
    ];
    const { items } = buildCommoditySyncPlan(hub, [], { KL: 1, MT: 2 });
    assert.equal(items[0].diffKind, 'new');
    assert.equal(items[0].values.commodity_type, 'Liquid');
    assert.equal(items[0].values.default_metric_id, 1);
  });
});
