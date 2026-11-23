import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertUnitsFromChecks,
  deriveAtgPortAlertStatus,
  recipientRowsToMap,
  resolveRecipientForUnit,
} from './admin-ops-alert-units.js';

test('deriveAtgPortAlertStatus classifies port-level unhealthy', () => {
  assert.equal(deriveAtgPortAlertStatus({ totalEnabled: 0 }), 'unknown');
  assert.equal(deriveAtgPortAlertStatus({ totalEnabled: 3, staleCount: 0 }), 'healthy');
  assert.equal(deriveAtgPortAlertStatus({ totalEnabled: 3, staleCount: 2 }), 'degraded');
  assert.equal(deriveAtgPortAlertStatus({ totalEnabled: 3, staleCount: 3 }), 'unhealthy');
});

test('buildAlertUnitsFromChecks splits atg_sync per port', () => {
  const units = buildAlertUnitsFromChecks([
    {
      id: 'atg_sync',
      title: 'ATG sync',
      status: 'degraded',
      summary: 'agg',
      details: {
        ports: [
          { portId: 1, portName: 'BONTANG', totalEnabled: 2, staleCount: 2, allHealthy: false },
          { portId: 2, portName: 'TJ PURA', totalEnabled: 1, staleCount: 0, allHealthy: true },
        ],
      },
    },
    { id: 'synology_mount', title: 'Synology', status: 'healthy', summary: 'ok' },
  ]);
  assert.equal(units.length, 3);
  assert.equal(units[0].stateKey, 'atg_sync:port:1');
  assert.equal(units[0].status, 'unhealthy');
  assert.equal(units[1].stateKey, 'atg_sync:port:2');
  assert.equal(units[1].status, 'healthy');
  assert.equal(units[2].stateKey, 'synology_mount');
});

test('resolveRecipientForUnit falls back default email', () => {
  const map = recipientRowsToMap([
    { check_id: 'datahub', port_id: null, recipient_email: 'hub@example.com' },
    { check_id: 'atg_sync', port_id: 1, recipient_email: 'bontang@example.com' },
  ]);
  assert.equal(
    resolveRecipientForUnit(
      { checkId: 'atg_sync', portId: 1 },
      map,
      'default@example.com'
    ),
    'bontang@example.com'
  );
  assert.equal(
    resolveRecipientForUnit(
      { checkId: 'atg_sync', portId: 99 },
      map,
      'default@example.com'
    ),
    'default@example.com'
  );
  assert.equal(
    resolveRecipientForUnit({ checkId: 'synology_mount', portId: null }, map, 'default@example.com'),
    'default@example.com'
  );
});