import fs from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';

/** H-6: allowlist by magic bytes (do not trust client Content-Type). */
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export async function validateMulterFileList(files) {
  const list = Array.isArray(files) ? files : [];
  const bad = new Error('File type not allowed');
  bad.statusCode = 400;
  try {
    for (const f of list) {
      if (!f?.path) continue;
      let ft;
      try {
        ft = await fileTypeFromFile(f.path);
      } catch {
        ft = undefined;
      }
      if (!ft?.mime || !ALLOWED.has(ft.mime)) {
        throw bad;
      }
    }
  } catch (e) {
    for (const f of list) {
      if (f?.path) {
        try {
          await fs.unlink(f.path);
        } catch {
          /* ignore */
        }
      }
    }
    throw e;
  }
}
