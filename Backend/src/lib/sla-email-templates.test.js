/**
 * Unit tests for SLA email template validation.
 * Run: node --test src/lib/sla-email-templates.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SLA_EVENT_D1, SLA_EVENT_BREACH } from './etc-sla-eligibility.js';
import {
  assertEditableSlaEmailEvent,
  validateEmailTemplate,
  getDefaultSlaEmailTemplate,
  getSlaEmailPlaceholders,
  renderSlaEmailTemplateStrings,
} from './sla-email-templates.js';

describe('sla-email-templates', () => {
  it('allows only SLA admin email events', () => {
    assert.equal(assertEditableSlaEmailEvent(SLA_EVENT_D1), SLA_EVENT_D1);
    assert.equal(assertEditableSlaEmailEvent(SLA_EVENT_BREACH), SLA_EVENT_BREACH);
    assert.throws(() => assertEditableSlaEmailEvent('shipment_plan.submitted'), (err) => err.status === 404);
  });

  it('returns defaults and placeholders for SLA events', () => {
    const d1 = getDefaultSlaEmailTemplate(SLA_EVENT_D1);
    assert.ok(d1.titleTemplate.includes('{{vesselName}}'));
    assert.ok(d1.bodyTemplate.includes('{{actionUrl}}'));
    const breachPh = getSlaEmailPlaceholders(SLA_EVENT_BREACH);
    assert.ok(breachPh.includes('overdueFormatted'));
    const d1Ph = getSlaEmailPlaceholders(SLA_EVENT_D1);
    assert.ok(!d1Ph.includes('overdueFormatted'));
  });

  it('validates non-empty subject and body', () => {
    assert.throws(
      () => validateEmailTemplate({ titleTemplate: '  ', bodyTemplate: 'body' }),
      (err) => err.status === 400
    );
    assert.throws(
      () => validateEmailTemplate({ titleTemplate: 'Subject', bodyTemplate: '  ' }),
      (err) => err.status === 400
    );
  });

  it('rejects newlines in subject', () => {
    assert.throws(
      () => validateEmailTemplate({ titleTemplate: 'Line1\nLine2', bodyTemplate: 'body' }),
      (err) => err.status === 400 && /line break/i.test(err.message)
    );
  });

  it('accepts valid templates', () => {
    const result = validateEmailTemplate({
      titleTemplate: ' Hello {{vesselName}} ',
      bodyTemplate: 'Body for {{jettyName}}',
    });
    assert.equal(result.titleTemplate, 'Hello {{vesselName}}');
    assert.equal(result.bodyTemplate, 'Body for {{jettyName}}');
  });

  it('renders sample template strings', () => {
    const d1 = getDefaultSlaEmailTemplate(SLA_EVENT_D1);
    const rendered = renderSlaEmailTemplateStrings(d1);
    assert.ok(rendered.subject.includes('MV Example Star'));
    assert.ok(rendered.text.includes('JOP-2026-0042'));
    assert.ok(rendered.text.includes('/at-berth'));
  });
});
