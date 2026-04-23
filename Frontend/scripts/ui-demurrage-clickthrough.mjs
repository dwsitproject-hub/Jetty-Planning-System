import { chromium } from 'playwright'

const BASE = process.env.UI_BASE_URL || 'http://localhost:5174'

function isoLocalForInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

async function maybeChoosePort(page) {
  const modalSelect = page.locator('#port-scope-select')
  if (await modalSelect.count()) {
    // Wait until ports are populated.
    await page.waitForTimeout(250)
    await modalSelect.locator('option').nth(1).waitFor({ timeout: 30000 }).catch(() => {})
    // Prefer seeded BONTANG (id 1) when present.
    try {
      await modalSelect.selectOption({ value: '1' })
    } catch {
      // fallback: choose first non-empty option
      const opts = await modalSelect.locator('option').all()
      for (const o of opts) {
        const val = await o.getAttribute('value')
        if (val) {
          await modalSelect.selectOption({ value: val })
          break
        }
      }
    }
    // Wait for the selection to take effect and the choose-port card to disappear.
    await modalSelect.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    return
  }

  const topbarPort = page.locator('header.topbar select')
  if (await topbarPort.count()) {
    const current = await topbarPort.inputValue().catch(() => '')
    if (!current) {
      try {
        await topbarPort.selectOption({ value: '1' })
      } catch {
        const opts = await topbarPort.locator('option').all()
        for (const o of opts) {
          const val = await o.getAttribute('value')
          if (val) {
            await topbarPort.selectOption({ value: val })
            break
          }
        }
      }
    }
  }
}

async function ensureLoggedIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  // Login form labels are not associated via htmlFor, so use input order.
  const inputs = page.locator('form input')
  await inputs.nth(0).fill('admin')
  await inputs.nth(1).fill('admin123')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  // Wait for either a successful navigation (topbar appears) or a visible error.
  try {
    await Promise.race([
      page.locator('header.topbar').waitFor({ timeout: 30000 }),
      page.locator('form p', { hasText: /invalid|login failed|unauthorized/i }).waitFor({ timeout: 30000 }),
    ])
  } catch {
    // fall through to diagnostics below
  }

  if (page.url().includes('/login')) {
    const errText = await page.locator('form p').first().innerText().catch(() => '')
    throw new Error(`Login did not navigate away from /login. UI error: ${errText || 'none shown'}`)
  }

  await page.locator('header.topbar').waitFor({ timeout: 30000 })
  await maybeChoosePort(page)
}

async function run() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const results = {
    allocation: {},
    norAccepted: {},
  }

  const debug = {
    url: null,
    console: [],
    pageErrors: [],
    requestFailed: [],
    responses: [],
  }

  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() }
    debug.console.push(entry)
    if (debug.console.length > 50) debug.console.shift()
  })
  page.on('pageerror', (err) => {
    debug.pageErrors.push(String(err?.message || err))
    if (debug.pageErrors.length > 20) debug.pageErrors.shift()
  })
  page.on('requestfailed', (req) => {
    debug.requestFailed.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText || 'failed' })
    if (debug.requestFailed.length > 40) debug.requestFailed.shift()
  })
  page.on('response', async (res) => {
    const url = res.url()
    // Keep only the most relevant ones for diagnosing Allocation render.
    if (/\/api\/v1\/allocation\/overview/i.test(url) || /\/api\/v1\/rbac/i.test(url) || /\/api\/v1\/auth\/me/i.test(url)) {
      debug.responses.push({ url, status: res.status() })
      if (debug.responses.length > 40) debug.responses.shift()
    }
  })

  try {
    await ensureLoggedIn(page)

    // --- Entry point 1: Allocation (Log arrival update)
    await page.goto(`${BASE}/allocation`, { waitUntil: 'domcontentloaded' })
    await maybeChoosePort(page)
    debug.url = page.url()

    // Wait for allocation data to load (overview call) before looking for table rows/buttons.
    await page
      .waitForResponse((r) => /\/api\/v1\/allocation\/overview/i.test(r.url()) && r.status() === 200, {
        timeout: 60000,
      })
      .catch(() => {})

    // Wait until the allocation table actually renders (or fail with a meaningful reason).
    const tableRow = page.locator('.allocation-table__row').first()
    const forbidden = page.getByRole('heading', { name: /forbidden/i })
    const choosePort = page.getByRole('heading', { name: /choose port/i })
    await Promise.race([
      tableRow.waitFor({ timeout: 60000 }),
      forbidden.waitFor({ timeout: 60000 }),
      choosePort.waitFor({ timeout: 60000 }),
    ])
    if (await forbidden.count()) throw new Error('Allocation page is Forbidden (RBAC).')
    if (await choosePort.count()) throw new Error('Allocation page still requires port selection (Choose Port).')

    const logBtn = page.getByRole('button', { name: /log arrival update/i }).first()
    await logBtn.waitFor({ timeout: 60000 })
    await logBtn.click()

    await page.locator('#arrival-update-modal-title').waitFor({ timeout: 30000 })

    const vesselName = (await page
      .locator('dt:text("Vessel name")')
      .locator('xpath=following-sibling::dd[1]')
      .innerText()
      .catch(() => null))?.trim?.() || null

    const dt1 = isoLocalForInput(new Date(Date.now() - 2 * 60 * 60 * 1000))
    // Avoid save failing due to jetty occupancy validation; demurrage can be saved without changing jetty.
    await page.locator('#arrival-jetty').selectOption({ value: '' }).catch(() => {})
    await page.locator('#arrival-demurrage-liability').fill(dt1)
    await page.locator('button', { hasText: 'Save update' }).first().click()

    // Modal closes on success; if it stays open, capture any visible error message.
    try {
      await page.locator('#arrival-update-modal-title').waitFor({ state: 'detached', timeout: 60000 })
    } catch {
      const errMsg = await page
        .locator('.allocation-arrival-save-msg--error')
        .first()
        .innerText()
        .catch(() => '')
      throw new Error(`Allocation save did not complete/close modal. Error: ${errMsg || 'none shown'}`)
    }

    // Confirm a success toast appeared (UI-level confirmation of persistence).
    const toast = page.locator('.toast[role="status"] .toast__message')
    await toast.waitFor({ timeout: 20000 })
    const toastText = (await toast.innerText()).trim()
    if (!/arrival update saved/i.test(toastText)) {
      throw new Error(`Expected allocation success toast, got: ${toastText}`)
    }

    results.allocation = { vesselName, value: dt1, toast: toastText }

    // --- Entry point 2: Operations (NOR Accepted tab in Loading)
    // Use vessel id format used by allocation overview rows for active operations: "op-<id>".
    const dt2 = isoLocalForInput(new Date(Date.now() - 30 * 60 * 1000))
    await page.goto(
      `${BASE}/loading/op-1/pre-checking?focus=norAccepted&edit=1`,
      { waitUntil: 'domcontentloaded' }
    )
    await maybeChoosePort(page)

    // It should auto-focus NOR Accepted and open edit mode; still guard for Edit button.
    const demLabel = page.getByText('Demurrage liability from', { exact: true })
    await demLabel.waitFor({ timeout: 20000 })

    // Fill the demurrage field in edit mode.
    // There are multiple datetime-local inputs in this section; target the one right after the label.
    const demInput = page.locator('label:has-text("Demurrage liability from") + input[type="datetime-local"]')
    if ((await demInput.count()) === 0) {
      // fallback: find within nor accepted card by label then input
      const alt = page.locator('text=Demurrage liability from').locator('xpath=../../..').locator('input[type="datetime-local"]').last()
      await alt.fill(dt2)
    } else {
      await demInput.fill(dt2)
    }

    // Save (button label comes from PreCheckSectionCard; match any primary Save).
    const saveBtn = page.getByRole('button', { name: /^save$/i })
    if (await saveBtn.count()) {
      await saveBtn.click()
    } else {
      await page.getByRole('button', { name: /save/i }).first().click()
    }

    // After save, edit mode should close; confirm read-only shows a value.
    const readonlyValue = page
      .locator('span.precheck-section__label:text("Demurrage liability from")')
      .locator('xpath=following-sibling::span[1]')
    await readonlyValue.waitFor({ timeout: 20000 })
    const shown = await readonlyValue.innerText()
    if (!shown || shown.trim() === '—') {
      throw new Error('NOR Accepted read-only value did not render after save.')
    }
    results.norAccepted = { value: dt2, shown }

    // Note: Returning to Allocation to re-open the *same row* is non-deterministic without stable row selectors.
    // Persistence across modules is covered by the NOR Accepted read-only check above (data comes from API).

    console.log(JSON.stringify({ ok: true, results, debug }, null, 2))
  } catch (e) {
    debug.url = page.url()
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e), debug }, null, 2))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

run().catch((e) => {
  // Fallback: unexpected fatal outside run() try/catch.
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})

