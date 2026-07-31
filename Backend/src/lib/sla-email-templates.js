/**
 * Admin-editable SLA email templates (D-1 and breach).
 */
import { SLA_EVENT_BREACH, SLA_EVENT_D1 } from './etc-sla-eligibility.js';
import { getPublicAppBaseUrl, renderTemplate } from './notifications.js';

export const SLA_EMAIL_TEMPLATE_EVENTS = [SLA_EVENT_D1, SLA_EVENT_BREACH];

const SHARED_PLACEHOLDERS = [
  'vesselName',
  'jettyName',
  'jettyOperationCode',
  'planReference',
  'portName',
  'etcFormatted',
  'actionUrl',
];

export const SLA_EMAIL_PLACEHOLDERS = {
  [SLA_EVENT_D1]: [...SHARED_PLACEHOLDERS],
  [SLA_EVENT_BREACH]: [...SHARED_PLACEHOLDERS, 'overdueFormatted'],
};

export const DEFAULT_SLA_EMAIL_TEMPLATES = {
  [SLA_EVENT_D1]: {
    titleTemplate: 'Jetty Planning: SLA reminder — {{vesselName}} (ETC tomorrow)',
    bodyTemplate:
      'Vessel {{vesselName}} at {{jettyName}} is scheduled to complete tomorrow.\n\n' +
      'Operation: {{jettyOperationCode}}\n' +
      'Plan: {{planReference}}\n' +
      'Port: {{portName}}\n' +
      'ETC: {{etcFormatted}}\n\n' +
      'Open At Berth:\n' +
      '{{actionUrl}}\n',
  },
  [SLA_EVENT_BREACH]: {
    titleTemplate: 'Jetty Planning: SLA breach — {{vesselName}} ({{overdueFormatted}} overdue)',
    bodyTemplate:
      'Vessel {{vesselName}} at {{jettyName}} has exceeded the estimated completion time.\n\n' +
      'Operation: {{jettyOperationCode}}\n' +
      'Plan: {{planReference}}\n' +
      'Port: {{portName}}\n' +
      'ETC: {{etcFormatted}}\n' +
      'Overdue: {{overdueFormatted}}\n\n' +
      'Open At Berth:\n' +
      '{{actionUrl}}\n',
  },
};

/** Sample values for admin preview and test emails. */
export function getSlaEmailTemplateSampleVars() {
  const baseUrl = getPublicAppBaseUrl();
  return {
    vesselName: 'MV Example Star',
    jettyName: 'Jetty A',
    jettyOperationCode: 'JOP-2026-0042',
    planReference: 'SP-2026-0018',
    portName: 'Tanjung Priok',
    etcFormatted: '24 Jul 2026, 14:00',
    overdueFormatted: '+2.5h',
    actionUrl: `${baseUrl}/at-berth`,
  };
}

/**
 * @param {{ titleTemplate: string, bodyTemplate: string }} templates
 */
export function renderSlaEmailTemplateStrings(templates) {
  const vars = getSlaEmailTemplateSampleVars();
  const strVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)]));
  return {
    subject: renderTemplate(templates.titleTemplate, strVars),
    text: renderTemplate(templates.bodyTemplate, strVars),
  };
}

const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 8000;

/**
 * @param {string} eventKey
 * @returns {string}
 */
export function assertEditableSlaEmailEvent(eventKey) {
  const key = String(eventKey || '').trim();
  if (!SLA_EMAIL_TEMPLATE_EVENTS.includes(key)) {
    const err = new Error('Event not found or not editable');
    err.status = 404;
    throw err;
  }
  return key;
}

/**
 * @param {{ titleTemplate?: unknown, bodyTemplate?: unknown }} input
 * @returns {{ titleTemplate: string, bodyTemplate: string }}
 */
export function validateEmailTemplate(input) {
  const titleRaw = input?.titleTemplate != null ? String(input.titleTemplate) : '';
  const bodyRaw = input?.bodyTemplate != null ? String(input.bodyTemplate) : '';

  const titleTemplate = titleRaw.trim();
  const bodyTemplate = bodyRaw.trim();

  if (!titleTemplate) {
    const err = new Error('Subject is required');
    err.status = 400;
    throw err;
  }
  if (/[\r\n]/.test(titleRaw)) {
    const err = new Error('Subject must not contain line breaks');
    err.status = 400;
    throw err;
  }
  if (!bodyTemplate) {
    const err = new Error('Body is required');
    err.status = 400;
    throw err;
  }
  if (titleTemplate.length > MAX_TITLE_LENGTH) {
    const err = new Error(`Subject must be at most ${MAX_TITLE_LENGTH} characters`);
    err.status = 400;
    throw err;
  }
  if (bodyTemplate.length > MAX_BODY_LENGTH) {
    const err = new Error(`Body must be at most ${MAX_BODY_LENGTH} characters`);
    err.status = 400;
    throw err;
  }

  return { titleTemplate, bodyTemplate };
}

/**
 * @param {string} eventKey
 */
export function getDefaultSlaEmailTemplate(eventKey) {
  assertEditableSlaEmailEvent(eventKey);
  return DEFAULT_SLA_EMAIL_TEMPLATES[eventKey];
}

/**
 * @param {string} eventKey
 * @returns {string[]}
 */
export function getSlaEmailPlaceholders(eventKey) {
  assertEditableSlaEmailEvent(eventKey);
  return SLA_EMAIL_PLACEHOLDERS[eventKey] || [];
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventKey
 */
export async function loadSlaEmailTemplate(db, eventKey) {
  const key = assertEditableSlaEmailEvent(eventKey);
  const defaults = getDefaultSlaEmailTemplate(key);
  const r = await db.query(
    `SELECT title_template, body_template, updated_at
     FROM notification_templates
     WHERE event_key = $1 AND channel = 'email' AND COALESCE(locale, '') = ''
     LIMIT 1`,
    [key]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      eventKey: key,
      channel: 'email',
      titleTemplate: defaults.titleTemplate,
      bodyTemplate: defaults.bodyTemplate,
      updatedAt: null,
      placeholders: getSlaEmailPlaceholders(key),
      isDefault: true,
      samplePreviewVars: getSlaEmailTemplateSampleVars(),
    };
  }
  return {
    eventKey: key,
    channel: 'email',
    titleTemplate: row.title_template,
    bodyTemplate: row.body_template,
    updatedAt: row.updated_at,
    placeholders: getSlaEmailPlaceholders(key),
    isDefault: false,
    samplePreviewVars: getSlaEmailTemplateSampleVars(),
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventKey
 * @param {{ titleTemplate: string, bodyTemplate: string }} templates
 */
export async function saveSlaEmailTemplate(db, eventKey, templates) {
  const key = assertEditableSlaEmailEvent(eventKey);
  const { titleTemplate, bodyTemplate } = validateEmailTemplate(templates);

  const existing = await db.query(
    `SELECT id FROM notification_templates
     WHERE event_key = $1 AND channel = 'email' AND COALESCE(locale, '') = ''
     LIMIT 1`,
    [key]
  );

  if (existing.rows[0]) {
    const r = await db.query(
      `UPDATE notification_templates SET
         title_template = $2,
         body_template = $3,
         updated_at = NOW()
       WHERE id = $1
       RETURNING title_template, body_template, updated_at`,
      [existing.rows[0].id, titleTemplate, bodyTemplate]
    );
    const row = r.rows[0];
    return {
      eventKey: key,
      channel: 'email',
      titleTemplate: row.title_template,
      bodyTemplate: row.body_template,
      updatedAt: row.updated_at,
      placeholders: getSlaEmailPlaceholders(key),
      isDefault: false,
      samplePreviewVars: getSlaEmailTemplateSampleVars(),
    };
  }

  const r = await db.query(
    `INSERT INTO notification_templates (event_key, channel, locale, title_template, body_template, kind)
     VALUES ($1, 'email', NULL, $2, $3, 'info')
     RETURNING title_template, body_template, updated_at`,
    [key, titleTemplate, bodyTemplate]
  );
  const row = r.rows[0];
  return {
    eventKey: key,
    channel: 'email',
    titleTemplate: row.title_template,
    bodyTemplate: row.body_template,
    updatedAt: row.updated_at,
    placeholders: getSlaEmailPlaceholders(key),
    isDefault: false,
    samplePreviewVars: getSlaEmailTemplateSampleVars(),
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventKey
 */
export async function resetSlaEmailTemplate(db, eventKey) {
  const key = assertEditableSlaEmailEvent(eventKey);
  const defaults = getDefaultSlaEmailTemplate(key);
  return saveSlaEmailTemplate(db, key, defaults);
}
