#!/usr/bin/env node
/**
 * Staging soak helper for ATG sounding sessions.
 *
 * Usage (against staging/local API with valid auth cookie):
 *   node scripts/test-sounding-session-load.mjs --baseUrl=http://127.0.0.1:3000 --operationId=91 --tankIds=1,2 --durationSec=120
 *
 * Without network credentials, runs in-process stabilization simulation only.
 */
import { TankStabilizationTracker, resolveSoundingStabilizationConfig } from '../src/lib/atg-stabilization.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

function simulateStabilizationSoak(durationSec = 120, intervalSec = 2) {
  const config = resolveSoundingStabilizationConfig();
  const tracker = new TankStabilizationTracker(config);
  const started = Date.now();
  let samples = 0;
  let stableHits = 0;
  const base = 10000;
  while (Date.now() - started < durationSec * 1000) {
    const noise = (Math.random() - 0.5) * 4;
    const value = base + noise;
    const status = tracker.addSample({
      value,
      temperatureC: 32 + noise * 0.01,
      sampledAt: new Date().toISOString(),
    });
    samples += 1;
    if (status.state === 'stable') stableHits += 1;
  }
  return { samples, stableHits, config, finalState: tracker.getStatus().state };
}

async function pollSession(baseUrl, sessionId, cookie, durationSec) {
  const started = Date.now();
  let polls = 0;
  let errors = 0;
  while (Date.now() - started < durationSec * 1000) {
    polls += 1;
    try {
      const res = await fetch(`${baseUrl}/api/v1/sounding-sessions/${sessionId}`, {
        headers: cookie ? { Cookie: cookie } : {},
      });
      if (!res.ok) errors += 1;
    } catch {
      errors += 1;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { polls, errors };
}

async function main() {
  const durationSec = Number(args.durationSec || 30);
  console.log('=== Sounding stabilization in-process soak ===');
  const sim = simulateStabilizationSoak(durationSec, 2);
  console.log(JSON.stringify(sim, null, 2));

  const baseUrl = args.baseUrl;
  const operationId = args.operationId;
  const tankIds = args.tankIds ? String(args.tankIds).split(',').map(Number) : [];
  const cookie = args.cookie || process.env.JPS_TEST_COOKIE || '';

  if (!baseUrl || !operationId || !tankIds.length) {
    console.log('\nSkipping live API soak (pass --baseUrl, --operationId, --tankIds, optional --cookie).');
    return;
  }

  console.log('\n=== Live sounding session soak ===');
  const createRes = await fetch(`${baseUrl}/api/v1/operations/${operationId}/sounding-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ tankIds, siMetric: args.siMetric || 'MT' }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    console.error('Create session failed:', createBody);
    process.exit(1);
  }
  console.log('Session created:', createBody.sessionId);
  const pollStats = await pollSession(baseUrl, createBody.sessionId, cookie, durationSec);
  console.log(JSON.stringify(pollStats, null, 2));
  await fetch(`${baseUrl}/api/v1/sounding-sessions/${createBody.sessionId}`, {
    method: 'DELETE',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
