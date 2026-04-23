/**
 * One-off: set admin user password to bcrypt hash of "admin123" (Step 1.9).
 * Run once after deploying 1.9: npm run seed:admin (or docker compose exec jps-api npm run seed:admin)
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from '../src/db.js';

const hash = await bcrypt.hash('admin123', 10);
const result = await pool.query(
  `UPDATE users SET password_hash = $1 WHERE username = 'admin' AND deleted_at IS NULL RETURNING id`,
  [hash]
);
if (result.rowCount === 0) {
  console.log('No user "admin" found; run migrations first (002_seed_first_user.sql).');
} else {
  console.log('Admin password updated to bcrypt hash (password: admin123).');
}
await pool.end();
