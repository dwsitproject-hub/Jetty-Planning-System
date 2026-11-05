import { fallbackSpec } from './qc-spec.js';

function toParam(row) {
  return {
    id: Number(row.parameter_id ?? row.id),
    code: row.code,
    labelEn: row.label_en,
    labelId: row.label_id,
    unit: row.unit,
    kind: row.kind,
    maxValue: Number(row.max_value),
    scope: row.scope || 'report',
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function toTemplate(row, items, commodities) {
  return {
    id: Number(row.id),
    name: row.name,
    updatedAt: row.updated_at,
    parameters: items,
    commodities,
  };
}

export async function listParameters(db) {
  const r = await db.query(
    `SELECT id, code, label_en, label_id, unit, kind, max_value, sort_order
     FROM qc_parameters WHERE deleted_at IS NULL
     ORDER BY sort_order, code`
  );
  return r.rows.map(toParam);
}

export async function listTemplates(db) {
  const templates = await db.query(
    `SELECT id, name, updated_at FROM qc_spec_templates WHERE deleted_at IS NULL ORDER BY name`
  );
  if (templates.rows.length === 0) return [];
  const ids = templates.rows.map((r) => r.id);
  const items = await db.query(
    `SELECT i.template_id, i.scope, i.sort_order, p.id, p.code, p.label_en, p.label_id, p.unit, p.kind, p.max_value
     FROM qc_spec_template_items i
     JOIN qc_parameters p ON p.id = i.parameter_id AND p.deleted_at IS NULL
     WHERE i.template_id = ANY($1::bigint[])
     ORDER BY i.sort_order, p.sort_order`,
    [ids]
  );
  const assigned = await db.query(
    `SELECT a.template_id, c.id, c.short_name, c.name
     FROM qc_spec_assignments a
     JOIN si_commodities c ON c.id = a.commodity_id AND c.deleted_at IS NULL
     WHERE a.template_id = ANY($1::bigint[]) AND a.deleted_at IS NULL
     ORDER BY COALESCE(c.short_name, c.name)`,
    [ids]
  );
  const itemsBy = new Map();
  for (const row of items.rows) {
    if (!itemsBy.has(row.template_id)) itemsBy.set(row.template_id, []);
    itemsBy.get(row.template_id).push(toParam({ ...row, parameter_id: row.id }));
  }
  const commBy = new Map();
  for (const row of assigned.rows) {
    if (!commBy.has(row.template_id)) commBy.set(row.template_id, []);
    commBy.get(row.template_id).push({
      commodityId: Number(row.id),
      shortName: row.short_name,
      name: row.name,
    });
  }
  return templates.rows.map((row) => toTemplate(row, itemsBy.get(row.id) || [], commBy.get(row.id) || []));
}

/** Active commodities for the picker, with who already owns them. */
export async function listAssignableCommodities(db) {
  const r = await db.query(
    `SELECT c.id, c.short_name, c.name, a.template_id, t.name AS template_name
     FROM si_commodities c
     LEFT JOIN qc_spec_assignments a ON a.commodity_id = c.id AND a.deleted_at IS NULL
     LEFT JOIN qc_spec_templates t ON t.id = a.template_id AND t.deleted_at IS NULL
     WHERE c.deleted_at IS NULL AND COALESCE(c.is_active, TRUE)
     ORDER BY COALESCE(c.short_name, c.name)`
  );
  return r.rows.map((row) => ({
    commodityId: Number(row.id),
    shortName: row.short_name,
    name: row.name,
    assignedTemplateId: row.template_id != null ? Number(row.template_id) : null,
    assignedTemplateName: row.template_name || null,
  }));
}

export async function loadSpecsByCommodityIds(db, commodityIds) {
  const ids = [...new Set((commodityIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map();
  if (ids.length === 0) return map;
  const r = await db.query(
    `SELECT a.commodity_id, t.id AS template_id, t.name,
            i.scope, i.sort_order, p.id AS parameter_id, p.code, p.label_en, p.label_id, p.unit, p.kind, p.max_value
     FROM qc_spec_assignments a
     JOIN qc_spec_templates t ON t.id = a.template_id AND t.deleted_at IS NULL
     JOIN qc_spec_template_items i ON i.template_id = t.id
     JOIN qc_parameters p ON p.id = i.parameter_id AND p.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.commodity_id = ANY($1::bigint[])
     ORDER BY i.sort_order, p.sort_order`,
    [ids]
  );
  for (const row of r.rows) {
    const id = Number(row.commodity_id);
    if (!map.has(id)) map.set(id, { templateId: Number(row.template_id), name: row.name, parameters: [] });
    map.get(id).parameters.push(toParam(row));
  }
  return map;
}

export function specForCommodity(specsById, commodityId) {
  return specsById.get(Number(commodityId)) || fallbackSpec();
}
