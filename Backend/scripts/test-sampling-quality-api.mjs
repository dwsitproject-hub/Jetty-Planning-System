/**
 * Sampling quality summary columns: validation, omit-preserves merge, formatted round-trip.
 * Run: node scripts/test-sampling-quality-api.mjs
 * Requires the API at http://localhost:3000 and a Pre-Checking-capable operation.
 *
 * Writes to a real operation's sampling row and restores it at the end.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const USERNAME = process.env.JPS_USER || 'rian.dharmawan@energi-up.com';
const PASSWORD = process.env.JPS_PASS || 'Rian.dharmawan@energi-up.com1';

let failures = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function check(label, cond, detail = '') {
  if (cond) {
    console.log(`OK   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
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
  assert(jar.jps_at && jar.jps_xsrf, `login: no token in JSON and no session cookies`);
  return {
    Cookie: `jps_at=${jar.jps_at}; jps_xsrf=${jar.jps_xsrf}`,
    'X-XSRF-TOKEN': jar.jps_xsrf,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const login = await loginRes.json();
  assert(loginRes.ok && login.user, `login failed: ${JSON.stringify(login)}`);
  const auth = authHeadersFromLogin(loginRes, login);

  const opsRes = await fetch(`${BASE}/operations`, { headers: auth });
  const ops = await opsRes.json();
  const list = Array.isArray(ops) ? ops : ops.items || ops.data || [];
  assert(opsRes.ok && list.length, `no operations to test against: ${JSON.stringify(ops).slice(0, 200)}`);
  const operationId = list[0].id;
  console.log(`Using operation ${operationId}\n`);

  const url = `${BASE}/operations/${operationId}/sub-processes/sampling`;
  const put = async (body) => {
    const res = await fetch(url, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  /** Only the list endpoint reads sub-processes back; there is no single-key GET. */
  const get = async (key = 'sampling') => {
    const res = await fetch(`${BASE}/operations/${operationId}/sub-processes?phase=Pre-Checking`, {
      headers: auth,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).find((r) => r.subProcessKey === key) || null;
  };

  const original = await get();
  const base = { phase: 'Pre-Checking', status: 'Done' };

  // 1. Values round-trip formatted: "1.9" comes back "1.90", never "1.900".
  const saved = await put({
    ...base,
    remark: 'quality summary api check',
    ffaAverage: '7.62',
    moistureAverage: '0.26',
    dobi: '1.9',
    iodineValue: '52.11',
    payload: { records: [] },
  });
  check('save accepts the four quality values', saved.status === 200, JSON.stringify(saved.json));
  check(
    'values round-trip formatted to 2dp',
    saved.json?.ffaAverage === '7.62' &&
      saved.json?.moistureAverage === '0.26' &&
      saved.json?.dobi === '1.90' &&
      saved.json?.iodineValue === '52.11',
    JSON.stringify({
      ffaAverage: saved.json?.ffaAverage,
      moistureAverage: saved.json?.moistureAverage,
      dobi: saved.json?.dobi,
      iodineValue: saved.json?.iodineValue,
    })
  );

  // 2. A save that omits the fields must not wipe them — the trap payload_json had.
  const omitted = await put({ ...base, remark: 'omitted quality fields', payload: { records: [] } });
  check(
    'omitting the fields preserves the stored values',
    omitted.status === 200 && omitted.json?.dobi === '1.90' && omitted.json?.iodineValue === '52.11',
    JSON.stringify({ status: omitted.status, dobi: omitted.json?.dobi, iodineValue: omitted.json?.iodineValue })
  );

  // 3. Bad values are rejected rather than coerced or silently dropped.
  const badCases = [
    ['unparseable text', { ffaAverage: 'abc' }],
    ['negative value', { moistureAverage: '-1' }],
    ['DOBI above its ceiling', { dobi: '500' }],
    ['iodine above its ceiling', { iodineValue: '250' }],
  ];
  for (const [label, over] of badCases) {
    const res = await put({ ...base, ...over, payload: { records: [] } });
    check(`400 on ${label}`, res.status === 400, `got ${res.status} ${JSON.stringify(res.json)}`);
  }

  const stillThere = await get();
  check(
    'a rejected save leaves the stored values untouched',
    stillThere?.dobi === '1.90',
    JSON.stringify({ dobi: stillThere?.dobi })
  );

  // 4. Iodine value is allowed above 100, where the other three are not.
  const highIodine = await put({ ...base, iodineValue: '150.5', payload: { records: [] } });
  check(
    'iodine value accepts 150.5',
    highIodine.status === 200 && highIodine.json?.iodineValue === '150.50',
    JSON.stringify({ status: highIodine.status, iodineValue: highIodine.json?.iodineValue })
  );

  // 5. An explicit empty string clears the column.
  const cleared = await put({ ...base, dobi: '', payload: { records: [] } });
  check('empty string clears the column', cleared.status === 200 && cleared.json?.dobi === null, JSON.stringify({ dobi: cleared.json?.dobi }));

  // 6. No other sub-process can write these columns.
  const inspection = await fetch(`${BASE}/operations/${operationId}/sub-processes/inspection`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ phase: 'Pre-Checking', status: 'Done', dobi: '9.99', payload: { inspectionType: 'Tank' } }),
  });
  const inspectionJson = await inspection.json().catch(() => null);
  check(
    'a non-sampling sub-process ignores the quality fields',
    inspection.status === 200 && inspectionJson?.dobi === null,
    JSON.stringify({ status: inspection.status, dobi: inspectionJson?.dobi })
  );

  // Restore whatever the operation held before this run.
  await put({
    phase: 'Pre-Checking',
    status: original?.status || 'Done',
    startAt: original?.startAt ?? null,
    endAt: original?.endAt ?? null,
    remark: original?.remark ?? '',
    ffaAverage: original?.ffaAverage ?? '',
    moistureAverage: original?.moistureAverage ?? '',
    dobi: original?.dobi ?? '',
    iodineValue: original?.iodineValue ?? '',
    payload: original?.payload ?? { records: [] },
  });
  const restored = await get();
  check(
    'original sampling row restored',
    (restored?.dobi ?? '') === (original?.dobi ?? ''),
    JSON.stringify({ before: original?.dobi, after: restored?.dobi })
  );

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sampling quality API checks passed');
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
