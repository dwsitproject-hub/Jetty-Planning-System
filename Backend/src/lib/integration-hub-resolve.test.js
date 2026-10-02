import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeCargoShortName,
  resolveCargoCommodities,
  resolvePortForIntegration,
  validateIntegrationCargoLineIdentifiers,
  validateIntegrationPortInput,
} from './integration-hub-resolve.js';

describe('integration-hub-resolve', () => {
  it('validateIntegrationPortInput requires port_hub_code and rejects port_id', () => {
    const empty = validateIntegrationPortInput(undefined, undefined);
    assert.ok(empty.errors.some((e) => e.field === 'port_hub_code'));
    const hub = validateIntegrationPortInput(undefined, 'PRT-001');
    assert.equal(hub.errors.length, 0);
    assert.equal(hub.portHubCode, 'PRT-001');
    const legacy = validateIntegrationPortInput(1, 'PRT-001');
    assert.ok(legacy.errors.some((e) => e.field === 'port_id'));
  });

  it('resolvePortForIntegration by hub_code', async () => {
    const db = {
      async query(sql, params) {
        if (sql.includes('hub_code = $1')) {
          return { rows: [{ id: 1, hub_code: 'PRT-001', name: 'Bontang' }] };
        }
        return { rows: [] };
      },
    };
    const row = await resolvePortForIntegration(db, { portHubCode: 'PRT-001' });
    assert.equal(row.id, 1);
  });

  it('resolvePortForIntegration rejects mismatched id and hub', async () => {
    const db = {
      async query() {
        return { rows: [{ id: 1, hub_code: 'PRT-001', name: 'Bontang' }] };
      },
    };
    const row = await resolvePortForIntegration(db, { portId: 99, portHubCode: 'PRT-001' });
    assert.ok(row.error);
  });

  it('validateIntegrationCargoLineIdentifiers requires cargo_hub_code and rejects cargo_type', () => {
    const r = validateIntegrationCargoLineIdentifiers(null, null, 0);
    assert.ok(r.errors.some((e) => e.field === 'cargo[0].cargo_hub_code'));
    const legacy = validateIntegrationCargoLineIdentifiers('CPO', null, 0);
    assert.ok(legacy.errors.some((e) => e.field === 'cargo[0].cargo_type'));
    const hub = validateIntegrationCargoLineIdentifiers(null, 'CMD-001', 0);
    assert.equal(hub.errors.length, 0);
    assert.equal(hub.cargoHubCode, 'CMD-001');
  });

  it('resolveCargoCommodities by hub_code', async () => {
    const db = {
      async query(sql, params) {
        if (sql.includes('c.hub_code = ANY')) {
          return {
            rows: [
              {
                id: 10,
                short_name: 'CPO',
                hub_code: 'CMD-001',
                commodity_type: 'Liquid',
                default_metric_id: 1,
                default_metric_code: 'MT',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const { errors, cargo, commodityByShortName } = await resolveCargoCommodities(db, [
      { cargoType: null, cargoHubCode: 'CMD-001', tonnage: 1, unit: 'MT' },
    ]);
    assert.equal(errors.length, 0);
    assert.equal(cargo[0].cargoType, 'CPO');
    assert.ok(commodityByShortName.has('CPO'));
  });

  it('normalizeCargoShortName uppercases', () => {
    assert.equal(normalizeCargoShortName('cpo'), 'CPO');
  });

  it('resolveCargoCommodities map includes hub-only lines', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('c.hub_code = ANY')) {
          return {
            rows: [
              {
                id: 3,
                short_name: 'CPO',
                hub_code: 'CMD-0006',
                commodity_type: 'Liquid',
                default_metric_id: 2,
                default_metric_code: 'MT',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const { errors, commodityByShortName } = await resolveCargoCommodities(db, [
      { cargoType: null, cargoHubCode: 'CMD-0006', tonnage: 2500, unit: 'MT' },
    ]);
    assert.equal(errors.length, 0);
    assert.ok(commodityByShortName.has('CPO'));
  });
});
