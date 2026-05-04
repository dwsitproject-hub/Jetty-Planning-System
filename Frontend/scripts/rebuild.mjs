#!/usr/bin/env node
/**
 * npm install + vite build for the Frontend app (run from repo root or Frontend/).
 *
 * From repo root:
 *   node Frontend/scripts/rebuild.mjs
 *   npm run rebuild:frontend
 * From Frontend:
 *   npm run rebuild
 *
 * Flags:
 *   --skip-build   Only npm install (no production bundle).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');

function run(cmd, cmdArgs, cwd) {
  const isWin = process.platform === 'win32';
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

console.log('Frontend: npm install…\n');
run('npm', ['install'], frontendRoot);

if (!skipBuild) {
  console.log('\nFrontend: vite build…\n');
  run('npm', ['run', 'build'], frontendRoot);
  console.log('\nDone. Output: Frontend/dist/\n');
} else {
  console.log('\nSkipped vite build (--skip-build). Run dev: npm run dev (from repo root)\n');
}
