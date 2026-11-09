import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeOverrides } from './admin-ops-manual-override-check.js';

const NOW = Date.parse('2026-11-09T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('admin-ops-manual-override-check', () => {
  it('is healthy when no tank is overridden', () => {
    assert.equal(summarizeOverrides([], NOW).status, 'healthy');
  });

  it('is degraded with a count and counts tanks without an auto-off date', () => {
    const r = summarizeOverrides(
      [{ expiresAt: new Date(NOW + 72 * HOUR).toISOString() }, { expiresAt: null }],
      NOW
    );
    assert.equal(r.status, 'degraded');
    assert.match(r.summary, /2 tank\(s\)/);
    assert.equal(r.noExpiry, 1);
  });

  it('counts overrides that end within 24 hours', () => {
    const r = summarizeOverrides([{ expiresAt: new Date(NOW + 5 * HOUR).toISOString() }], NOW);
    assert.equal(r.expiringSoon, 1);
  });
});
