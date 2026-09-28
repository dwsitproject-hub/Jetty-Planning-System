import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIncotermSyncPlan, diffIncotermFields } from './datahub-incoterm-sync.js';
import { buildCommoditySyncPlan, deriveShortNameFromCommodityName, expandCommodityValues } from './datahub-commodity-sync.js';
import { normalizeHubIncoterm, normalizeHubCommodity } from './datahub-client.js';

describe('datahub-incoterm-sync', () => {
  it('maps hub name to local code', () => {
    const hub = normalizeHubIncoterm({
      id: 'uuid-1',
      version: 1,
      data: { code: 'INC-0001', short_name: 'fob', long_name: 'Free On Board', description: 'Free on board' },
    });
    assert.equal(hub.values.code, 'FOB');
    assert.equal(hub.values.description, 'Free on board');
  });

  it('maps optional long_name from hub payload', () => {
    const hub = normalizeHubIncoterm({
      id: 'uuid-1',
      version: 1,
      data: { code: 'INC-0001', short_name: 'FOB', long_name: 'Free On Board' },
    });
    assert.equal(hub.values.long_name, 'Free On Board');
  });

  it('matches existing row by code and detects description change', () => {
    const hub = [
      normalizeHubIncoterm({
        id: 'uuid-1',
        version: 2,
        data: { code: 'INC-0001', short_name: 'FOB', long_name: 'Free On Board', description: 'Updated' },
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

  it('maps hub short_name type and uom from payload', () => {
    const hub = normalizeHubCommodity({
      id: 'u1',
      version: 1,
      data: {
        code: 'CMD-0001',
        long_name: 'CRUDE PALM OIL',
        short_name: 'cpo',
        type: 'liquid',
        uom: 'KL',
      },
    });
    assert.equal(hub.values.name, 'CRUDE PALM OIL');
    assert.equal(hub.values.short_name, 'cpo');
    assert.equal(hub.values.commodity_type, 'Liquid');
    assert.equal(hub.values.uom, 'KL');
  });

  it('defaults liquid type from KL uom when type omitted', () => {
    const hub = [
      normalizeHubCommodity({
        id: 'u1',
        version: 1,
        data: { code: 'CMD-0001', long_name: 'CRUDE PALM OIL', short_name: 'CPO', type: 'liquid', uom: 'KL' },
      }),
    ];
    const { items } = buildCommoditySyncPlan(hub, [], { KL: 1, MT: 2 });
    assert.equal(items[0].diffKind, 'new');
    assert.equal(items[0].values.commodity_type, 'Liquid');
    assert.equal(items[0].values.default_metric_id, 1);
  });

  it('matches existing local row by short name instead of creating duplicate', () => {
    const hub = [
      normalizeHubCommodity({
        id: 'u2',
        version: 1,
        data: {
          code: 'CMD-0099',
          long_name: 'PALM OIL RBD',
          short_name: 'CPO',
          type: 'solid',
          uom: 'MT',
        },
      }),
    ];
    const local = [
      {
        id: 10,
        hub_code: null,
        name: 'CRUDE PALM OIL',
        short_name: 'CPO',
        commodity_type: 'Liquid',
        default_metric_id: 1,
        kl_to_mt_factor: null,
        hs_code: null,
      },
    ];
    const { items } = buildCommoditySyncPlan(hub, local, { KL: 1, MT: 2 });
    assert.equal(items.length, 1);
    assert.equal(items[0].diffKind, 'changed');
    assert.equal(items[0].localId, 10);
    assert.equal(items[0].values.short_name, 'CPO');
    assert.equal(items[0].values.commodity_type, 'Solid');
    assert.equal(items[0].values.default_metric_id, 2);
  });

  it('expandCommodityValues prefers hub type and uom over local defaults', () => {
    const hubValues = {
      name: 'X',
      short_name: 'CPO',
      commodity_type: 'Solid',
      uom: 'MT',
    };
    const local = {
      short_name: 'OLD',
      commodity_type: 'Liquid',
      default_metric_id: 1,
      kl_to_mt_factor: 0.87,
    };
    const expanded = expandCommodityValues(hubValues, { KL: 1, MT: 2 }, local);
    assert.equal(expanded.short_name, 'CPO');
    assert.equal(expanded.commodity_type, 'Solid');
    assert.equal(expanded.default_metric_id, 2);
    assert.equal(expanded.kl_to_mt_factor, 0.87);
  });
});
