/**
 * Master QC Specs.
 * Base path: /api/v1/qc-specs
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { listAssignableCommodities, listParameters, listTemplates, toParam } from '../lib/qc-spec-store.js';
import {
  assertAssignable,
  insertParameter,
  insertTemplate,
  parseParameterInput,
  parseTemplateInput,
  replaceTemplateContents,
  updateParameter,
} from '../lib/qc-spec-write.js';
import { requirePageEdit, requirePageView } from '../middleware/permissions.js';

const router = express.Router();
const PAGE_KEY = 'master-qc-spec';

router.get('/', ...requirePageView(PAGE_KEY), async (_req, res) => {
  res.json({ templates: await listTemplates(pool) });
});

router.get('/parameters', ...requirePageView(PAGE_KEY), async (_req, res) => {
  res.json({ parameters: await listParameters(pool) });
});

router.get('/commodities', ...requirePageView(PAGE_KEY), async (_req, res) => {
  res.json({ commodities: await listAssignableCommodities(pool) });
});

async function save(req, res, templateId) {
  const input = parseTemplateInput(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertAssignable(client, input.commodityIds, templateId);
    let id = templateId;
    if (id == null) {
      id = await insertTemplate(client, { ...input, actorUserId: req.userId ?? null });
    } else {
      const exists = await client.query(
        `SELECT id FROM qc_spec_templates WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (exists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Template not found' });
      }
      await client.query(`UPDATE qc_spec_templates SET name = $2 WHERE id = $1`, [id, input.name]);
      await replaceTemplateContents(client, id, { ...input, actorUserId: req.userId ?? null });
    }
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: templateId ? 'update' : 'add',
      entityType: 'QcSpecTemplate',
      entityId: String(id),
      entityLabel: input.name,
      summary: `${templateId ? 'Updated' : 'Created'} QC spec ${input.name}`,
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    const templates = await listTemplates(pool);
    res.status(templateId ? 200 : 201).json({ template: templates.find((t) => t.id === Number(id)), templates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.post('/', ...requirePageEdit(PAGE_KEY), (req, res) => save(req, res, null));

router.patch('/:id', ...requirePageEdit(PAGE_KEY), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  return save(req, res, id);
});

router.delete('/:id', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await pool.query(
    `UPDATE qc_spec_templates SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING name`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
  await pool.query(`UPDATE qc_spec_assignments SET deleted_at = NOW() WHERE template_id = $1 AND deleted_at IS NULL`, [id]);
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'delete',
    entityType: 'QcSpecTemplate',
    entityId: String(id),
    entityLabel: r.rows[0].name,
    summary: `Deleted QC spec ${r.rows[0].name}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json({ ok: true });
});

router.post('/parameters', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const input = parseParameterInput(req.body);
  try {
    const row = await insertParameter(pool, input);
    res.status(201).json({ parameter: toParam(row) });
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Parameter code already exists' });
    throw err;
  }
});

router.patch('/parameters/:id', ...requirePageEdit(PAGE_KEY), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const existing = await pool.query(
    `SELECT id, code FROM qc_parameters WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Parameter not found' });
  const input = parseParameterInput({ ...req.body, code: existing.rows[0].code });
  const row = await updateParameter(pool, id, input);
  if (!row) return res.status(404).json({ error: 'Parameter not found' });
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'update',
    entityType: 'QcParameter',
    entityId: String(id),
    entityLabel: row.code,
    summary: `Updated QC parameter ${row.code}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json({ parameter: toParam(row) });
});

export default router;
