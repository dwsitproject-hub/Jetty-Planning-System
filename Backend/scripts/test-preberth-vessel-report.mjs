/**
 * Create PENDING + ALLOCATED pre-berth operations (no TB) and verify Vessel Activities Report inclusion.
 * Usage: node Backend/scripts/test-preberth-vessel-report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const API = 'http://localhost:3000/api/v1'
const PORT_ID = '1'
const COOKIE_FILE = join(ROOT, 'tmp-preberth-test-cookies.txt')
const ETA = '2026-09-10T03:00:00.000Z'
const ETB = '2026-09-11T03:00:00.000Z'
const DATE_START = '2026-09-08'
const DATE_END = '2026-09-15'

const stamp = Date.now()
const VESSEL_PENDING = `VAR-PENDING-${stamp}`
const VESSEL_ALLOCATED = `VAR-ALLOC-${stamp}`

function parseSetCookie(setCookie) {
  if (!setCookie) return {}
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar = {}
  for (const part of parts) {
    const [name, ...rest] = part.split(';')[0].split('=')
    jar[name.trim()] = rest.join('=')
  }
  return jar
}

function mergeCookieJar(existing, incoming) {
  const existingMap = {}
  if (existing.cookie) {
    for (const pair of existing.cookie.split('; ').filter(Boolean)) {
      const [name, ...rest] = pair.split('=')
      existingMap[name] = rest.join('=')
    }
  }
  Object.assign(existingMap, incoming)
  const cookie = Object.entries(existingMap)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return {
    cookie,
    xsrf: incoming.jps_xsrf ?? existing.xsrf ?? existingMap.jps_xsrf ?? null,
  }
}

function loadCookieJar() {
  try {
    const raw = readFileSync(COOKIE_FILE, 'utf8').trim()
    const [cookieLine, xsrfLine] = raw.split('\n')
    return { cookie: cookieLine || '', xsrf: xsrfLine || null }
  } catch {
    return { cookie: '', xsrf: null }
  }
}

function saveCookieJar({ cookie, xsrf }) {
  writeFileSync(COOKIE_FILE, [cookie, xsrf || ''].join('\n'), 'utf8')
}

async function api(method, path, body, jar = loadCookieJar()) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Selected-Port-Id': PORT_ID,
  }
  if (jar.cookie) headers.Cookie = jar.cookie
  if (jar.xsrf) headers['X-XSRF-TOKEN'] = jar.xsrf
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.getSetCookie?.() ?? res.headers.get('set-cookie')
  const nextJar = mergeCookieJar(jar, parseSetCookie(setCookie))
  if (nextJar.cookie) saveCookieJar(nextJar)
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

async function login() {
  const bodies = [
    { username: 'admin', password: 'admin123' },
    { username: 'admin', password: 'DNHjh7YzyICdDT*b' },
  ]
  for (const body of bodies) {
    try {
      await api('POST', '/auth/login', body, { cookie: '', xsrf: null })
      console.log('Logged in as admin')
      return
    } catch {
      /* try next password */
    }
  }
  throw new Error('Login failed with known admin passwords')
}

async function getLookups() {
  const lk = await api('GET', '/si-lookups')
  const purpose = lk.purposes?.[0]
  const commodity = lk.commodities?.[0]
  const metric = lk.metrics?.[0]
  if (!purpose || !commodity || !metric) {
    throw new Error(`Missing lookups: ${JSON.stringify({ purpose, commodity, metric })}`)
  }
  return { purpose, commodity, metric }
}

async function createApprovedPlanWithSi({ vesselName, siRef, lookups }) {
  const plan = await api('POST', '/shipment-plans', {
    vessel_name: vesselName,
    vessel_capacity: 50000,
    vessel_loa_m: 200,
    vessel_gross_tonnage: 30000,
    vessel_draft: 12,
    purpose_id: lookups.purpose.id,
    eta: ETA,
  })
  const si = await api('POST', '/shipping-instructions', {
    shipment_plan_id: plan.id,
    reference_number: siRef,
    breakdown: [
      {
        commodity_id: lookups.commodity.id,
        metric_id: lookups.metric.id,
        qty: 1000,
      },
    ],
  })
  await api('POST', `/shipment-plans/${plan.id}/submit`, {})
  await api('POST', `/shipment-plans/${plan.id}/approve`, {
    reason: 'Pre-berth vessel activities report test',
  })
  return { plan, si }
}

async function createPendingOperation(siId) {
  const op = await api('PUT', '/allocation/arrival', {
    shippingInstructionId: siId,
    etaDateTime: ETA,
  })
  return op.operationId
}

async function createAllocatedOperation(siId) {
  const op = await api('PUT', '/allocation/arrival', {
    shippingInstructionId: siId,
    etaDateTime: ETA,
    etbDateTime: ETB,
    jetty: '1A',
  })
  const operationId = op.operationId
  await api('PUT', `/operations/${operationId}`, { status: 'ALLOCATED' })
  return operationId
}

function operationIsEligibleForReport(op) {
  if (!op) return false
  const st = String(op.status || '').toUpperCase()
  const hasBerthMark = Boolean(op.dockingStartTime || op.tbAt)
  if (st === 'SAILED') return hasBerthMark
  if (['PENDING', 'ALLOCATED'].includes(st)) return true
  if (['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(st)) return true
  return hasBerthMark
}

function scheduleOverlaps(op, overviewRow, startDate, endDate) {
  const start = new Date(startDate)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setUTCHours(23, 59, 59, 999)
  const dates = [
    op?.eta,
    op?.ta,
    op?.etb,
    op?.tbAt,
    op?.dockingStartTime,
    overviewRow?.etaDateTime,
    overviewRow?.etbDateTime,
  ].filter(Boolean)
  return dates.some((iso) => {
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t >= start.getTime() && t <= end.getTime()
  })
}

async function verifyReport({ pendingOpId, allocatedOpId }) {
  const ids = [Number(pendingOpId), Number(allocatedOpId)]
  const [overview, plans] = await Promise.all([
    api('GET', '/allocation/overview'),
    api('GET', '/shipment-plans'),
  ])
  const overviewByOpId = new Map()
  for (const row of overview?.queue || []) {
    if (row.operationId != null) overviewByOpId.set(Number(row.operationId), row)
  }

  const results = []
  for (const id of ids) {
    const op = await api('GET', `/operations/${id}`)
    const overviewRow = overviewByOpId.get(id) || null
    const eligible = operationIsEligibleForReport(op)
    const inRange = scheduleOverlaps(op, overviewRow, DATE_START, DATE_END)
    const hasTb = Boolean(op.tbAt || op.dockingStartTime)
    results.push({
      operationId: op.id,
      vessel: op.vesselName,
      status: op.status,
      hasTb,
      eligible,
      scheduleInRange: inRange,
      wouldAppearInReport: eligible && inRange,
      eta: op.eta,
      etb: op.etb,
      jetty: op.jettyName || null,
    })
  }

  console.log('\n--- Report verification (date range %s to %s) ---', DATE_START, DATE_END)
  console.table(results)

  const pending = results.find((r) => Number(r.operationId) === Number(pendingOpId))
  const allocated = results.find((r) => Number(r.operationId) === Number(allocatedOpId))

  if (!pending?.wouldAppearInReport) {
    throw new Error(`PENDING operation #${pendingOpId} NOT included in report`)
  }
  if (!allocated?.wouldAppearInReport) {
    throw new Error(`ALLOCATED operation #${allocatedOpId} NOT included in report`)
  }
  if (pending.hasTb || allocated.hasTb) {
    throw new Error('Test ops should not have TB yet')
  }

  console.log('\nPASS: Both PENDING and ALLOCATED pre-berth vessels would appear in the report.')
  return { pending, allocated, planCount: plans.length }
}

async function main() {
  await login()
  const lookups = await getLookups()
  console.log('Using purpose:', lookups.purpose.code, 'commodity:', lookups.commodity.name)

  const pendingBundle = await createApprovedPlanWithSi({
    vesselName: VESSEL_PENDING,
    siRef: `SI-PEND-${stamp}`,
    lookups,
  })
  const allocatedBundle = await createApprovedPlanWithSi({
    vesselName: VESSEL_ALLOCATED,
    siRef: `SI-ALLOC-${stamp}`,
    lookups,
  })

  const pendingOpId = await createPendingOperation(pendingBundle.si.id)
  const allocatedOpId = await createAllocatedOperation(allocatedBundle.si.id)

  console.log('\nCreated test data:')
  console.log({
    pending: {
      planRef: pendingBundle.plan.planReference,
      siId: pendingBundle.si.id,
      operationId: pendingOpId,
      vessel: VESSEL_PENDING,
    },
    allocated: {
      planRef: allocatedBundle.plan.planReference,
      siId: allocatedBundle.si.id,
      operationId: allocatedOpId,
      vessel: VESSEL_ALLOCATED,
    },
  })

  await verifyReport({ pendingOpId, allocatedOpId })

  console.log('\nManual UI check:')
  console.log(`  Open http://localhost:5173/reporting/daily-activities`)
  console.log(`  Date range: ${DATE_START} to ${DATE_END}`)
  console.log(`  Search vessels: ${VESSEL_PENDING}, ${VESSEL_ALLOCATED}`)
}

main().catch((e) => {
  console.error('\nFAIL:', e.message)
  if (e.body) console.error(JSON.stringify(e.body, null, 2))
  process.exit(1)
})
