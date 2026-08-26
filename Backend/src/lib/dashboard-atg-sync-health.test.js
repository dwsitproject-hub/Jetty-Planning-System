import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ATG_STALE_MS,
  classifySourceSyncHealth,
} from './dashboard-atg-sync-health.js';

const NOW = Date.parse('2026-08-20T06:00:00.000Z');

describe('classifySourceSyncHealth', () => {
  it('marks healthy when last fetch is within threshold', () => {
    const row = {
      id: 1,
      base_url: 'http://172.16.246.10',
      label: 'BT_1',
      last_fetched_at: '2026-08-20T05:30:00.000Z',
      last_poll_at: '2026-08-20T05:30:00.000Z',
      last_poll_ok: true,
      last_error: null,
      mapped_tank_count: 12,
    };
    const r = classifySourceSyncHealth(row, { now: NOW, staleThresholdMs: DEFAULT_ATG_STALE_MS });
    assert.equal(r.stale, false);
    assert.equal(r.staleMinutes, 30);
    assert.equal(r.lastSyncedAt, '2026-08-20T05:30:00.000Z');
  });

  it('marks stale when last fetch is older than threshold', () => {
    const row = {
      id: 2,
      base_url: 'http://172.16.246.11',
      label: 'BT_2',
      last_fetched_at: '2026-08-18T04:07:54.000Z',
      last_poll_at: '2026-08-18T04:07:54.000Z',
      last_poll_ok: false,
      last_error: 'Timeout',
      mapped_tank_count: 8,
    };
    const r = classifySourceSyncHealth(row, { now: NOW, staleThresholdMs: DEFAULT_ATG_STALE_MS });
    assert.equal(r.stale, true);
    assert.ok(r.staleMinutes > 60);
    assert.equal(r.lastError, 'Timeout');
  });

  it('marks stale when never synced', () => {
    const row = {
      id: 3,
      base_url: 'http://172.16.246.12',
      label: 'OLEO_1',
      last_fetched_at: null,
      last_poll_at: null,
      last_poll_ok: null,
      last_error: null,
      mapped_tank_count: 0,
    };
    const r = classifySourceSyncHealth(row, { now: NOW });
    assert.equal(r.stale, true);
    assert.equal(r.lastSyncedAt, null);
    assert.equal(r.staleMinutes, null);
  });

  it('prefers last_fetched_at over last_poll_at for sync time', () => {
    const row = {
      id: 4,
      base_url: 'http://172.16.246.10',
      last_fetched_at: '2026-08-20T05:45:00.000Z',
      last_poll_at: '2026-08-20T05:50:00.000Z',
      last_poll_ok: true,
    };
    const r = classifySourceSyncHealth(row, { now: NOW });
    assert.equal(r.lastSyncedAt, '2026-08-20T05:45:00.000Z');
    assert.equal(r.stale, false);
  });

  it('falls back to last_poll_at when no fetch timestamp exists', () => {
    const row = {
      id: 5,
      base_url: 'http://172.16.246.10',
      last_fetched_at: null,
      last_poll_at: '2026-08-20T05:50:00.000Z',
      last_poll_ok: false,
    };
    const r = classifySourceSyncHealth(row, { now: NOW });
    assert.equal(r.lastSyncedAt, '2026-08-20T05:50:00.000Z');
    assert.equal(r.stale, false);
  });

  it('marks stale at exactly threshold boundary plus one ms', () => {
    const row = {
      id: 6,
      base_url: 'http://172.16.246.10',
      last_fetched_at: new Date(NOW - DEFAULT_ATG_STALE_MS - 1).toISOString(),
    };
    const r = classifySourceSyncHealth(row, { now: NOW });
    assert.equal(r.stale, true);
  });
});
