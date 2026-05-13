/**
 * One-off: verify Shipping Instruction create → GET → PUT → GET captures all fields.
 * Run: node scripts/test-si-roundtrip.mjs
 * Requires API at http://localhost:3000 (admin / admin123).
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

/** Cookie + XSRF session (default) or Bearer when AUTH_RETURN_TOKEN_BODY=true on API. */
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

/** API may return DATE columns as ISO strings (e.g. …T00:00:00.000Z). */
function dateYmd(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const login = await loginRes.json();
  assert(loginRes.ok && login.user, `login failed: ${JSON.stringify(login)}`);
  const auth = authHeadersFromLogin(loginRes, login);

  const luRes = await fetch(`${BASE}/si-lookups`, { headers: auth });
  const lu = await luRes.json();
  assert(luRes.ok, `si-lookups failed: ${JSON.stringify(lu)}`);
  const loadingPurpose = lu.purposes?.find((p) => p.code === 'Loading');
  const commodity = lu.commodities?.[0];
  const metric = lu.metrics?.find((m) => m.code === 'MT') || lu.metrics?.[0];
  const term = lu.tradeTerms?.[0];
  const jetty = lu.jetties?.[0];
  const shipper = lu.shippers?.[0];
  const port = lu.loadingPorts?.[0];
  const surveyor = lu.surveyors?.[0];
  const agent = lu.agents?.[0];
  assert(loadingPurpose && commodity && metric, 'lookups missing purpose/commodity/metric');

  const etaFrom = '2026-04-01';
  const etaTo = '2026-04-05';
  const createBody = {
    reference_number: `TEST-SI-${Date.now()}`,
    vessel_name: 'TEST VESSEL ROUNDTRIP',
    voyage_no: 'V-RT-1',
    trade_term_id: term?.id ?? null,
    purpose_id: loadingPurpose.id,
    eta_from: etaFrom,
    eta_to: etaTo,
    status: 'Draft',
    preferred_jetty_id: jetty?.id ?? null,
    shipper_id: shipper?.id ?? null,
    loading_port_id: port?.id ?? null,
    surveyor_id: surveyor?.id ?? null,
    agent_id: agent?.id ?? null,
    destination_text: 'NANSHA, CHINA',
    freight_terms: 'PREPAID',
    bill_of_lading_clause: '3 ORIGINAL B/L TEST',
    consignee_text: 'TO ORDER RT',
    notify_party_text: 'NOTIFY RT LINE 1',
    bl_indicated: 'CLEAN SHIPPED ON BOARD RT',
    document_date: '2026-03-20',
    note: 'Roundtrip test note αβγ',
    breakdown: [
      {
        commodityId: commodity.id,
        metricId: metric.id,
        qty: 1234.5,
        contractNo: 'CN-RT-001',
        poNo: 'PO-RT-99',
        remarks: 'BD remark RT',
      },
    ],
  };

  const postRes = await fetch(`${BASE}/shipping-instructions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(createBody),
  });
  const created = await postRes.json();
  assert(postRes.status === 201, `POST failed ${postRes.status}: ${JSON.stringify(created)}`);
  const id = created.id;
  assert(id, 'no id in create response');

  function checkSi(row, phase) {
    assert(row.vesselName === 'TEST VESSEL ROUNDTRIP', `${phase} vesselName`);
    assert(row.referenceNumber === createBody.reference_number, `${phase} referenceNumber`);
    assert(row.voyageNo === 'V-RT-1', `${phase} voyageNo`);
    assert(row.destinationText === 'NANSHA, CHINA', `${phase} destinationText`);
    assert(row.freightTerms === 'PREPAID', `${phase} freightTerms`);
    assert(row.billOfLadingClause === '3 ORIGINAL B/L TEST', `${phase} billOfLadingClause`);
    assert(row.consigneeText === 'TO ORDER RT', `${phase} consigneeText`);
    assert(row.notifyPartyText === 'NOTIFY RT LINE 1', `${phase} notifyPartyText`);
    assert(row.blIndicated === 'CLEAN SHIPPED ON BOARD RT', `${phase} blIndicated`);
    assert(String(row.documentDate || '').slice(0, 10) === '2026-03-20', `${phase} documentDate`);
    assert(row.note === 'Roundtrip test note αβγ', `${phase} note`);
    assert(dateYmd(row.etaFrom) === etaFrom, `${phase} etaFrom (got ${row.etaFrom})`);
    assert(dateYmd(row.etaTo) === etaTo, `${phase} etaTo (got ${row.etaTo})`);
    assert(Array.isArray(row.breakdown) && row.breakdown.length === 1, `${phase} breakdown len`);
    const b = row.breakdown[0];
    assert(Math.abs(Number(b.qty) - 1234.5) < 1e-9, `${phase} breakdown qty`);
    assert(b.contractNo === 'CN-RT-001', `${phase} contractNo`);
    assert(b.poNo === 'PO-RT-99', `${phase} poNo`);
    assert(b.remarks === 'BD remark RT', `${phase} remarks`);
    assert(b.commodityName, `${phase} commodityName`);
    assert(b.metricCode, `${phase} metricCode`);
  }

  checkSi(created, 'after POST');

  const get1Res = await fetch(`${BASE}/shipping-instructions/${id}`, { headers: auth });
  const got1 = await get1Res.json();
  assert(get1Res.ok, `GET1 failed: ${JSON.stringify(got1)}`);
  checkSi(got1, 'after GET');

  const putBody = {
    vessel_name: 'TEST VESSEL ROUNDTRIP EDITED',
    voyage_no: 'V-RT-2',
    trade_term_id: created.tradeTermId,
    purpose_id: created.purposeId,
    eta_from: '2026-04-10',
    eta_to: '2026-04-12',
    status: 'Draft',
    approval_id: null,
    preferred_jetty_id: created.preferredJettyId,
    shipper_id: created.shipperId,
    loading_port_id: created.loadingPortId,
    surveyor_id: created.surveyorId,
    agent_id: created.agentId,
    reference_number: createBody.reference_number,
    destination_text: 'SINGAPORE RT',
    freight_terms: 'COLLECT',
    bill_of_lading_clause: 'UPDATED B/L CLAUSE',
    consignee_text: 'CONSIGNEE EDITED',
    notify_party_text: 'NOTIFY EDITED',
    bl_indicated: 'BL IND EDITED',
    document_date: '2026-03-25',
    note: 'Edited note δ',
    breakdown: [
      {
        commodityId: commodity.id,
        metricId: metric.id,
        qty: 99,
        contractNo: 'CN-EDIT',
        poNo: 'PO-EDIT',
        remarks: 'remarks edit',
      },
    ],
  };

  const putRes = await fetch(`${BASE}/shipping-instructions/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify(putBody),
  });
  const updated = await putRes.json();
  assert(putRes.ok, `PUT failed ${putRes.status}: ${JSON.stringify(updated)}`);

  assert(updated.vesselName === 'TEST VESSEL ROUNDTRIP EDITED', 'PUT vesselName');
  assert(updated.voyageNo === 'V-RT-2', 'PUT voyageNo');
  assert(updated.destinationText === 'SINGAPORE RT', 'PUT destinationText');
  assert(updated.freightTerms === 'COLLECT', 'PUT freightTerms');
  assert(updated.billOfLadingClause === 'UPDATED B/L CLAUSE', 'PUT billOfLadingClause');
  assert(updated.consigneeText === 'CONSIGNEE EDITED', 'PUT consigneeText');
  assert(updated.notifyPartyText === 'NOTIFY EDITED', 'PUT notifyPartyText');
  assert(updated.blIndicated === 'BL IND EDITED', 'PUT blIndicated');
  assert(String(updated.documentDate || '').slice(0, 10) === '2026-03-25', 'PUT documentDate');
  assert(updated.note === 'Edited note δ', 'PUT note');
  assert(dateYmd(updated.etaFrom) === '2026-04-10', 'PUT etaFrom');
  assert(dateYmd(updated.etaTo) === '2026-04-12', 'PUT etaTo');
  assert(Number(updated.breakdown[0].qty) === 99, 'PUT breakdown qty');
  assert(updated.breakdown[0].contractNo === 'CN-EDIT', 'PUT contractNo');

  const get2Res = await fetch(`${BASE}/shipping-instructions/${id}`, { headers: auth });
  const got2 = await get2Res.json();
  assert(get2Res.ok, `GET2 failed: ${JSON.stringify(got2)}`);
  assert(got2.vesselName === 'TEST VESSEL ROUNDTRIP EDITED', 'GET2 vesselName');
  assert(Number(got2.breakdown[0].qty) === 99, 'GET2 breakdown qty');

  console.log('OK: SI round-trip (POST → GET → PUT → GET) all asserted fields match.');
  console.log(`Test SI id=${id} (delete manually if desired).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
