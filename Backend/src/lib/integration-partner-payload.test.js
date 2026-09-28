import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPartnerInstructionPayload, buildPartnerSchedule } from './integration-partner-payload.js';

describe('integration-partner-payload', () => {
  it('buildPartnerSchedule coalesces plan and operation timestamps', () => {
    const schedule = buildPartnerSchedule({
      eta: '2026-10-01T08:00:00.000Z',
      sp_ta: null,
      op_ta: '2026-10-01T09:00:00.000Z',
      sp_tb: null,
      op_docking_start_time: '2026-10-02T10:00:00.000Z',
      sp_etc: '2026-10-05T18:00:00.000Z',
    });
    assert.equal(schedule.ta, '2026-10-01T09:00:00.000Z');
    assert.equal(schedule.tb, '2026-10-02T10:00:00.000Z');
    assert.equal(schedule.etc, '2026-10-05T18:00:00.000Z');
  });

  it('buildPartnerInstructionPayload includes approval and plan_reference', () => {
    const payload = buildPartnerInstructionPayload({
      si_id: 10,
      external_reference: 'REF-1',
      received_at: '2026-09-25T01:00:00.000Z',
      last_updated_at: '2026-09-25T02:00:00.000Z',
      approval_status: 'Approved',
      approved_at: '2026-09-25T02:00:00.000Z',
      plan_reference: 'SP-26-09-00010',
      vessel_name: 'MV TEST',
      port_id: 1,
      payload: { vessel_hub_code: 'VSL-0001' },
      op_status: 'DOCKED',
      jetty_name: 'Jetty 1A',
      jetty_short_name: '1A',
      op_docking_start_time: '2026-10-02T10:00:00.000Z',
    });
    assert.equal(payload.status, 'Allocated');
    assert.equal(payload.plan_reference, 'SP-26-09-00010');
    assert.equal(payload.approval.status, 'Approved');
    assert.equal(payload.allocation?.jetty_code, '1A');
    assert.ok(payload.schedule);
  });

  it('includes partner document URLs', () => {
    const payload = buildPartnerInstructionPayload({
      si_id: 1,
      external_reference: 'R',
      received_at: '2026-09-25T01:00:00.000Z',
      last_updated_at: '2026-09-25T02:00:00.000Z',
      approval_status: 'Submitted',
      vessel_name: 'V',
      port_id: 1,
      payload: {},
      partner_si_document_url: 'https://ex/si',
      partner_contract_document_url: 'https://ex/c',
      partner_bl_document_url: 'https://ex/bl',
    });
    assert.equal(payload.shipping_instruction_document_url, 'https://ex/si');
    assert.equal(payload.contract_document_url, 'https://ex/c');
    assert.equal(payload.bl_document_url, 'https://ex/bl');
  });
});
