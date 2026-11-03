import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHubOrganization } from './datahub-client.js';
import { buildOrganizationSyncPlan } from './datahub-organization-sync.js';

describe('datahub-organization-sync', () => {
  it('maps company fields from the hub payload', () => {
    const hub = normalizeHubOrganization({
      id: '11111111-1111-1111-1111-111111111111',
      version: 3,
      data: {
        code: 'ORG-0004',
        name: 'PT Energi Unggul Persada',
        short_name: 'EUP',
        company_code_sap: 'EUP01',
        country: 'ID',
        is_active: true,
      },
    });
    assert.equal(hub.hubCode, 'ORG-0004');
    assert.equal(hub.values.name, 'PT Energi Unggul Persada');
    assert.equal(hub.values.short_name, 'EUP');
    assert.equal(hub.values.company_code_sap, 'EUP01');
    assert.equal(hub.values.country, 'ID');
    assert.equal(hub.values.is_active, true);
  });

  it('accepts SAP code aliases and an inactive flag', () => {
    const hub = normalizeHubOrganization({
      id: '22222222-2222-2222-2222-222222222222',
      version: 1,
      data: { code: 'ORG-0008', name: 'Cemindo', Company_Code_SAP: 'CMD', is_active: false },
    });
    assert.equal(hub.values.company_code_sap, 'CMD');
    assert.equal(hub.values.is_active, false);
  });

  it('matches an unlinked local row by name and flags a SAP change', () => {
    const hub = [
      normalizeHubOrganization({
        id: '33333333-3333-3333-3333-333333333333',
        version: 2,
        data: { code: 'ORG-0001', name: 'EUP', short_name: 'EUP', company_code_sap: 'NEW' },
      }),
    ];
    const local = [{ id: 9, hub_code: null, name: 'EUP', short_name: 'EUP', company_code_sap: 'OLD', country: null, is_active: true }];
    const { items, summary } = buildOrganizationSyncPlan(hub, local);
    assert.equal(summary.changedCount, 1);
    assert.equal(items[0].localId, 9);
    assert.equal(items[0].fieldDiff.company_code_sap.to, 'NEW');
  });

  it('leaves a linked unchanged company out of the change count', () => {
    const hub = [
      normalizeHubOrganization({
        id: '33333333-3333-3333-3333-333333333333',
        version: 2,
        data: { code: 'ORG-0001', name: 'EUP', short_name: 'EUP', country: 'ID', is_active: true },
      }),
    ];
    const local = [{ id: 9, hub_code: 'ORG-0001', name: 'EUP', short_name: 'EUP', company_code_sap: null, country: 'ID', is_active: true }];
    const { summary } = buildOrganizationSyncPlan(hub, local);
    assert.equal(summary.unchangedCount, 1);
    assert.equal(summary.newCount, 0);
  });
});
