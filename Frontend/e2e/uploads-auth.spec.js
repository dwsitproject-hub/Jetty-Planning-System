import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = process.env.E2E_API_ORIGIN || 'http://localhost:3000';
const USER = process.env.E2E_USERNAME || 'admin';
const PASSWORD = process.env.E2E_PASSWORD || 'admin123';
const PROBE_REL = 'operations/_security_probe/test.pdf';
const PROBE_URL = `${BACKEND}/uploads/${PROBE_REL}`;
const UPLOAD_ROOT = path.resolve(__dirname, '../../Backend/uploads');
const PROBE_FULL = path.join(UPLOAD_ROOT, PROBE_REL);

test.beforeAll(async () => {
  fs.mkdirSync(path.dirname(PROBE_FULL), { recursive: true });
  fs.writeFileSync(PROBE_FULL, '%PDF-1.4 security-probe\n');
});

test.afterAll(async () => {
  try {
    fs.unlinkSync(PROBE_FULL);
  } catch {
    /* ignore */
  }
});

/** POST /auth/login; Playwright request context retains session cookies. */
async function apiLogin(request) {
  const loginRes = await request.post(`${BACKEND}/api/v1/auth/login`, {
    data: { username: USER, password: PASSWORD },
  });
  return loginRes.status() === 200;
}

test.describe('upload access (C-01)', () => {
  test('unauthenticated /uploads blocked when file exists on disk', async ({ request }) => {
    const uploads = await request.get(PROBE_URL);
    expect(uploads.status()).toBe(404);
    expect(uploads.status()).not.toBe(200);

    const stored = await request.get(
      `${BACKEND}/api/v1/stored-files/view?path=${encodeURIComponent(PROBE_REL)}`
    );
    expect(stored.status()).toBe(401);
  });

  test('authenticated stored-files requires port scope', async ({ request }) => {
    if (!(await apiLogin(request))) {
      test.skip(true, 'API login failed — is Backend running?');
      return;
    }

    const noPort = await request.get(
      `${BACKEND}/api/v1/stored-files/view?path=operations/seed-clearance/clearance-0003.pdf`
    );
    expect([403, 404]).toContain(noPort.status());
  });

  test('operation document upload not served via public /uploads', async ({ request }) => {
    if (!(await apiLogin(request))) {
      test.skip(true, 'API login failed');
      return;
    }

    const opsRes = await request.get(`${BACKEND}/api/v1/operations`, {
      headers: { 'X-Selected-Port-Id': '1' },
    });
    if (opsRes.status() !== 200) {
      test.skip(true, 'operations list unavailable');
      return;
    }
    const ops = await opsRes.json();
    const opId = Array.isArray(ops) && ops.length > 0 ? ops[0].id : null;
    if (!opId) {
      test.skip(true, 'no operations in DB');
      return;
    }

    const pdfBody = Buffer.from('%PDF-1.4 e2e-upload-probe\n');
    const uploadRes = await request.post(
      `${BACKEND}/api/v1/operation-documents/operations/${opId}/CLEARANCE`,
      {
        headers: { 'X-Selected-Port-Id': '1' },
        multipart: {
          files: {
            name: 'probe.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBody,
          },
        },
      }
    );
    if (![200, 201].includes(uploadRes.status())) {
      test.skip(true, `upload failed: ${uploadRes.status()}`);
      return;
    }

    const uploadJson = await uploadRes.json();
    const docId = uploadJson?.items?.[0]?.id;
    if (!docId) {
      test.skip(true, 'upload response missing document id');
      return;
    }

    const anonCtx = await request.newContext();
    const anonView = await anonCtx.get(`${BACKEND}/api/v1/operation-documents/${docId}/view`);
    expect(anonView.status()).toBe(401);

    const clearanceDir = path.join(UPLOAD_ROOT, 'operations', String(opId), 'clearance');
    if (fs.existsSync(clearanceDir)) {
      const files = fs.readdirSync(clearanceDir);
      if (files.length > 0) {
        const diskPath = `${BACKEND}/uploads/operations/${opId}/clearance/${files[files.length - 1]}`;
        const anonDisk = await anonCtx.get(diskPath);
        expect(anonDisk.status()).toBe(404);
        expect(anonDisk.status()).not.toBe(200);
      }
    }
    await anonCtx.dispose();
  });
});
