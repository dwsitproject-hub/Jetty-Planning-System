import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveSegmentAudit,
  groupTankBoardRows,
  mapTankCargoSegment,
} from './tank-cargo-movements.js';

describe('deriveSegmentAudit', () => {
  it('marks open segments as in_progress', () => {
    const r = deriveSegmentAudit({
      atgQtyMode: 'auto',
      qty: null,
      atgMassDelta: null,
      atgMassDetail: null,
      endAt: null,
    });
    assert.equal(r.atgAuditStatus, 'in_progress');
    assert.equal(r.qtySource, null);
  });

  it('marks manual mode as manual_override', () => {
    const r = deriveSegmentAudit({
      atgQtyMode: 'manual',
      qty: 1100,
      atgMassDelta: 906.709,
      atgMassDetail: null,
      endAt: '2026-08-18T10:40:00.000Z',
    });
    assert.equal(r.qtySource, 'manual');
    assert.equal(r.atgAuditStatus, 'manual_override');
  });

  it('marks ATG-verified auto segments as ok', () => {
    const r = deriveSegmentAudit({
      atgQtyMode: 'auto',
      qty: 906.709,
      atgMassDelta: 906.709,
      atgMassDetail: { error: null, incomplete: false },
      endAt: '2026-08-18T10:40:00.000Z',
    });
    assert.equal(r.qtySource, 'atg');
    assert.equal(r.atgAuditStatus, 'ok');
  });

  it('marks no_sample_end as sample_gap', () => {
    const r = deriveSegmentAudit({
      atgQtyMode: 'auto',
      qty: 692.869,
      atgMassDelta: null,
      atgMassDetail: { error: 'no_samples', incomplete: true, tanks: [{ error: 'no_sample_end' }] },
      endAt: '2026-08-18T10:40:00.000Z',
    });
    assert.equal(r.qtySource, 'unverified');
    assert.equal(r.atgAuditStatus, 'sample_gap');
  });

  it('marks qty mismatch when stored qty differs from ATG delta', () => {
    const r = deriveSegmentAudit({
      atgQtyMode: 'auto',
      qty: 1100,
      atgMassDelta: 906.709,
      atgMassDetail: { error: null, incomplete: false },
      endAt: '2026-08-18T10:40:00.000Z',
    });
    assert.equal(r.qtySource, 'unverified');
    assert.equal(r.atgAuditStatus, 'qty_mismatch');
  });
});

describe('mapTankCargoSegment', () => {
  it('maps DB row fields and derived audit status', () => {
    const seg = mapTankCargoSegment({
      load_line_id: 108,
      line_order: 2,
      tank_id: 27,
      qty: 692.869,
      manual_qty: null,
      atg_qty_mode: 'auto',
      started_at: '2026-08-17T20:45:00.000Z',
      ended_at: '2026-08-18T10:40:00.000Z',
      atg_mass_delta: null,
      atg_mass_detail: { error: 'no_samples', incomplete: true },
      atg_mass_computed_at: '2026-08-18T11:00:00.000Z',
      activity_id: 55,
      operation_id: 9,
      vessel_name: 'MV Example',
      purpose: 'Unloading',
      jetty_name: 'Jetty 1',
      reference_number: 'SI-001',
    });
    assert.equal(seg.loadLineId, '108');
    assert.equal(seg.atgAuditStatus, 'sample_gap');
    assert.equal(seg.vesselName, 'MV Example');
    assert.equal(seg.purpose, 'Unloading');
  });
});

describe('groupTankBoardRows', () => {
  it('groups segments per tank and detects current open movement', () => {
    const nowMs = Date.parse('2026-08-20T12:00:00.000Z');
    const tanks = groupTankBoardRows(
      [
        {
          tank_id: 27,
          code: '3203',
          name: 'TK 3203',
          sort_order: 1,
          has_atg: true,
          source_last_poll_ok: false,
          load_line_id: 108,
          line_order: 2,
          qty: 692.869,
          manual_qty: null,
          atg_qty_mode: 'auto',
          started_at: '2026-08-17T20:45:00.000Z',
          ended_at: null,
          atg_mass_delta: null,
          atg_mass_detail: { error: 'no_samples' },
          activity_id: 55,
          operation_id: 9,
          vessel_name: 'MV Example',
          purpose: 'Unloading',
          jetty_name: 'Jetty 1',
          reference_number: 'SI-001',
        },
        {
          tank_id: 42,
          code: '3502',
          name: 'TK 3502',
          sort_order: 2,
          has_atg: true,
          source_last_poll_ok: true,
          load_line_id: 99,
          line_order: 1,
          qty: 1100,
          manual_qty: null,
          atg_qty_mode: 'manual',
          started_at: '2026-08-10T08:00:00.000Z',
          ended_at: '2026-08-10T18:00:00.000Z',
          atg_mass_delta: null,
          atg_mass_detail: null,
          activity_id: 50,
          operation_id: 9,
          vessel_name: 'MV Example',
          purpose: 'Unloading',
          jetty_name: 'Jetty 1',
          reference_number: 'SI-001',
        },
      ],
      { nowMs }
    );

    assert.equal(tanks.length, 2);
    const tk3203 = tanks.find((t) => t.code === '3203');
    assert.ok(tk3203);
    assert.equal(tk3203.segments.length, 1);
    assert.equal(tk3203.currentMovement?.vesselName, 'MV Example');
    assert.equal(tk3203.sourceLastPollOk, false);

    const tk3502 = tanks.find((t) => t.code === '3502');
    assert.equal(tk3502.segments[0].atgAuditStatus, 'manual_override');
    assert.equal(tk3502.currentMovement, null);
  });

  it('maps latest mass, product, and poller metadata', () => {
    const tanks = groupTankBoardRows([
      {
        tank_id: 27,
        code: '3203',
        name: 'TK 3203',
        sort_order: 1,
        has_atg: true,
        source_last_poll_ok: false,
        source_last_poll_at: '2026-08-20T02:00:00.000Z',
        source_last_error: 'HTTP 502',
        source_base_url: 'http://172.16.246.10',
        product_name: 'Condensate',
        current_mass: 542.89,
        current_volume: 650.0,
        recorded_at: '2026-08-20T03:00:00.000Z',
      },
    ]);

    assert.equal(tanks.length, 1);
    assert.equal(tanks[0].productName, 'Condensate');
    assert.equal(tanks[0].currentMass, 542.89);
    assert.equal(tanks[0].sourceLastPollOk, false);
    assert.equal(tanks[0].sourceLastError, 'HTTP 502');
    assert.equal(tanks[0].sourceBaseUrl, 'http://172.16.246.10');
  });
});
