import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortSyncPlan, diffPortFields } from './datahub-port-sync.js';
import { normalizeHubPortMaster } from './datahub-client.js';

describe('datahub-port-sync', () => {
  it('normalizes port_master from hub payload', () => {
    const hub = normalizeHubPortMaster({
      id: 'uuid-port-1',
      version: 1,
      data: {
        code: 'PORT-0001',
        name: 'Bontang',
        unlocode: 'IDBTG',
        country: 'Indonesia',
        site_id: 'SITE-0001',
        is_active: true,
      },
    });
    assert.equal(hub.hubCode, 'PORT-0001');
    assert.equal(hub.values.name, 'Bontang');
    assert.equal(hub.values.unlocode, 'IDBTG');
    assert.equal(hub.values.hub_site_id, 'SITE-0001');
  });

  it('matches by hub code and detects name change', () => {
    const hub = [
      normalizeHubPortMaster({
        id: 'uuid-1',
        version: 2,
        data: { code: 'PORT-0001', name: 'Bontang LNG', country: 'Indonesia' },
      }),
    ];
    const local = [
      {
        id: 3,
        hub_code: 'PORT-0001',
        name: 'Bontang',
        unlocode: null,
        country: 'Indonesia',
        is_active: true,
        hub_site_id: null,
      },
    ];
    const { items } = buildPortSyncPlan(hub, local);
    assert.equal(items.length, 1);
    assert.equal(items[0].diffKind, 'changed');
    assert.ok(diffPortFields(local[0], hub[0].values).name);
  });
});
