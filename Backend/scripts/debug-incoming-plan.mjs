/**
 * Debug why a plan-only shipment plan is missing from allocation queue.
 * Run: docker exec jps-api node scripts/debug-incoming-plan.mjs [planRef]
 */
import pg from 'pg';

const planRef = process.argv[2] || 'SP-26-06-00020';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const planRes = await pool.query(
  `SELECT sp.id, sp.plan_reference, sp.vessel_name, sp.port_id, p.name AS port_name,
          sp.approval_status, sp.deleted_at, sp.jetty_id, j.name AS jetty_name,
          (SELECT COUNT(*)::int FROM shipping_instructions si
           WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL) AS si_count,
          (SELECT COUNT(*)::int FROM shipping_instructions si2
           JOIN operations o ON o.shipping_instruction_id = si2.id AND o.deleted_at IS NULL
           WHERE si2.shipment_plan_id = sp.id AND si2.deleted_at IS NULL) AS op_count
   FROM shipment_plans sp
   LEFT JOIN ports p ON p.id = sp.port_id
   LEFT JOIN jetties j ON j.id = sp.jetty_id
   WHERE sp.plan_reference = $1 OR sp.vessel_name ILIKE '%plan only for testing%'
   ORDER BY sp.id DESC`,
  [planRef]
);

console.log('=== Plan row(s) ===');
console.log(JSON.stringify(planRes.rows, null, 2));

if (planRes.rows.length === 0) {
  await pool.end();
  process.exit(1);
}

const plan = planRes.rows[0];
const portId = plan.port_id;

const incomingPlanRes = await pool.query(
  `SELECT sp.id, sp.plan_reference, ('plan-' || sp.id)::text AS vessel_id
   FROM shipment_plans sp
   LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
   LEFT JOIN ports p ON p.id = COALESCE(sp.port_id, j.port_id) AND p.deleted_at IS NULL
   WHERE sp.deleted_at IS NULL
     AND COALESCE(sp.port_id, p.id) = $1
     AND NOT EXISTS (
       SELECT 1 FROM shipping_instructions si
       WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM shipping_instructions si2
       JOIN operations o ON o.shipping_instruction_id = si2.id AND o.deleted_at IS NULL
       WHERE si2.shipment_plan_id = sp.id AND si2.deleted_at IS NULL
     )
     AND sp.id = $2`,
  [portId, plan.id]
);

console.log('\n=== Matches incoming-plan SQL for plan port? ===');
console.log(incomingPlanRes.rows.length ? 'YES' : 'NO');
if (!incomingPlanRes.rows.length) {
  const strictPort = await pool.query(
    `SELECT sp.id FROM shipment_plans sp WHERE sp.id = $1 AND sp.port_id = $2 AND sp.deleted_at IS NULL`,
    [plan.id, portId]
  );
  console.log('strict sp.port_id match:', strictPort.rows.length > 0);
}

const allIncoming = await pool.query(
  `SELECT sp.id, sp.plan_reference, sp.vessel_name
   FROM shipment_plans sp
   LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
   LEFT JOIN ports p ON p.id = COALESCE(sp.port_id, j.port_id) AND p.deleted_at IS NULL
   WHERE sp.deleted_at IS NULL
     AND COALESCE(sp.port_id, p.id) = $1
     AND NOT EXISTS (
       SELECT 1 FROM shipping_instructions si
       WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM shipping_instructions si2
       JOIN operations o ON o.shipping_instruction_id = si2.id AND o.deleted_at IS NULL
       WHERE si2.shipment_plan_id = sp.id AND si2.deleted_at IS NULL
     )`,
  [portId]
);
console.log('\n=== All incoming-plan rows for port', portId, plan.port_name, '===');
console.log(JSON.stringify(allIncoming.rows, null, 2));

await pool.end();
