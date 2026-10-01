import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIntegrationCatalog, getIntegrationCatalogEntity } from './integration-catalog.js';

/** Minimal fake pool: returns rows based on which table/column the SQL touches. */
function fakeDb() {
  return {
    async query(sql) {
      if (sql.includes('si_trade_terms')) return { rows: [{ code: 'FOB' }, { code: 'CIF' }] };
      if (sql.includes('si_surveyors')) return { rows: [{ name: 'PT SGS Indonesia' }] };
      if (sql.includes('FROM ports') && sql.includes('hub_code IS NOT NULL')) {
        return { rows: [{ hub_code: 'PRT-001' }] };
      }
      if (sql.includes('FROM ports')) {
        return { rows: [{ id: 1, hub_code: 'PRT-001', name: 'Bontang' }] };
      }
      if (sql.includes('si_commodities') && sql.includes('hub_code IS NOT NULL')) {
        return { rows: [{ hub_code: 'CMD-001' }] };
      }
      if (sql.includes('si_commodities')) {
        return {
          rows: [
            { id: 10, hub_code: 'CMD-001', short_name: 'CPO', name: 'CPO' },
            { id: 11, hub_code: null, short_name: 'PKE', name: 'PKE' },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

describe('integration-catalog', () => {
  it('builds entities with live enum values (v5.2 hub fields)', async () => {
    const catalog = await buildIntegrationCatalog(fakeDb());
    assert.equal(catalog.api_version, '5.2');
    assert.ok(catalog.count >= 8);

    const si = catalog.entities.find((e) => e.slug === 'shipping-instruction');
    assert.ok(si);
    assert.ok(si.fields.find((f) => f.key === 'port_hub_code'));
    const cargo = si.fields.find((f) => f.key === 'cargo');
    const cargoHub = cargo.items.find((f) => f.key === 'cargo_hub_code');
    assert.deepEqual(cargoHub.enumValues, ['CMD-001']);
    const cargoType = cargo.items.find((f) => f.key === 'cargo_type');
    assert.deepEqual(cargoType.enumValues, ['CPO', 'PKE']);

    const portEntity = catalog.entities.find((e) => e.slug === 'port');
    assert.ok(portEntity.referenceRows);
    assert.equal(portEntity.referenceRows[0].jps_port_id, 1);

    const webhook = catalog.entities.find((e) => e.slug === 'webhook');
    assert.ok(webhook.fields.find((f) => f.key === 'events').enumValues.includes('status.changed'));
  });

  it('getIntegrationCatalogEntity returns one entity or null', async () => {
    const db = fakeDb();
    const port = await getIntegrationCatalogEntity(db, 'port');
    assert.equal(port.slug, 'port');
    assert.equal(await getIntegrationCatalogEntity(db, 'nope'), null);
  });
});
