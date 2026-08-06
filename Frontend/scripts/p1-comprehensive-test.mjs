/**
 * One-off P1 comprehensive test (login + port + Allocation/Clearance/API).
 * Run: node scripts/p1-comprehensive-test.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const BACKEND = process.env.E2E_API_ORIGIN || 'http://localhost:3000';
const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin123';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, detail = '') {
  results.push({ name, ok: null, detail });
  console.log(`○ ${name} (skipped)${detail ? ` — ${detail}` : ''}`);
}

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('#login-username').fill(USER);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20000 });

  if (page.url().includes('/select-port')) {
    await page.locator('#select-port-id').waitFor({ state: 'visible', timeout: 15000 });
    const firstPort = page.locator('#select-port-id option[value]:not([value=""])').first();
    const val = await firstPort.getAttribute('value');
    await page.locator('#select-port-id').selectOption(val);
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/select-port'), { timeout: 20000 });
  }
}

async function apiGet(page, path) {
  const cookies = await page.context().cookies();
  const at = cookies.find((c) => c.name === 'jps_at')?.value;
  const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;
  return page.request.get(`${BACKEND}${path}`, {
    headers: {
      Cookie: `jps_at=${at}; jps_xsrf=${xsrf}`,
      'X-XSRF-TOKEN': xsrf || '',
    },
  });
}

async function apiPost(page, path, data) {
  const cookies = await page.context().cookies();
  const at = cookies.find((c) => c.name === 'jps_at')?.value;
  const xsrf = cookies.find((c) => c.name === 'jps_xsrf')?.value;
  return page.request.post(`${BACKEND}${path}`, {
    headers: {
      Cookie: `jps_at=${at}; jps_xsrf=${xsrf}`,
      'X-XSRF-TOKEN': xsrf || '',
      'Content-Type': 'application/json',
    },
    data,
  });
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await signIn(page);
  pass('Login + port selection');

  const me = await apiGet(page, '/api/v1/users/me');
  if (me.status() === 200) pass('Authenticated API session');
  else fail('Authenticated API session', `status ${me.status()}`);

  // --- API: future cast-off rejected ---
  const ready = await apiGet(page, '/api/v1/operations?status=SIGNOFF_APPROVED');
  if (ready.status() !== 200) {
    fail('API GET SIGNOFF_APPROVED', `status ${ready.status()}`);
  } else {
    const ops = await ready.json();
    if (!Array.isArray(ops) || ops.length === 0) {
      skip('API depart rejects future cast_off_at', 'No SIGNOFF_APPROVED operations');
    } else {
      const opId = ops[0].id;
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const depart = await apiPost(page, `/api/v1/operations/${opId}/depart`, { cast_off_at: future });
      if (depart.status() === 400) {
        const body = await depart.json();
        if (/future/i.test(body.error || '')) pass('API depart rejects future cast_off_at', body.error);
        else fail('API depart rejects future cast_off_at', `400 but wrong message: ${body.error}`);
      } else {
        fail('API depart rejects future cast_off_at', `expected 400, got ${depart.status()}`);
      }
    }
  }

  // --- Clearance: Sailed read-only modal ---
  await page.goto(`${BASE}/verification`);
  await page.getByRole('heading', { level: 1, name: /clearance/i }).waitFor({ timeout: 15000 });
  pass('Clearance page loads');

  const sailedBtn = page.getByRole('button', { name: /sailed \(\d+\)/i });
  if (await sailedBtn.isVisible().catch(() => false)) {
    await sailedBtn.click();
    const viewBtn = page.locator('table tbody tr').first().getByRole('button', { name: /^view$/i });
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
      const modal = page.locator('.modal').filter({ hasText: /\(Sailed\)/i });
      if (await modal.isVisible({ timeout: 10000 })) {
        pass('Clearance Sailed modal opens');
        const castOff = page.locator('#clearance-cast-off');
        if (await castOff.isDisabled()) pass('Clearance Sailed: cast-off field disabled');
        else fail('Clearance Sailed: cast-off field disabled', 'field is editable');
        const readOnly = await page.getByText(/already sailed|read-only/i).isVisible().catch(() => false);
        if (readOnly) pass('Clearance Sailed: read-only message shown');
        else fail('Clearance Sailed: read-only message shown');
      } else fail('Clearance Sailed modal opens');
      await page.keyboard.press('Escape');
    } else skip('Clearance Sailed read-only modal', 'No SAILED rows in table');
  } else skip('Clearance Sailed read-only modal', 'Sailed filter button not found');

  // --- Clearance: future cast-off validation ---
  await page.goto(`${BASE}/verification`);
  await page.getByRole('button', { name: /ready to sail/i }).click();
  const readyView = page.getByRole('button', { name: /^view$/i }).first();
  if (await readyView.isVisible().catch(() => false)) {
    await readyView.click();
    await page.locator('#clearance-cast-off').waitFor({ state: 'visible', timeout: 10000 });
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const futureLocal = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    await page.locator('#clearance-cast-off').fill(futureLocal);
    await page.getByRole('button', { name: /record depart/i }).click();
    if (await page.getByText(/cannot be in the future/i).isVisible({ timeout: 5000 }).catch(() => false)) {
      pass('Clearance UI rejects future cast-off');
    } else {
      fail('Clearance UI rejects future cast-off', 'validation message not shown');
    }
    await page.keyboard.press('Escape');
  } else {
    skip('Clearance UI rejects future cast-off', 'No Ready to Sail operation');
  }

  // --- Allocation: SAILED vessel pipeline ---
  await page.goto(`${BASE}/allocation-plans`);
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });
  pass('Allocation page loads');

  const schematicTab = page.getByRole('tab', { name: /schematic|jetty layout/i }).first();
  if (await schematicTab.isVisible()) await schematicTab.click();

  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.isVisible()) {
    for (const d of ['2026-06-08', '2026-05-10', '2026-06-20']) {
      await dateInput.fill(d);
      await page.waitForTimeout(800);
      const vesselSlot = page.locator('.jetty-schematic__slot--load, .jetty-schematic__slot--disch').first();
      if (await vesselSlot.isVisible().catch(() => false)) {
        await vesselSlot.click();
        const dialog = page.locator('.modal');
        if (await dialog.isVisible({ timeout: 10000 })) {
          const sailedText = await dialog.getByText(/current:\s*sailed/i).isVisible().catch(() => false);
          const atBerthText = await dialog.getByText(/current:\s*at-berth/i).isVisible().catch(() => false);
          if (sailedText && !atBerthText) {
            pass('Allocation modal shows Current: Sailed', `date ${d}`);
          } else if (atBerthText) {
            skip('Allocation modal shows Current: Sailed', `vessel on ${d} is not SAILED (shows At-Berth)`);
          } else {
            const pipeline = await dialog.textContent();
            skip('Allocation modal shows Current: Sailed', `pipeline text: ${(pipeline || '').slice(0, 120)}`);
          }
          await page.keyboard.press('Escape');
          break;
        }
      }
    }
    const anySlot = page.locator('.jetty-schematic__slot--load, .jetty-schematic__slot--disch').first();
    if (!(await anySlot.isVisible().catch(() => false))) {
      skip('Allocation modal shows Current: Sailed', 'No occupied schematic slot on tried dates');
    }
  } else {
    skip('Allocation modal shows Current: Sailed', 'No date input / schematic view');
  }

  // --- Queue/list: find SAILED vessel in allocation queue if visible ---
  const sailedOps = await apiGet(page, '/api/v1/operations?status=SAILED');
  if (sailedOps.status() === 200) {
    const sailed = await sailedOps.json();
    if (Array.isArray(sailed) && sailed.length > 0) {
      pass('DB has SAILED operations', `${sailed.length} row(s)`);
    } else {
      skip('DB has SAILED operations', 'none in local DB');
    }
  }
} catch (err) {
  fail('Unexpected error', err.message);
  console.error(err);
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`\n--- Summary: ${passed} passed, ${failed} failed, ${skipped} skipped ---`);
process.exit(failed > 0 ? 1 : 0);
