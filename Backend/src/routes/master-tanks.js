/**
 * Shore tanks master (per port) — CRUD + CSV import.
 * GET list is available to any authenticated, port-scoped user (Cargo Ops dropdown).
 * Mutations require master-tanks edit/delete.
 */
import express from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePortScope } from '../middleware/port-scope.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';

const router = express.Router();
router.use(requireAuth, requirePortScope);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function toTank(row) {
  return {
    id: String(row.id),
    portId: Number(row.port_id),
    portName: row.port_name ?? null,
    code: row.code,
    name: row.name ?? null,
    description: row.description ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    hasAtg: row.has_atg === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function parsePortId(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function assertPortAllowed(req, portId) {
  const allowed = Array.isArray(req.assignedPortIds) ? req.assignedPortIds : [];
  return allowed.includes(Number(portId));
}

/** GET /master/tanks?portId= — list active tanks for a port */
router.get('/', async (req, res) => {
  const portId = parsePortId(req.query.portId ?? req.query.port_id);
  if (portId == null) {
    return res.status(400).json({ error: 'portId is required' });
  }
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }
  const r = await pool.query(
    `SELECT t.id, t.port_id, t.code, t.name, t.description, t.sort_order, t.created_at, t.updated_at,
            p.name AS port_name,
            EXISTS (
              SELECT 1
              FROM tank_gauging_tank_map m
              JOIN tank_gauging_sources s
                ON s.port_id = m.port_id
               AND s.base_url = m.source_base_url
               AND s.enabled = TRUE
              WHERE m.tank_id = t.id
            ) AS has_atg
     FROM master_tanks t
     JOIN ports p ON p.id = t.port_id AND p.deleted_at IS NULL
     WHERE t.port_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.sort_order ASC, LOWER(t.code) ASC, t.id ASC`,
    [portId]
  );
  res.json(r.rows.map(toTank));
});

/** GET /master/tanks/import-template.csv */
router.get('/import-template.csv', ...requirePageView('master-tanks'), async (_req, res) => {
  const csv = 'port_name,code,name,description\nExample Port,5104,,\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="master-tanks-template.csv"');
  res.send(csv);
});

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvText(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? '';
    });
    rows.push({ rowNum: i + 1, ...obj });
  }
  return { headers, rows };
}

/** POST /master/tanks/import-csv — multipart field `file` */
router.post('/import-csv', ...requirePageEdit('master-tanks'), upload.single('file'), async (req, res) => {
  const buf = req.file?.buffer;
  if (!buf?.length) {
    return res.status(400).json({ error: 'No file uploaded (use form field name: file).' });
  }
  const { headers, rows } = parseCsvText(buf.toString('utf8'));
  const required = ['port_name', 'code'];
  for (const h of required) {
    if (!headers.includes(h)) {
      return res.status(400).json({
        error: `CSV must include headers: port_name, code (optional: name, description). Missing: ${h}`,
      });
    }
  }
  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV has no data rows' });
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const row of rows) {
    const portName = String(row.port_name || '').trim();
    const code = String(row.code || '').trim();
    const name = String(row.name || '').trim() || null;
    const description = String(row.description || '').trim() || null;
    if (!portName) {
      errors.push({ row: row.rowNum, message: 'port_name is required' });
      continue;
    }
    if (!code) {
      errors.push({ row: row.rowNum, message: 'code is required' });
      continue;
    }
    const portRes = await pool.query(
      `SELECT id FROM ports WHERE deleted_at IS NULL AND LOWER(name) = LOWER($1) LIMIT 1`,
      [portName]
    );
    if (portRes.rows.length === 0) {
      errors.push({ row: row.rowNum, message: `Port not found: ${portName}` });
      continue;
    }
    const portId = Number(portRes.rows[0].id);
    if (!assertPortAllowed(req, portId)) {
      errors.push({ row: row.rowNum, message: `Port not assigned to you: ${portName}` });
      continue;
    }

    const existing = await pool.query(
      `SELECT id FROM master_tanks
       WHERE port_id = $1 AND deleted_at IS NULL AND LOWER(code) = LOWER($2)
       LIMIT 1`,
      [portId, code]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE master_tanks
         SET code = $1, name = $2, description = $3, updated_at = NOW()
         WHERE id = $4`,
        [code, name, description, existing.rows[0].id]
      );
      updated += 1;
    } else {
      const maxOrd = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM master_tanks WHERE port_id = $1 AND deleted_at IS NULL`,
        [portId]
      );
      const sortOrder = Number(maxOrd.rows[0]?.m || 0) + 1;
      await pool.query(
        `INSERT INTO master_tanks (port_id, code, name, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [portId, code, name, description, sortOrder]
      );
      created += 1;
    }
  }

  writeActivityLog({
    pageKey: 'master-tanks',
    action: 'import',
    entityType: 'MasterTank',
    entityId: null,
    entityLabel: 'CSV import',
    summary: `Imported tanks CSV (created ${created}, updated ${updated}, errors ${errors.length})`,
    meta: { created, updated, errorCount: errors.length },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json({ created, updated, errors });
});

/** POST /master/tanks */
router.post('/', ...requirePageEdit('master-tanks'), async (req, res) => {
  const portId = parsePortId(req.body?.portId ?? req.body?.port_id);
  const code = String(req.body?.code ?? '').trim();
  const name = req.body?.name != null ? String(req.body.name).trim() || null : null;
  const description =
    req.body?.description != null ? String(req.body.description).trim() || null : null;
  let sortOrder =
    req.body?.sortOrder != null || req.body?.sort_order != null
      ? parseInt(String(req.body.sortOrder ?? req.body.sort_order), 10)
      : null;

  if (portId == null) return res.status(400).json({ error: 'portId is required' });
  if (!assertPortAllowed(req, portId)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }
  if (!code) return res.status(400).json({ error: 'code is required' });

  const portOk = await pool.query(
    `SELECT id FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [portId]
  );
  if (portOk.rows.length === 0) return res.status(400).json({ error: 'Port not found' });

  if (sortOrder == null || Number.isNaN(sortOrder)) {
    const maxOrd = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM master_tanks WHERE port_id = $1 AND deleted_at IS NULL`,
      [portId]
    );
    sortOrder = Number(maxOrd.rows[0]?.m || 0) + 1;
  }

  try {
    const ins = await pool.query(
      `INSERT INTO master_tanks (port_id, code, name, description, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, port_id, code, name, description, sort_order, created_at, updated_at`,
      [portId, code, name, description, sortOrder]
    );
    const portNameR = await pool.query(`SELECT name FROM ports WHERE id = $1`, [portId]);
    const row = { ...ins.rows[0], port_name: portNameR.rows[0]?.name ?? null };
    writeActivityLog({
      pageKey: 'master-tanks',
      action: 'add',
      entityType: 'MasterTank',
      entityId: String(row.id),
      entityLabel: row.code,
      summary: `Created tank ${row.code}`,
      changes: [{ field: 'Code', from: null, to: row.code }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(201).json(toTank(row));
  } catch (e) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'A tank with this code already exists for the port' });
    }
    throw e;
  }
});

/** PUT /master/tanks/:id */
router.put('/:id', ...requirePageEdit('master-tanks'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await pool.query(
    `SELECT id, port_id, code FROM master_tanks WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Tank not found' });
  if (!assertPortAllowed(req, existing.rows[0].port_id)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }

  const code = String(req.body?.code ?? '').trim();
  const name = req.body?.name != null ? String(req.body.name).trim() || null : null;
  const description =
    req.body?.description != null ? String(req.body.description).trim() || null : null;
  const sortOrderRaw = req.body?.sortOrder ?? req.body?.sort_order;
  const sortOrder =
    sortOrderRaw != null && sortOrderRaw !== ''
      ? parseInt(String(sortOrderRaw), 10)
      : null;

  if (!code) return res.status(400).json({ error: 'code is required' });

  try {
    const upd = await pool.query(
      `UPDATE master_tanks
       SET code = $1,
           name = $2,
           description = $3,
           sort_order = COALESCE($4, sort_order),
           updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING id, port_id, code, name, description, sort_order, created_at, updated_at`,
      [code, name, description, Number.isFinite(sortOrder) ? sortOrder : null, id]
    );
    const portNameR = await pool.query(`SELECT name FROM ports WHERE id = $1`, [upd.rows[0].port_id]);
    const row = { ...upd.rows[0], port_name: portNameR.rows[0]?.name ?? null };
    writeActivityLog({
      pageKey: 'master-tanks',
      action: 'update',
      entityType: 'MasterTank',
      entityId: String(id),
      entityLabel: row.code,
      summary: `Updated tank ${row.code}`,
      changes: [{ field: 'Code', from: existing.rows[0].code, to: row.code }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.json(toTank(row));
  } catch (e) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'A tank with this code already exists for the port' });
    }
    throw e;
  }
});

/** DELETE /master/tanks/:id — soft delete */
router.delete('/:id', ...requirePageDelete('master-tanks'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await pool.query(
    `SELECT id, port_id, code FROM master_tanks WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Tank not found' });
  if (!assertPortAllowed(req, existing.rows[0].port_id)) {
    return res.status(403).json({ error: 'Selected port is not assigned to this user' });
  }

  await pool.query(
    `UPDATE master_tanks SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  writeActivityLog({
    pageKey: 'master-tanks',
    action: 'delete',
    entityType: 'MasterTank',
    entityId: String(id),
    entityLabel: existing.rows[0].code,
    summary: `Deleted tank ${existing.rows[0].code}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

export default router;
