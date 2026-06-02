/**
 * Integration checks after migrations 066/067: SI list/detail, plan-backed fields,
 * allocation overview SQL, shipment plan + linked SI, and schema sanity.
 *
 * Run: node scripts/test-plan-si-canonicalization.mjs
 * Requires API (default http://localhost:3000) and admin/admin123; DATABASE_URL for schema probe.
 */
import 'dotenv/config';
import pg from 'pg';

const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function authHeadersFromLogin(loginRes, loginJson) {
  if (loginJson.token) {
    return {
      Authorization: `Bearer ${loginJson.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }
  const list =
    typeof loginRes.headers.getSetCookie === 'function' ? loginRes.headers.getSetCookie() : [];
  const jar = {};
  for (const c of list) {
    const pair = c.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const at = jar.jps_at;
  const xsrf = jar.jps_xsrf;
  assert(at && xsrf, `login: no token in JSON and no session cookies: ${JSON.stringify(loginJson)}`);
  return {
    Cookie: `jps_at=${at}; jps_xsrf=${xsrf}`,
    'X-XSRF-TOKEN': xsrf,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function login() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.ok && loginJson.user, `login failed: ${JSON.stringify(loginJson)}`);
  return authHeadersFromLogin(loginRes, loginJson);
}

async function main() {
  const auth = await login();

  // --- 1) Shipping instructions list (joins shipment_plans + si_purposes) ---
  const listRes = await fetch(`${BASE}/shipping-instructions`, { headers: auth });
  const list = await listRes.json();
  assert(listRes.ok, `GET /shipping-instructions failed: ${JSON.stringify(list)}`);
  assert(Array.isArray(list), 'list must be array');
  if (list.length > 0) {
    const row = list[0];
    assert(row.vesselName != null && String(row.vesselName).length > 0, 'list row missing vesselName (plan join)');
    assert(row.purpose === 'Loading' || row.purpose === 'Unloading', `list purpose unexpected: ${row.purpose}`);
    assert(row.shipmentPlanId != null, 'list row should have shipmentPlanId');
  }

  // --- 2) Candidates (date overlap; same joins as list) ---
  const from = '2026-01-01';
  const to = '2027-12-31';
  const candRes = await fetch(
    `${BASE}/shipping-instructions/candidates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&include_incoming=1&include_berthed=1`,
    { headers: auth }
  );
  const cand = await candRes.json();
  assert(candRes.ok, `GET /shipping-instructions/candidates failed: ${JSON.stringify(cand)}`);
  assert(Array.isArray(cand), 'candidates must be array');

  // --- 3) Allocation overview (operations + incoming SI SQL; no si.vessel_name) ---
  const allocRes = await fetch(`${BASE}/allocation/overview`, { headers: auth });
  const alloc = await allocRes.json();
  assert(allocRes.ok, `GET /allocation/overview failed: ${JSON.stringify(alloc)}`);
  assert(alloc.queue != null && Array.isArray(alloc.queue), 'allocation.queue missing');
  assert(alloc.berths != null && Array.isArray(alloc.berths), 'allocation.berths missing');
  for (const q of alloc.queue.slice(0, 5)) {
    if (q.vesselName != null) assert(String(q.vesselName).length > 0, 'queue vesselName empty');
  }

  // --- 4) Shipment plans list ---
  const plansRes = await fetch(`${BASE}/shipment-plans`, { headers: auth });
  const plans = await plansRes.json();
  assert(plansRes.ok, `GET /shipment-plans failed: ${JSON.stringify(plans)}`);
  assert(Array.isArray(plans), 'shipment-plans must be array');

  // --- 5) Create draft plan + SI linked with overrides (plan UPDATE path) ---
  const luRes = await fetch(`${BASE}/si-lookups`, { headers: auth });
  const lu = await luRes.json();
  assert(luRes.ok, `si-lookups failed: ${JSON.stringify(lu)}`);
  const loadingPurpose = lu.purposes?.find((p) => p.code === 'Loading');
  const jetty = lu.jetties?.[0];
  const commodity = lu.commodities?.[0];
  const metric = lu.metrics?.find((m) => m.code === 'MT') || lu.metrics?.[0];
  const term = lu.tradeTerms?.[0];
  const shipper = lu.shippers?.[0];
  const port = lu.loadingPorts?.[0];
  assert(loadingPurpose && commodity && metric, 'lookups missing required rows');

  const planBody = {
    vessel_name: 'CANON-PLAN-VESSEL',
    purpose_id: loadingPurpose.id,
    eta: new Date('2026-06-15T12:00:00.000Z').toISOString(),
    voyage_no: 'V-CANON-PLAN',
    jetty_id: jetty?.id ?? null,
  };
  const planPost = await fetch(`${BASE}/shipment-plans`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(planBody),
  });
  const planCreated = await planPost.json();
  assert(planPost.status === 201, `POST shipment-plans failed: ${JSON.stringify(planCreated)}`);
  const planId = planCreated.id;
  assert(planId, 'plan id missing');

  const ref = `TEST-LINK-${Date.now()}`;
  const linkSiBody = {
    shipment_plan_id: planId,
    reference_number: ref,
    vessel_name: 'OVERRIDE-VESSEL-NAME',
    voyage_no: 'V-LINK-OVERRIDE',
    trade_term_id: term?.id ?? null,
    eta_from: '2026-06-10',
    eta_to: '2026-06-10',
    status: 'Draft',
    preferred_jetty_id: jetty?.id ?? null,
    approval_id: 'TEST-APPROVAL-REF',
    loading_port_id: port?.id ?? null,
    document_date: '2026-06-10',
    destination_text: 'Canonicalization test',
    freight_terms: 'PREPAID',
    breakdown: [
      {
        shipperId: shipper?.id ?? null,
        commodityId: commodity.id,
        metricId: metric.id,
        qty: 100,
        contractNo: 'CN-CANON',
        poNo: 'PO-CANON',
        remarks: 'link test',
      },
    ],
  };
  const siPost = await fetch(`${BASE}/shipping-instructions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(linkSiBody),
  });
  const siLinked = await siPost.json();
  assert(siPost.status === 201, `POST SI (linked) failed: ${JSON.stringify(siLinked)}`);
  const siId = siLinked.id;
  assert(siLinked.vesselName === 'OVERRIDE-VESSEL-NAME', `linked SI vesselName from plan: got ${siLinked.vesselName}`);
  assert(siLinked.voyageNo === 'V-LINK-OVERRIDE', `linked SI voyage: got ${siLinked.voyageNo}`);
  assert(siLinked.shipmentPlanId === planId, 'shipmentPlanId mismatch');

  const planGet = await fetch(`${BASE}/shipment-plans/${planId}`, { headers: auth });
  const planDetail = await planGet.json();
  assert(planGet.ok, `GET shipment-plans/:id failed: ${JSON.stringify(planDetail)}`);
  assert(planDetail.vesselName === 'OVERRIDE-VESSEL-NAME', `plan detail vessel after link: ${planDetail.vesselName}`);
  const childVessels = (planDetail.shippingInstructions || []).map((s) => s.vesselName);
  assert(childVessels.includes('OVERRIDE-VESSEL-NAME'), `child SIs should expose plan vessel: ${JSON.stringify(childVessels)}`);

  // --- 6) PUT SI (updates shipment_plans + si columns) ---
  const putRes = await fetch(`${BASE}/shipping-instructions/${siId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      reference_number: ref,
      vessel_name: 'PUT-UPDATED-VESSEL',
      voyage_no: 'V-AFTER-PUT',
      trade_term_id: siLinked.tradeTermId,
      purpose_id: siLinked.purposeId,
      eta_from: '2026-06-11',
      eta_to: '2026-06-11',
      status: 'Draft',
      preferred_jetty_id: siLinked.preferredJettyId,
      loading_port_id: siLinked.loadingPortId,
      destination_text: 'PUT destination',
      freight_terms: 'PREPAID',
      document_date: '2026-06-11',
      breakdown: siLinked.breakdown,
    }),
  });
  const putJson = await putRes.json();
  assert(putRes.ok, `PUT SI failed: ${JSON.stringify(putJson)}`);
  assert(putJson.vesselName === 'PUT-UPDATED-VESSEL', `PUT vessel: ${putJson.vesselName}`);
  assert(putJson.voyageNo === 'V-AFTER-PUT', `PUT voyage: ${putJson.voyageNo}`);

  // --- 7) Schema: dropped columns must not exist on shipping_instructions ---
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl, 'DATABASE_URL required for schema check');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const colRes = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'shipping_instructions'
         AND column_name IN (
           'vessel_name','purpose','eta','purpose_id','preferred_jetty_id',
           'approval_id','voyage_no','approved_by_user_id','approved_at','port_id'
         )`
    );
    assert(
      colRes.rows.length === 0,
      `067 not applied? Found columns: ${colRes.rows.map((r) => r.column_name).join(', ')}`
    );
    const planCol = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'shipment_plans' AND column_name = 'approval_id'`
    );
    assert(planCol.rows.length === 1, 'shipment_plans.approval_id missing (066)');
  } finally {
    await pool.end();
  }

  console.log('OK: plan/SI canonicalization integration tests passed.');
  console.log(`  Created draft plan id=${planId} and linked SI id=${siId} (safe to delete manually).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
