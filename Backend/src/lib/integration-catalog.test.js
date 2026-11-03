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
      if (sql.includes('master_companies')) {
        return {
          rows: [
            {
              id: 4,
              hub_code: 'ORG-0001',
              short_name: 'EUP',
              name: 'PT ENERGI UNGGUL PERSADA',
              port_hub_codes: ['PRT-001'],
            },
          ],
        };
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
  it('builds entities with live enum values (v5.3 hub-only POST)', async () => {
    const catalog = await buildIntegrationCatalog(fakeDb());
    assert.equal(catalog.api_version, '5.7');
    assert.ok(catalog.count >= 8);

    const si = catalog.entities.find((e) => e.slug === 'shipping-instruction');
    assert.ok(si);
    assert.ok(si.fields.find((f) => f.key === 'port_hub_code'));
    const cargo = si.fields.find((f) => f.key === 'cargo');
    const cargoHub = cargo.items.find((f) => f.key === 'cargo_hub_code');
    assert.equal(cargoHub.required, true);
    assert.deepEqual(cargoHub.enumValues, ['CMD-001']);
    assert.equal(cargo.items.find((f) => f.key === 'cargo_type'), undefined);
    assert.ok(
      si.legacyFieldsRejected.some(
        (r) => r.key === 'cargo[].cargo_type' && r.useInstead === 'cargo[].cargo_hub_code',
      ),
    );
    const portHub = si.fields.find((f) => f.key === 'port_hub_code');
    assert.equal(portHub.required, true);
    const echoedPortId = si.fields.find((f) => f.key === 'port_id');
    assert.equal(echoedPortId.systemGenerated, true);
    assert.equal(echoedPortId.patchable, false);
    const companyField = si.fields.find((f) => f.key === 'company_hub_code');
    assert.equal(companyField.patchable, true);
    assert.deepEqual(companyField.enumValues, ['ORG-0001']);
    const statusField = si.fields.find((f) => f.key === 'status');
    assert.equal(statusField.systemGenerated, true);
    assert.equal(statusField.required, false);
    assert.equal(statusField.patchable, false);
    assert.deepEqual(statusField.enumValues, [
      'Pending',
      'Approved',
      'Rejected',
      'Deleted',
      'Allocated',
      'Berthed',
      'Start Cargo',
      'Cargo Done',
      'Sailed Off',
    ]);
    const approval = si.fields.find((f) => f.key === 'approval');
    assert.equal(approval.type, 'OBJECT');
    assert.deepEqual(
      approval.items.find((f) => f.key === 'status').enumValues,
      ['Submitted', 'Approved', 'Rejected', 'Deleted']
    );
    const schedule = si.fields.find((f) => f.key === 'schedule');
    assert.ok(schedule.items.find((f) => f.key === 'cargo_ops_start_at'));
    assert.ok(schedule.items.find((f) => f.key === 'cargo_ops_end_at'));
    assert.ok(schedule.items.find((f) => f.key === 'cargo_done_at'));
    assert.ok(schedule.items.find((f) => f.key === 'cast_off_at'));
    const allocation = si.fields.find((f) => f.key === 'allocation');
    assert.ok(allocation.items.find((f) => f.key === 'jetty_code'));
    assert.equal(si.fields.find((f) => f.key === 'company_name').systemGenerated, true);
    assert.equal(si.fields.find((f) => f.key === 'plan_reference').systemGenerated, true);
    assert.equal(si.fieldCount, 32);

    const company = catalog.entities.find((e) => e.slug === 'company');
    assert.equal(company.referenceRows[0].jps_company_id, 4);
    assert.deepEqual(company.referenceRows[0].port_hub_codes, ['PRT-001']);

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
