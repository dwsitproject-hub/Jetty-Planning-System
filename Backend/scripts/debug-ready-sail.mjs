import 'dotenv/config';
import { pool } from '../src/db.js';

const r = await pool.query(`
  SELECT sp.vessel_name, o.id AS op_id, o.status, o.cast_off_at, o.operations_completed_at,
         j.name AS jetty_name
  FROM operations o
  JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
  LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
  LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id)
  WHERE sp.vessel_name ILIKE '%READY SAIL%'
  ORDER BY o.id
`);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
