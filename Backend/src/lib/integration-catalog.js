/**
 * Partner integration API — self-describing catalog (v5.3).
 * Mirrors the DataHub `GET /v1/catalog` pattern: lets partners discover which
 * entities they may call and their field contract at runtime, instead of
 * relying only on the static handoff doc.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.
 */
import { WEBHOOK_EVENT_TYPES, MAX_ACTIVE_WEBHOOKS_PER_KEY } from './integration-webhooks.js';
import { listValidSurveyorNames, listValidTradeTermCodes } from './integration-master-data.js';
import {
  listActiveCommodityHubCodes,
  listActivePortHubCodes,
  listCommoditiesForCatalog,
  listPortsForCatalog,
} from './integration-hub-resolve.js';

export const INTEGRATION_CATALOG_VERSION = '5.4';

const VALID_PURPOSES = ['Loading', 'Unloading'];
const VALID_UNITS = ['MT', 'KL'];

function field(key, type, opts = {}) {
  return {
    key,
    type,
    required: opts.required ?? false,
    patchable: opts.patchable ?? false,
    maxLength: opts.maxLength ?? null,
    enumValues: opts.enumValues ?? null,
    description: opts.description ?? null,
    ...(opts.systemGenerated ? { systemGenerated: true } : {}),
    ...(opts.items ? { items: opts.items } : {}),
  };
}

/**
 * @param {import('pg').Pool} db
 */
export async function buildIntegrationCatalog(db) {
  const [tradeTermCodes, surveyorNames, portHubCodes, commodityHubCodes, portReferenceRows, commodityReferenceRows] =
    await Promise.all([
      listValidTradeTermCodes(db),
      listValidSurveyorNames(db),
      listActivePortHubCodes(db),
      listActiveCommodityHubCodes(db),
      listPortsForCatalog(db),
      listCommoditiesForCatalog(db),
    ]);

  const cargoLineFields = [
    field('cargo_hub_code', 'STRING', {
      required: true,
      maxLength: 50,
      enumValues: commodityHubCodes.length > 0 ? commodityHubCodes : null,
      description: 'Required DHM/JPS commodity hub code. See GET /catalog/cargo-type referenceRows.',
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
        'Submit a Shipping Instruction, poll enriched status (approval, schedule, milestones), and update PO/SO/document links while status is Pending. Port, vessel, and commodity lines require DHM/JPS hub codes (v5.3).',
      legacyFieldsRejected: [
        {
          key: 'port_id',
          useInstead: 'port_hub_code',
          issue: 'legacy port_id is not accepted; use port_hub_code',
        },
        {
          key: 'cargo[].cargo_type',
          useInstead: 'cargo[].cargo_hub_code',
          issue: 'legacy cargo_type is not accepted; use cargo_hub_code',
        },
        {
          key: 'cargo_type',
          useInstead: 'cargo_hub_code',
          issue: 'legacy cargo_type is not accepted; use cargo_hub_code (on each cargo line)',
        },
      ],
      fields: [
        field('external_reference', 'STRING', {
          required: true,
          maxLength: 100,
          description: 'Your unique document/order ID. Used as the idempotency key.',
        }),
        field('requested_by', 'STRING', { maxLength: 200 }),
        field('port_hub_code', 'STRING', {
          required: true,
          maxLength: 50,
          enumValues: portHubCodes.length > 0 ? portHubCodes : null,
          description: 'Required DHM/JPS port hub code. See GET /catalog/port referenceRows.',
        }),
        field('vessel_hub_code', 'STRING', {
          required: true,
          maxLength: 50,
          description:
            'Required DataHub / JPS master vessel code. Optional vessel_name may be sent as a cross-check when hub is present.',
        }),
        field('vessel_name', 'STRING', {
          maxLength: 200,
          description: 'Optional cross-check when vessel_hub_code is sent; must match master (case-insensitive).',
        }),
        field('voyage_no', 'STRING', { maxLength: 50 }),
        field('purpose', 'STRING', { required: true, enumValues: VALID_PURPOSES }),
        field('eta', 'DATETIME', { required: true, description: 'ISO 8601 UTC.' }),
        field('etd', 'DATETIME', { description: 'ISO 8601 UTC. Must be after eta when provided.' }),
        field('agent_name', 'STRING', {
          maxLength: 200,
          description: 'Optional. When omitted or null, no agent is linked; partner name remains in plan remark.',
        }),
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
          description: 'HTTP or HTTPS link to your hosted SI document. JPS stores the URL only.',
        }),
        field('contract_document_url', 'URL', {
          patchable: true,
          maxLength: 2048,
          description: 'HTTP or HTTPS link to your hosted contract document.',
        }),
        field('bl_document_url', 'URL', {
          patchable: true,
          maxLength: 2048,
          description: 'HTTP or HTTPS link to your hosted B/L document.',
        }),
        field('cargo', 'ARRAY', {
          required: true,
          patchable: true,
          description:
            'At least one cargo line on POST. Each line requires cargo_hub_code. On PATCH, identify lines with line_order or contract_no.',
          items: cargoLineFields,
        }),
      ],
      responseFieldsNote:
        'GET and webhook payloads echo port_hub_code and port_id (resolved from master). schedule.cargo_ops_start_at (v5.4, partner ATS) is the Cargo Operations operation window start. Cargo is stored by internal commodity id.',
    },
    {
      slug: 'webhook',
      name: 'Webhook endpoint',
      path: '/webhooks',
      methods: ['POST', 'GET', 'PATCH', 'DELETE'],
      description:
        'Register an HTTP or HTTPS URL to receive signed push events (status.changed, schedule.updated) instead of polling.',
      limits: { maxActivePerApiKey: MAX_ACTIVE_WEBHOOKS_PER_KEY },
      fields: [
        field('url', 'URL', {
          required: true,
          description: 'HTTP or HTTPS endpoint that returns 2xx within 15s.',
        }),
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
      slug: 'port',
      name: 'Port',
      path: null,
      methods: [],
      description:
        'Informational only — not a REST resource. Map DHM hub codes for required shipping-instruction port_hub_code.',
      fields: [
        field('hub_code', 'STRING', { enumValues: portHubCodes.length > 0 ? portHubCodes : null }),
        field('jps_port_id', 'NUMBER', { description: 'JPS ports.id — see referenceRows.' }),
        field('name', 'STRING'),
      ],
      referenceRows: portReferenceRows,
    },
    {
      slug: 'cargo-type',
      name: 'Cargo type',
      path: null,
      methods: [],
      description:
        'Informational only — not a REST resource. Use hub_code values on POST cargo[].cargo_hub_code.',
      fields: [
        field('hub_code', 'STRING', { enumValues: commodityHubCodes.length > 0 ? commodityHubCodes : null }),
        field('short_name', 'STRING', { description: 'JPS display short name (informational; not accepted on POST).' }),
        field('jps_commodity_id', 'NUMBER', { description: 'JPS si_commodities.id — see referenceRows.' }),
      ],
      referenceRows: commodityReferenceRows,
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
