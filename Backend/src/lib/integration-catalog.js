/**
 * Partner integration API — self-describing catalog (v5.7).
 * Mirrors the DataHub `GET /v1/catalog` pattern: lets partners discover which
 * entities they may call and their field contract at runtime, instead of
 * relying only on the static handoff doc.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.
 */
import { WEBHOOK_EVENT_TYPES, MAX_ACTIVE_WEBHOOKS_PER_KEY } from './integration-webhooks.js';
import {
  PARTNER_STATUSES,
  listValidSurveyorNames,
  listValidTradeTermCodes,
} from './integration-master-data.js';
import {
  listActiveCommodityHubCodes,
  listActivePortHubCodes,
  listCommoditiesForCatalog,
  listCompaniesForCatalog,
  listPortsForCatalog,
} from './integration-hub-resolve.js';

export const INTEGRATION_CATALOG_VERSION = '5.7';

const VALID_PURPOSES = ['Loading', 'Unloading'];
const VALID_UNITS = ['MT', 'KL'];
const APPROVAL_STATUSES = ['Submitted', 'Approved', 'Rejected', 'Deleted'];

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

function readOnly(key, type, opts = {}) {
  return field(key, type, { ...opts, systemGenerated: true });
}

/** GET, 201, and webhook fields. Not accepted on POST or PATCH. */
function shippingInstructionResponseFields() {
  return [
    readOnly('id', 'NUMBER', {
      description: 'JPS shipping instruction id. On the 201 response, GET, and webhook data.',
    }),
    readOnly('plan_reference', 'STRING', {
      description: 'JPS plan reference, for example SP-26-10-00011. GET and webhook data.',
    }),
    readOnly('port_id', 'NUMBER', {
      description:
        'Resolved JPS port id on the 201 response, GET, and webhook data. Sending port_id on POST returns 400; use port_hub_code.',
    }),
    readOnly('company_name', 'STRING', {
      description: 'Operating company name resolved from company_hub_code. On the 201 response, GET, and webhook data.',
    }),
    readOnly('received_at', 'DATETIME', {
      description: 'When JPS accepted the submission. On the 201 response.',
    }),
    readOnly('submitted_at', 'DATETIME', {
      description: 'Same instant as received_at. GET and webhook data.',
    }),
    readOnly('last_updated_at', 'DATETIME', {
      description: 'Latest plan, instruction, or operation change. GET and webhook data.',
    }),
    readOnly('etr_minutes', 'NUMBER', {
      description: 'Minutes from now until schedule.etc. Null when status is Sailed Off or etc is empty. GET and webhook data.',
    }),
    readOnly('rejection_reason', 'STRING', {
      description:
        'Set on GET and webhook data only when status is Rejected. Null when status is Deleted; a prior reason remains on approval.rejection_reason.',
    }),
    readOnly('status', 'STRING', {
      enumValues: PARTNER_STATUSES,
      description:
        'Partner lifecycle on the 201 response, GET, and status.changed. After approval the stages are Allocated (jetty assigned), Berthed (schedule.tb set), Start Cargo (schedule.cargo_ops_start_at set), Cargo Done (schedule.cargo_done_at set), and Sailed Off (vessel cast off). A stage can move back if an operator clears the time that set it. Deleted means an operator removed the shipment plan. The same external_reference stays used (POST returns 409). Send the next revision as a new external_reference.',
    }),
    readOnly('approval', 'OBJECT', {
      description:
        'GET and webhook data. approval.status is Submitted while partner status is Pending. It does not follow the later partner stages (Allocated through Sailed Off).',
      items: [
        readOnly('status', 'STRING', {
          enumValues: APPROVAL_STATUSES,
          description: 'Submitted, Approved, Rejected, or Deleted.',
        }),
        readOnly('approved_at', 'DATETIME'),
        readOnly('rejected_at', 'DATETIME'),
        readOnly('rejection_reason', 'STRING', {
          description: 'Operator reason when the plan was rejected. Still present if the plan is later deleted.',
        }),
      ],
    }),
    readOnly('schedule', 'OBJECT', {
      description:
        'GET and webhook data. Timestamps are ISO 8601 UTC. cargo_ops_start_at and cargo_ops_end_at are Hose On and Hose Off. cast_off_at is vessel cast-off, not Hose Off.',
      items: [
        readOnly('eta', 'DATETIME'),
        readOnly('ta', 'DATETIME', { description: 'Actual time of arrival.' }),
        readOnly('etb', 'DATETIME', { description: 'Estimated time of berthing.' }),
        readOnly('tb', 'DATETIME', { description: 'Actual time of berthing.' }),
        readOnly('etc', 'DATETIME', { description: 'Estimated time of completion.' }),
        readOnly('tc', 'DATETIME', { description: 'Time of completion.' }),
        readOnly('cast_off_at', 'DATETIME', { description: 'Vessel cast-off. Not Hose Off.' }),
        readOnly('sailed_at', 'DATETIME'),
        readOnly('cargo_ops_start_at', 'DATETIME', { description: 'Hose On. Cargo Operations window start.' }),
        readOnly('cargo_ops_end_at', 'DATETIME', { description: 'Hose Off. Cargo Operations window end.' }),
        readOnly('cargo_done_at', 'DATETIME', {
          description:
            'Cargo Done. Latest end among cargo operations, final inspection, and final sounding (same as the JPS management dashboard). Null while a cargo operations segment is still open.',
        }),
      ],
    }),
    readOnly('allocation', 'OBJECT', {
      description: 'Null until status is Allocated (also set for Berthed, Start Cargo, Cargo Done, and Sailed Off). GET and webhook data.',
      items: [
        readOnly('jetty_name', 'STRING'),
        readOnly('jetty_code', 'STRING', {
          description: 'Jetty name with a leading "Jetty " prefix removed.',
        }),
        readOnly('planned_berthing_time', 'DATETIME'),
      ],
    }),
  ];
}

/**
 * @param {import('pg').Pool} db
 */
export async function buildIntegrationCatalog(db) {
  const [
    tradeTermCodes,
    surveyorNames,
    portHubCodes,
    commodityHubCodes,
    portReferenceRows,
    commodityReferenceRows,
    companyReferenceRows,
  ] = await Promise.all([
    listValidTradeTermCodes(db),
    listValidSurveyorNames(db),
    listActivePortHubCodes(db),
    listActiveCommodityHubCodes(db),
    listPortsForCatalog(db),
    listCommoditiesForCatalog(db),
    listCompaniesForCatalog(db),
  ]);
  const companyHubCodes = companyReferenceRows.map((row) => row.hub_code).filter(Boolean);

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
    field('sto_no', 'STRING', { maxLength: 100, patchable: true, description: 'Stock transfer order number.' }),
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
        'Submit a Shipping Instruction, poll enriched status (approval, schedule, milestones), and update PO/SO/document links while status is Pending. Port, vessel, and commodity lines require DHM/JPS hub codes (v5.3). Operating company is company_hub_code (v5.6), required when the port has more than one mapped company.',
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
        field('company_hub_code', 'STRING', {
          patchable: true,
          maxLength: 50,
          enumValues: companyHubCodes.length > 0 ? companyHubCodes : null,
          description:
            'Operating company (DataHub organization hub code), not the cargo-line shipper. Required when the port has more than one mapped company. When the port has exactly one, omit to use that company or send its hub code. Omitted when the port has no mapped companies. See GET /catalog/company.',
        }),
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
        ...shippingInstructionResponseFields(),
      ],
      responseFieldsNote:
        'Fields with systemGenerated true are returned on the 201 response, GET, and webhook data. Do not send them on POST or PATCH. POST still rejects port_id and cargo_type.',
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
    {
      slug: 'company',
      name: 'Company',
      path: null,
      methods: [],
      description:
        'Informational only — not a REST resource. Operating company for shipping-instruction company_hub_code. Not the cargo-line shipper. referenceRows lists companies mapped to at least one active port, with the port hub codes they are used on.',
      fields: [
        field('hub_code', 'STRING', { enumValues: companyHubCodes.length > 0 ? companyHubCodes : null }),
        field('short_name', 'STRING'),
        field('name', 'STRING'),
        field('jps_company_id', 'NUMBER', { description: 'JPS master_companies.id — see referenceRows.' }),
        field('port_hub_codes', 'ARRAY<STRING>', {
          description: 'Active port hub codes this company is mapped to.',
        }),
      ],
      referenceRows: companyReferenceRows,
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
