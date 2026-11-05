import { SCOPES } from './qc-spec.js';

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function cleanName(raw) {
  const name = String(raw || '').trim();
  if (!name) throw badRequest('Template name is required');
  if (name.length > 80) throw badRequest('Template name must be at most 80 characters');
  return name;
}

function cleanCode(raw) {
  const code = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!code) throw badRequest('Parameter code is required');
  if (code.length > 40) throw badRequest('Parameter code must be at most 40 characters');
  return code;
}

export function parseTemplateInput(body = {}) {
  const name = cleanName(body.name);
  const commodityIds = [...new Set((body.commodityIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const items = (Array.isArray(body.parameters) ? body.parameters : []).map((item, index) => {
    const parameterId = Number(item.parameterId ?? item.id);
    if (!Number.isFinite(parameterId) || parameterId <= 0) throw badRequest('Each parameter needs an id');
    const scope = String(item.scope || 'report');
    if (!SCOPES.includes(scope)) throw badRequest('Invalid parameter scope');
    return { parameterId, scope, sortOrder: Number(item.sortOrder ?? index) };
  });
  if (items.length === 0) throw badRequest('Add at least one parameter');
  return { name, commodityIds, items };
}

function optionalText(raw, max) {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text ? text.slice(0, max) : null;
}

export function parseParameterInput(body = {}) {
  const kind = String(body.kind || 'number');
  if (kind !== 'number' && kind !== 'color_pair') throw badRequest('Invalid parameter kind');
  const maxValue = Number(body.maxValue ?? 100);
  if (!Number.isFinite(maxValue) || maxValue <= 0) throw badRequest('Invalid max value');
  return {
    code: cleanCode(body.code),
    labelEn: String(body.labelEn || body.code).trim().slice(0, 80) || body.code,
    labelId: String(body.labelId || body.labelEn || body.code).trim().slice(0, 80),
    unit: optionalText(body.unit, 20),
    method: optionalText(body.method, 80),
    kind,
    maxValue,
  };
}

export async function assertAssignable(client, commodityIds, templateId) {
  if (commodityIds.length === 0) return;
  const active = await client.query(
    `SELECT id FROM si_commodities
     WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND COALESCE(is_active, TRUE)`,
    [commodityIds]
  );
  if (active.rows.length !== commodityIds.length) throw badRequest('Choose active commodities only');
  const taken = await client.query(
    `SELECT a.commodity_id, t.name
     FROM qc_spec_assignments a
     JOIN qc_spec_templates t ON t.id = a.template_id AND t.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.commodity_id = ANY($1::bigint[])
       AND ($2::bigint IS NULL OR a.template_id <> $2)`,
    [commodityIds, templateId]
  );
  if (taken.rows.length) {
    throw badRequest(`Already assigned to ${taken.rows[0].name}`);
  }
}

export async function replaceTemplateContents(client, templateId, { items, commodityIds, actorUserId }) {
  await client.query(`DELETE FROM qc_spec_template_items WHERE template_id = $1`, [templateId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO qc_spec_template_items (template_id, parameter_id, sort_order, scope)
       VALUES ($1,$2,$3,$4)`,
      [templateId, item.parameterId, item.sortOrder, item.scope]
    );
  }
  await client.query(
    `UPDATE qc_spec_assignments SET deleted_at = NOW()
     WHERE template_id = $1 AND deleted_at IS NULL`,
    [templateId]
  );
  for (const commodityId of commodityIds) {
    await client.query(
      `INSERT INTO qc_spec_assignments (template_id, commodity_id)
       VALUES ($1,$2)`,
      [templateId, commodityId]
    );
  }
  await client.query(
    `UPDATE qc_spec_templates SET updated_at = NOW(), updated_by = COALESCE($2::bigint, updated_by) WHERE id = $1`,
    [templateId, actorUserId]
  );
}

export async function insertTemplate(client, { name, items, commodityIds, actorUserId }) {
  const created = await client.query(
    `INSERT INTO qc_spec_templates (name, created_by, updated_by)
     VALUES ($1,$2,$2) RETURNING id`,
    [name, actorUserId]
  );
  const id = created.rows[0].id;
  await replaceTemplateContents(client, id, { items, commodityIds, actorUserId });
  return id;
}

const PARAMETER_RETURNING =
  'id, code, label_en, label_id, unit, method, kind, max_value, sort_order';

export async function insertParameter(client, input) {
  const r = await client.query(
    `INSERT INTO qc_parameters (code, label_en, label_id, unit, method, kind, max_value, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT MAX(sort_order)+10 FROM qc_parameters WHERE deleted_at IS NULL), 200))
     RETURNING ${PARAMETER_RETURNING}`,
    [input.code, input.labelEn, input.labelId, input.unit, input.method, input.kind, input.maxValue]
  );
  return r.rows[0];
}

export async function updateParameter(client, id, input) {
  const r = await client.query(
    `UPDATE qc_parameters
        SET label_en = $2, label_id = $3, unit = $4, method = $5, kind = $6, max_value = $7, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PARAMETER_RETURNING}`,
    [id, input.labelEn, input.labelId, input.unit, input.method, input.kind, input.maxValue]
  );
  return r.rows[0] || null;
}
