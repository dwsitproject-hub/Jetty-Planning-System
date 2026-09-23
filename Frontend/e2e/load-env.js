import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

/** Load Frontend/.env.e2e then .env (existing process.env wins). */
export function loadE2eEnv() {
  for (const name of ['.env.e2e', '.env']) {
    const filePath = path.join(frontendRoot, name);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] != null && process.env[key] !== '') continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

loadE2eEnv();

/** Must match VITE_API_BASE_URL host in Frontend/.env (127.0.0.1, not localhost). */
export const API_ORIGIN = process.env.E2E_API_ORIGIN || 'http://127.0.0.1:3000';
export const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
export const E2E_USER = process.env.E2E_USERNAME || 'admin';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'admin123';
