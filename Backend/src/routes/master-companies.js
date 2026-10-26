/**
 * Master Company — DataHub directory (read-only) and local port checklist.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageEdit, requirePageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import {
  actorUserIdFromReq,
  masterAuditJoinSql,
  masterAuditSelectSql,
  pickMasterAudit,
} from '../lib/master-row-audit.js';
import { companyLabel } from '../lib/company-for-instruction.js';
import { registerDataHubSyncRoutes } from './datahub-sync-routes.js';

const router = express.Router();
router.use(...requirePageView('master-company'));

registerDataHubSyncRoutes(router, { entityType: 'organization', mountPath: '/datahub/sync' });

const COMPANY_SELECT = `SELECT c.id, c.name, c.short_name, c.company_code_sap, c.country, c.is_active,
            c.hub_code, c.datahub_last_apply_source, c.datahub_last_apply_run_id,
            ${masterAuditSelectSql('c')}
     FROM master_companies c
     ${masterAuditJoinSql('c')}`;

function toCompany(row) {
  return {
    id: Number(row.id),
    name: row.name,
    shortName: row.short_name ?? null,
    companyCodeSap: row.company_code_sap ?? null,
    country: row.country ?? null,
    isActive: row.is_active !== false,
    hubCode: row.hub_code ?? null,
    datahubLastApplySource: row.datahub_last_apply_source ?? null,
    datahubLastApplyRunId:
      row.datahub_last_apply_run_id != null ? Number(row.datahub_last_apply_run_id) : null,
    label: companyLabel(row),
    ...pickMasterAudit(row),
  };
}

router.get('/', async (req, res) => {
  const result = await pool.query(
    `${COMPANY_SELECT}
     WHERE c.deleted_at IS NULL
     ORDER BY LOWER(c.name) ASC, c.id ASC`
  );
  res.json(result.rows.map(toCompany));
});

router.get('/port-map', async (req, res) => {
  const portId = parseInt(req.query.portId, 10);
  if (!Number.isFinite(portId)) return res.status(400).json({ error: 'portId is required' });
  const port = await pool.query(`SELECT id FROM ports WHERE id = $1 AND deleted_at IS NULL`, [portId]);
  if (port.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const mapped = await pool.query(
    `SELECT company_id FROM port_companies WHERE port_id = $1 ORDER BY company_id`,
    [portId]
  );
  res.json({
    portId,
    companyIds: mapped.rows.map((r) => Number(r.company_id)),
  });
});

router.put('/port-map', ...requirePageEdit('master-company'), async (req, res) => {
  const portId = parseInt(req.body?.portId, 10);
  if (!Number.isFinite(portId)) return res.status(400).json({ error: 'portId is required' });
  const rawIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : null;
  if (!rawIds) return res.status(400).json({ error: 'companyIds is required' });
  const companyIds = [...new Set(rawIds.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n) && n > 0))];

  const port = await pool.query(`SELECT id, name FROM ports WHERE id = $1 AND deleted_at IS NULL`, [portId]);
  if (port.rows.length === 0) return res.status(404).json({ error: 'Port not found' });

  if (companyIds.length > 0) {
    const found = await pool.query(
      `SELECT id FROM master_companies
       WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND is_active = TRUE`,
      [companyIds]
    );
    if (found.rows.length !== companyIds.length) {
      return res.status(400).json({ error: 'Each company must be an active company in the directory' });
    }
  }

  const actorId = actorUserIdFromReq(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM port_companies WHERE port_id = $1`, [portId]);
    for (const companyId of companyIds) {
      await client.query(
        `INSERT INTO port_companies (port_id, company_id, created_by) VALUES ($1, $2, $3)`,
        [portId, companyId, actorId]
      );
    }
    let backfilled = 0;
    if (companyIds.length === 1) {
      const filled = await client.query(
        `UPDATE shipping_instructions si
         SET company_id = $1, updated_at = NOW()
         FROM shipment_plans sp
         WHERE si.shipment_plan_id = sp.id
           AND sp.port_id = $2
           AND sp.deleted_at IS NULL
           AND si.deleted_at IS NULL
           AND si.company_id IS NULL`,
        [companyIds[0], portId]
      );
      backfilled = filled.rowCount ?? 0;
    }
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: 'master-company',
      action: 'update',
      entityType: 'Port companies',
      entityId: String(portId),
      entityLabel: port.rows[0].name,
      summary: `Set companies used at ${port.rows[0].name}`,
      changes: [{ field: 'Companies', from: null, to: String(companyIds.length) }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json({ portId, companyIds, backfilled });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;
