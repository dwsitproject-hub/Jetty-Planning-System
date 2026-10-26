import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../routes');

function src(name) {
  return readFileSync(path.join(routesDir, name), 'utf8');
}

describe('shipment plan master vessel route wiring', () => {
  it('create stores the snapshot and master_vessel_id', () => {
    const plans = src('shipment-plans.js');
    assert.match(plans, /snapshotActiveMasterVessel\(pool, b\.master_vessel_id\)/);
    assert.match(plans, /master_vessel_id, vessel_name, vessel_capacity/);
    assert.match(plans, /vesselSnap\.master_vessel_id/);
  });

  it('patch uses linked versus legacy vessel writes', () => {
    const plans = src('shipment-plans.js');
    assert.match(plans, /decideVesselMasterWrite/);
    assert.match(plans, /requireMasterVesselId: linked/);
  });

  it('implicit SI create writes the snapshot and master id', () => {
    const si = src('shipping-instructions.js');
    assert.match(si, /snapshotActiveMasterVessel\(pool, b\.master_vessel_id\)/);
    assert.match(si, /master_vessel_id, vessel_name, vessel_loa_m/);
    assert.match(si, /planRowBound\?\.master_vessel_id != null/);
  });

  it('partner insert stores master_vessel_id', () => {
    const integrations = src('integrations.js');
    assert.match(integrations, /port_id, master_vessel_id, vessel_name/);
    assert.match(integrations, /vesselSnap\.master_vessel_id/);
  });

  it('master vessel delete returns 409 when plans reference it', () => {
    const vessels = src('master-vessels.js');
    assert.match(vessels, /countActivePlansForMaster/);
    assert.match(vessels, /res\.status\(409\)/);
    assert.match(vessels, /Shipment plan\(s\) reference this master vessel/);
  });
});
