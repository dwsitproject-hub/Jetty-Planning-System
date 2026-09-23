import { API_ORIGIN, BASE_URL } from './load-env.js';

async function probe(label, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`${label} returned HTTP ${res.status} (${url})`);
  }
}

/** Fail fast with a clear message when the dev stack is not running. */
export default async function globalSetup() {
  try {
    await probe('API health', `${API_ORIGIN}/health`);
    await probe('Frontend', BASE_URL);
  } catch (err) {
    const hint =
      'Start Backend (docker compose up -d in Backend/) and Frontend (npm run dev in Frontend/), then retry.';
    throw new Error(`E2E prerequisites not ready: ${err.message}\n${hint}`);
  }
}
