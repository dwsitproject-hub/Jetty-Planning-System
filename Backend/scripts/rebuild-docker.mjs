#!/usr/bin/env node
/**
 * Rebuild the jps-api Docker image and recreate the container.
 * Expects repo layout: this file under Backend/scripts/, compose file at repo root.
 *
 * From repo root:
 *   node Backend/scripts/rebuild-docker.mjs
 *   npm run rebuild:backend
 * From Backend:
 *   npm run rebuild:docker
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

function run(cmd, cmdArgs, cwd = repoRoot) {
  const isWin = process.platform === 'win32';
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

console.log('Rebuild jps-api (Docker)…');
console.log(`Repo root: ${repoRoot}\n`);

run('docker', [
  'compose',
  '--env-file',
  'Backend/.env',
  '-f',
  'docker-compose.backend.yml',
  'up',
  '-d',
  '--build',
  'jps-api',
]);

console.log('\nDone. Check: http://127.0.0.1:3000/health\n');
