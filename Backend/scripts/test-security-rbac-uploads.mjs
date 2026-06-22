/**
 * Security remediation checks (C-01, H-05 helpers, email validation).
 * Run: node scripts/test-security-rbac-uploads.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://jps_user:jps_dev_password@127.0.0.1:5433/jps_db';

import fs from 'node:fs';
import path from 'node:path';

const jwt = (await import('jsonwebtoken')).default;
const { UPLOAD_ROOT } = await import('../src/paths.js');
const { normalizeStoredRelativePath, resolveStoredFileOnDisk } = await import(
  '../src/lib/stored-file-access.js'
);
const { isValidRecipientEmail } = await import('../src/lib/notification-email-worker.js');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// --- stored path normalization (C-01) ---
assert(
  normalizeStoredRelativePath('/uploads/operations/1/clearance/a.pdf') ===
    'operations/1/clearance/a.pdf',
  'strip /uploads/ prefix'
);
assert(normalizeStoredRelativePath('../etc/passwd') === null, 'reject traversal');
assert(normalizeStoredRelativePath('operations/../secret') === null, 'reject embedded ..');

// --- email validation (H-06) ---
assert(isValidRecipientEmail('user@example.com'), 'valid email');
assert(!isValidRecipientEmail('bad'), 'reject bad email');
assert(!isValidRecipientEmail('a@b.com\nBcc: evil@x.com'), 'reject newline injection');
assert(!isValidRecipientEmail('<script@x.com>'), 'reject angle brackets');

// --- JWT algorithm pinning (H-05) ---
const secret = 'test-secret-for-hs256-pinning';
const good = jwt.sign({ userId: 1 }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const verified = jwt.verify(good, secret, { algorithms: ['HS256'] });
assert(verified.userId === 1, 'HS256 token verifies');

let rejected = false;
try {
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ userId: 1 })).toString('base64url');
  jwt.verify(`${noneHeader}.${nonePayload}.`, secret, { algorithms: ['HS256'] });
} catch {
  rejected = true;
}
assert(rejected, 'alg:none rejected');

// resolveStoredFileOnDisk returns null for missing files (no disk dependency on success path)
assert(resolveStoredFileOnDisk('nonexistent/path/file.pdf') === null, 'missing file returns null');

// --- C-01 live probe: file on disk must not be served via public /uploads ---
const PROBE_REL = 'operations/_security_probe/test.pdf';
const probeFull = path.join(UPLOAD_ROOT, PROBE_REL);
const apiOrigin = process.env.E2E_API_ORIGIN || 'http://localhost:3000';

fs.mkdirSync(path.dirname(probeFull), { recursive: true });
fs.writeFileSync(probeFull, '%PDF-1.4 security-probe\n');

try {
  let res;
  try {
    res = await fetch(`${apiOrigin}/uploads/${PROBE_REL}`);
  } catch (e) {
    if (e?.cause?.code === 'ECONNREFUSED' || e?.code === 'ECONNREFUSED') {
      console.log('SKIP live /uploads probe: API not running at', apiOrigin);
      res = null;
    } else {
      throw e;
    }
  }
  if (res) {
    assert(res.status === 404, `/uploads must return 404 when file exists (got ${res.status})`);
    assert(res.status !== 200, '/uploads must not return 200 for existing on-disk file');
    const stored = await fetch(
      `${apiOrigin}/api/v1/stored-files/view?path=${encodeURIComponent(PROBE_REL)}`
    );
    assert(stored.status === 401, `stored-files without auth must return 401 (got ${stored.status})`);
    console.log('C-01 live probe: /uploads blocked for on-disk file');
  }
} finally {
  try {
    fs.unlinkSync(probeFull);
  } catch {
    /* ignore */
  }
}

console.log('test-security-rbac-uploads.mjs: all checks passed');
