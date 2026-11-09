/**
 * System Health Dashboard — tanks currently in manual override (ATG ignored for new quantities).
 */
import { loadActiveOverrides } from './tank-manual-override.js';

const CHECK_ID = 'manual_override';
const CHECK_TITLE = 'Tank manual override';
const SOON_MS = 24 * 60 * 60 * 1000;

function checkResult(status, summary, details = {}) {
  return { id: CHECK_ID, title: CHECK_TITLE, status, summary, details, actionHref: '/tank-farm', actionLabel: 'Open Tank Farm' };
}

/**
 * Pure summary builder (kept separate for tests).
 * @param {Array<{ expiresAt: string|null }>} tanks
 * @param {number} [nowMs]
 */
export function summarizeOverrides(tanks, nowMs = Date.now()) {
  if (!tanks.length) return { status: 'healthy', summary: 'No tank is in manual override', expiringSoon: 0, noExpiry: 0 };
  const expiringSoon = tanks.filter((t) => t.expiresAt && new Date(t.expiresAt).getTime() - nowMs <= SOON_MS).length;
  const noExpiry = tanks.filter((t) => !t.expiresAt).length;
  const parts = [`${tanks.length} tank(s) in manual override: ATG is ignored for new quantities`];
  if (noExpiry) parts.push(`${noExpiry} without auto-off date`);
  return { status: 'degraded', summary: parts.join(' · '), expiringSoon, noExpiry };
}

/**
 * @param {import('pg').Pool} db
 */
export async function checkManualOverride(db) {
  try {
    const tanks = await loadActiveOverrides(db);
    const { status, summary, expiringSoon, noExpiry } = summarizeOverrides(tanks);
    return checkResult(status, summary, { total: tanks.length, expiringSoon, noExpiry, tanks });
  } catch (err) {
    if (err.code === '42703') {
      return checkResult('unknown', 'Manual override columns missing: run migration 148', { error: err.message });
    }
    return checkResult('unknown', err?.message || 'Manual override check failed', { error: err?.message || String(err) });
  }
}
