import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOverallStatus } from './admin-ops-checks.js';

test('deriveOverallStatus picks worst status', () => {
  assert.equal(deriveOverallStatus(['healthy', 'degraded']), 'degraded');
  assert.equal(deriveOverallStatus(['healthy', 'unhealthy']), 'unhealthy');
  assert.equal(deriveOverallStatus(['disabled', 'healthy']), 'healthy');
  assert.equal(deriveOverallStatus(['disabled']), 'disabled');
  assert.equal(deriveOverallStatus(['healthy']), 'healthy');
});
