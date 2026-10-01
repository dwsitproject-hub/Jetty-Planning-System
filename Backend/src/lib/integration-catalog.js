/**
 * Partner integration API — self-describing catalog (v5.1).
 * Mirrors the DataHub `GET /v1/catalog` pattern: lets partners discover which
 * entities they may call and their field contract at runtime, instead of
 * relying only on the static handoff doc.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.
 */
import { WEBHOOK_EVENT_TYPES, MAX_ACTIVE_WEBHOOKS_PER_KEY } from './integration-webhooks.js';
import { listValidSurveyorNames, listValidTradeTermCodes } from './integration-master-data.js';

export const INTEGRATION_CATALOG_VERSION = '5.1';

const VALID_PURPOSES = ['Loading', 'Unloading'];
const VALID_UNITS = ['MT', 'KL'];

async function listCommodityShortNames(db) {
  const r = await db.query(
    `SELECT short_name FROM si_commodities WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY short_name`
  );
  return r.rows.map((row) => row.short_name);
}

function field(key, type, opts = {}) {
  return {
    key,
    type,
    required: opts.required ?? false,
    patchable: opts.patchable ?? false,
    maxLength: opts.maxLength ?? null,
    enumValues: opts.enumValues ?? null,
    description: opts.description ?? null,
    ...(opts.items ? { items: opts.items } : {}),
  };
}

/**
 * Builds the live catalog. Enum values for trade_term, surveyor_name, and
 * cargo_type are read from master data so the catalog never drifts from
 * what validation will actually accept.
 * @param {import('pg').Pool} db
 */
export async function buildIntegrationCatalog(db) {
  const [tradeTermCodes, surveyorNames, cargoTypes] = await Promise.all([
    listValidTradeTermCodes(db),
    listValidSurveyorNames(db),
    listCommodityShortNames(db),
  ]);

  const cargoLineFields = [
    field('cargo_type', 'STRING', {
      required: true,
      maxLength: 100,
      enumValues: cargoTypes,
      description: 'Must match a JPS commodity short name (case-insensitive).',
    }),
    field('description', 'STRING', { maxLength: 500 }),
    field('tonnage', 'NUMBER', { required: true, description: 'Quantity, >= 0.' }),
    field('unit', 'STRING', { required: true, enumValues: VALID_UNITS }),
    field('contract_no', 'STRING', {
      maxLength: 100,
      patchable: true,
      description: 'Your contract reference. Also usable to identify the line on PATCH (with line_order).',
    }),
    field('po_no', 'STRING', { maxLength: 100, patchable: true }),
    field('so_no', 'STRING', { maxLength: 100, patchable: true }),
    field('shipper_name', 'STRING', {
      maxLength: 200,
      patchable: true,
      description: 'Must exist in JPS — create first via POST /shippers.',
    }),
    field('line_order', 'NUMBER', {
      description: 'Zero-based line index (POST order). Identifies the line on PATCH as an alternative to contract_no.',
    }),
  ];

  const entities = [
    {
      slug: 'shipping-instruction',
      name: 'Shipping instruction',
      path: '/shipping-instructions',
      methods: ['POST', 'GET', 'PATCH'],
      description:
        'Submit a Shipping Instruction, poll enriched status (approval, schedule, milestones), and update PO/SO/document links while status is Pending.',
      fields: [
        field('external_reference', 'STRING', {
          required: true,
          maxLength: 100,
          description: 'Your unique document/order ID. Used as the idempotency key.',
        }),
        field('requested_by', 'STRING', { maxLength: 200 }),
        field('port_id', 'NUMBER', { required: true, description: 'Must be a valid JPS port id.' }),
        field('vessel_hub_code', 'STRING', {
          maxLength: 50,
          description: 'DataHub / JPS master vessel code. Sufficient alone for vessel identification.',
        }),
        field('vessel_name', 'STRING', {
          maxLength: 200,
          description: 'Required when vessel_hub_code is omitted; must resolve to exactly one active master vessel.',
        }),
        field('voyage_no', 'STRING', { maxLength: 50 }),
        field('purpose', 'STRING', { required: true, enumValues: VALID_PURPOSES }),
        field('eta', 'DATETIME', { required: true, description: 'ISO 8601 UTC.' }),
        field('etd', 'DATETIME', { description: 'ISO 8601 UTC. Must be after eta when provided.' }),
        field('agent_name', 'STRING', { required: true, maxLength: 200 }),
        field('agent_contact', 'STRING', { maxLength: 200 }),
        field('trade_term', 'STRING', {
          patchable: true,
          enumValues: tradeTermCodes,
          description: 'Trade term code. Also available live via GET /terms.',
        }),
        field('surveyor_name', 'STRING', {
          patchable: true,
          enumValues: surveyorNames,
          description: 'Also available live via GET /surveyors.',
        }),
        field('notes', 'STRING', { maxLength: 2000 }),
        field('shipping_instruction_document_url', 'URL', {
          patchable: true,
          maxLength: 2048,
          description: 'HTTPS link to your hosted SI document. JPS stores the URL only.',
        }),
        field('contract_document_url', 'URL', { patchable: true, maxLength: 2048 }),
        field('bl_document_url', 'URL', { patchable: true, maxLength: 2048 }),
        field('cargo', 'ARRAY', {
          required: true,
          patchable: true,
          description: 'At least one cargo line on POST. On PATCH, each line must include line_order or contract_no to identify the row.',
          items: cargoLineFields,
        }),
      ],
    },
    {
      slug: 'webhook',
      name: 'Webhook endpoint',
      path: '/webhooks',
      methods: ['POST', 'GET', 'PATCH', 'DELETE'],
      description:
        'Register an HTTPS URL to receive signed push events (status.changed, schedule.updated) instead of polling.',
      limits: { maxActivePerApiKey: MAX_ACTIVE_WEBHOOKS_PER_KEY },
      fields: [
        field('url', 'URL', { required: true, description: 'HTTPS endpoint that returns 2xx within 15s.' }),
        field('events', 'ARRAY<STRING>', {
          patchable: true,
          enumValues: ['*', ...WEBHOOK_EVENT_TYPES],
          description: "Defaults to ['*'] (all events) when omitted.",
        }),
        field('secret', 'STRING', {
          patchable: true,
          description: 'Optional on create (auto-generated when omitted). Use rotate_secret: true on PATCH to reissue.',
        }),
        field('active', 'BOOLEAN', { patchable: true }),
      ],
    },
    {
      slug: 'term',
      name: 'Trade term',
      path: '/terms',
      methods: ['GET'],
      description: 'Read-only reference list for the shipping-instruction trade_term field.',
      fields: [field('code', 'STRING', { enumValues: tradeTermCodes })],
    },
    {
      slug: 'agent',
      name: 'Shipping agent',
      path: '/agents',
      methods: ['POST', 'GET', 'PATCH'],
      description: 'Upsert-by-name master data used as agent_name on shipping-instruction.',
      fields: [
        field('name', 'STRING', { required: true, maxLength: 200 }),
        field('long_name', 'STRING'),
      ],
    },
    {
      slug: 'surveyor',
      name: 'Surveyor',
      path: '/surveyors',
      methods: ['GET'],
      description: 'Read-only reference list for the shipping-instruction surveyor_name field.',
      fields: [
        field('name', 'STRING', { enumValues: surveyorNames }),
        field('long_name', 'STRING'),
      ],
    },
    {
      slug: 'shipper',
      name: 'Shipper',
      path: '/shippers',
      methods: ['POST', 'GET', 'PATCH'],
      description: 'Upsert-by-name master data used as cargo[].shipper_name on shipping-instruction.',
      fields: [
        field('name', 'STRING', { required: true, maxLength: 200 }),
        field('long_name', 'STRING'),
      ],
    },
    {
      slug: 'cargo-type',
      name: 'Cargo type',
      path: null,
      methods: [],
      description:
        'Informational only — not a REST resource. Valid values for shipping-instruction cargo[].cargo_type, matched case-insensitively against the JPS commodity short name.',
      fields: [field('short_name', 'STRING', { enumValues: cargoTypes })],
    },
  ];

  return {
    api_version: INTEGRATION_CATALOG_VERSION,
    auth_header: 'x-api-key',
    entities: entities.map((e) => ({ ...e, fieldCount: e.fields.length })),
    count: entities.length,
  };
}

/**
 * @param {import('pg').Pool} db
 * @param {string} slug
 */
export async function getIntegrationCatalogEntity(db, slug) {
  const catalog = await buildIntegrationCatalog(db);
  const clean = String(slug ?? '').trim().toLowerCase();
  return catalog.entities.find((e) => e.slug === clean) ?? null;
}
