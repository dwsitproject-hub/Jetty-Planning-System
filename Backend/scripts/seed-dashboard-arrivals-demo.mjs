/**
 * Seed demo shipment plans for Live Ops "Arriving next …" widget (72h / 7d / 14d windows).
 * Idempotent: removes prior DEMO-* plans first.
 *
 * Run locally:
 *   cd Backend && node scripts/seed-dashboard-arrivals-demo.mjs
 * Or via Docker:
 *   docker exec jps-api node scripts/seed-dashboard-arrivals-demo.mjs
 */
import 'dotenv/config'
import { pool } from '../src/db.js'

const PORT_ID = 1

/** Demo rows relative to run date (UTC). */
const DEMOS = [
  {
    vessel: 'DEMO-OVERDUE ALPHA',
    eta: '2026-09-05T06:00:00.000Z',
    etb: '2026-09-08T02:00:00.000Z',
    ta: null,
    purposeId: 1,
    jettyId: 1,
    capacity: 12000,
    note: 'Overdue ETA, no TA (shows overdue pill)',
  },
  {
    vessel: 'DEMO-ANCHORED BETA',
    eta: '2026-09-07T14:00:00.000Z',
    etb: '2026-09-12T08:00:00.000Z',
    ta: '2026-09-08T03:30:00.000Z',
    purposeId: 2,
    jettyId: 2,
    capacity: 8500,
    note: 'Overdue ETA but TA set (at anchorage chip, no overdue pill)',
  },
  {
    vessel: 'DEMO-72H GAMMA',
    eta: '2026-09-10T11:00:00.000Z',
    etb: '2026-09-11T09:30:00.000Z',
    ta: null,
    purposeId: 1,
    jettyId: 3,
    capacity: 15000,
    note: 'Within 72h window',
  },
  {
    vessel: 'DEMO-72H DELTA',
    eta: '2026-09-11T16:00:00.000Z',
    etb: '2026-09-12T10:00:00.000Z',
    ta: null,
    purposeId: 1,
    jettyId: 4,
    capacity: 9800,
    note: 'Within 72h window',
  },
  {
    vessel: 'DEMO-7D ECHO',
    eta: '2026-09-13T08:00:00.000Z',
    etb: '2026-09-14T06:00:00.000Z',
    ta: null,
    purposeId: 2,
    jettyId: 5,
    capacity: 11200,
    note: '7d window only (beyond 72h)',
  },
  {
    vessel: 'DEMO-7D FOXTROT',
    eta: '2026-09-15T22:00:00.000Z',
    etb: '2026-09-16T14:00:00.000Z',
    ta: null,
    purposeId: 1,
    jettyId: 6,
    capacity: 7600,
    note: '7d window only',
  },
  {
    vessel: 'DEMO-14D GOLF',
    eta: '2026-09-18T05:00:00.000Z',
    etb: '2026-09-19T04:00:00.000Z',
    ta: null,
    purposeId: 2,
    jettyId: 7,
    capacity: 13400,
    note: '14d window only (beyond 7d)',
  },
  {
    vessel: 'DEMO-14D HOTEL',
    eta: '2026-09-21T12:00:00.000Z',
    etb: '2026-09-22T08:00:00.000Z',
    ta: null,
    purposeId: 1,
    jettyId: 8,
    capacity: 6200,
    note: '14d window only',
  },
  {
    vessel: 'DEMO-14D INDIA',
    eta: '2026-09-22T18:00:00.000Z',
    etb: '2026-09-23T12:00:00.000Z',
    ta: null,
    purposeId: 2,
    jettyId: 1,
    capacity: 10500,
    note: '14d window edge',
  },
]

function buildPlanReference(planId) {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `SP-${yy}-${mm}-${String(planId).padStart(5, '0')}`
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const del = await client.query(
    `UPDATE shipment_plans SET deleted_at = NOW(), updated_at = NOW()
     WHERE port_id = $1 AND vessel_name LIKE 'DEMO-%' AND deleted_at IS NULL
     RETURNING id`,
    [PORT_ID],
  )
  if (del.rowCount > 0) {
    console.log(`Soft-deleted ${del.rowCount} prior DEMO plan(s).`)
  }

  const inserted = []
  for (const d of DEMOS) {
    const ins = await client.query(
      `INSERT INTO shipment_plans (
         port_id, vessel_name, vessel_capacity, vessel_loa_m, vessel_gross_tonnage, vessel_draft,
         jetty_id, eta, ta, etb, purpose_id, voyage_no, agent_id,
         approval_status, approved_at, requested_by, remark,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, 145.00, 8500.000, 8.50,
         $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, 'DEMO', 12,
         'Approved', NOW(), 'dashboard-arrivals-demo', $9,
         NOW(), NOW()
       ) RETURNING id, vessel_name, eta`,
      [PORT_ID, d.vessel, d.capacity, d.jettyId, d.eta, d.ta, d.etb, d.purposeId, d.note],
    )
    const planId = ins.rows[0].id
    const ref = buildPlanReference(planId)
    await client.query(`UPDATE shipment_plans SET plan_reference = $1 WHERE id = $2`, [ref, planId])
    inserted.push({ id: planId, ref, vessel: d.vessel, eta: ins.rows[0].eta, note: d.note })
  }

  await client.query('COMMIT')

  console.log(`Inserted ${inserted.length} demo shipment plan(s) for port_id=${PORT_ID}:`)
  for (const row of inserted) {
    console.log(`  #${row.id} ${row.ref} | ${row.vessel} | ETA ${row.eta?.toISOString?.() ?? row.eta}`)
    console.log(`         ${row.note}`)
  }
  console.log('\nOpen Live Ops dashboard and toggle Arrivals: 3d / 7d / 14d.')
} catch (err) {
  await client.query('ROLLBACK')
  console.error(err)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
