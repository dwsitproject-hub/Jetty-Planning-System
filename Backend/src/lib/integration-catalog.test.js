import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIntegrationCatalog, getIntegrationCatalogEntity } from './integration-catalog.js';

/** Minimal fake pool: returns rows based on which table/column the SQL touches. */
function fakeDb() {
  return {
    async query(sql) {
      if (sql.includes('si_trade_terms')) return { rows: [{ code: 'FOB' }, { code: 'CIF' }] };
      if (sql.includes('si_surveyors')) return { rows: [{ name: 'PT SGS Indonesia' }] };
      if (sql.includes('si_commodities')) return { rows: [{ short_name: 'CPO' }, { short_name: 'PKE' }] };
      return { rows: [] };
    },
  };
}

describe('integration-catalog', () => {
  it('builds entities with live enum values', async () => {
    const catalog = await buildIntegrationCatalog(fakeDb());
    assert.equal(catalog.api_version, '5.1');
    assert.ok(catalog.count >= 5);

    const si = catalog.entities.find((e) => e.slug === 'shipping-instruction');
    assert.ok(si);
    const cargo = si.fields.find((f) => f.key === 'cargo');
    const cargoType = cargo.items.find((f) => f.key === 'cargo_type');
    assert.deepEqual(cargoType.enumValues, ['CPO', 'PKE']);

    const tradeTerm = si.fields.find((f) => f.key === 'trade_term');
    assert.deepEqual(tradeTerm.enumValues, ['FOB', 'CIF']);

    const webhook = catalog.entities.find((e) => e.slug === 'webhook');
    assert.ok(webhook.fields.find((f) => f.key === 'events').enumValues.includes('status.changed'));
    assert.equal(webhook.limits.maxActivePerApiKey, 3);
  });

  it('getIntegrationCatalogEntity returns one entity or null', async () => {
    const db = fakeDb();
    const webhook = await getIntegrationCatalogEntity(db, 'webhook');
    assert.equal(webhook.slug, 'webhook');
    assert.equal(await getIntegrationCatalogEntity(db, 'nope'), null);
  });
});
