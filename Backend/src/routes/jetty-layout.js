/**
 * Jetty Layout persistence (DB-backed) per active port scope.
 *
 * Base path: /api/v1/jetty-layout
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();

function normalizeLayoutInput(body) {
  const cols = body?.columns;
  if (!Array.isArray(cols)) return { ok: false, error: 'columns must be an array' };
  if (cols.length < 1 || cols.length > 12) return { ok: false, error: 'columns length must be 1..12' };
  const normCols = cols.map((c) => {
    const top = c?.top?.type === 'jetty' ? { type: 'jetty', jettyId: String(c.top.jettyId || '') } : { type: 'unused' };
    const midType = c?.middle?.type === 'block' ? 'block' : 'unused';
    const middle = { type: midType };
    const bottom = c?.bottom?.type === 'jetty' ? { type: 'jetty', jettyId: String(c.bottom.jettyId || '') } : { type: 'unused' };
    return { top, middle, bottom };
  });
  return { ok: true, layout: { columns: normCols } };
}

function summarizeLayout(layout) {
  const cols = Array.isArray(layout?.columns) ? layout.columns : [];
  let jettyCells = 0;
  for (const c of cols) {
    if (c?.top?.type === 'jetty') jettyCells += 1;
    if (c?.bottom?.type === 'jetty') jettyCells += 1;
  }
  const blocks = cols.filter((c) => c?.middle?.type === 'block').length;
  return `${cols.length} column(s), ${jettyCells} jetty cell(s), ${blocks} block(s)`;
}

async function jettyIdToNameMap(portId) {
  const r = await pool.query(
    `SELECT id, name
     FROM jetties
     WHERE deleted_at IS NULL AND port_id = $1
     ORDER BY order_no ASC, name ASC`,
    [portId]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    const short = String(row.name || '').replace(/^Jetty\s+/i, '').trim();
    m.set(String(row.id), short || String(row.name || row.id));
  }
  return m;
}

function labelJetty(jettyId, idToName) {
  if (!jettyId) return null;
  const key = String(jettyId);
  return idToName?.get(key) ?? key;
}

function diffLayout(before, after, idToName) {
  const bCols = Array.isArray(before?.columns) ? before.columns : [];
  const aCols = Array.isArray(after?.columns) ? after.columns : [];
  const changes = [];

  if (bCols.length !== aCols.length) {
    changes.push({ field: 'Columns', from: bCols.length, to: aCols.length });
  }

  const n = Math.max(bCols.length, aCols.length);
  const cellLabel = (idx, pos) => `Col ${idx + 1} ${pos}`;
  const cellJetty = (cell) => (cell?.type === 'jetty' ? (cell.jettyId || null) : null);
  for (let i = 0; i < n; i += 1) {
    const b = bCols[i] || {};
    const a = aCols[i] || {};
    const bt = cellJetty(b.top);
    const at = cellJetty(a.top);
    if (bt !== at) changes.push({ field: cellLabel(i, 'Top'), from: labelJetty(bt, idToName), to: labelJetty(at, idToName) });

    const bb = cellJetty(b.bottom);
    const ab = cellJetty(a.bottom);
    if (bb !== ab) changes.push({ field: cellLabel(i, 'Bottom'), from: labelJetty(bb, idToName), to: labelJetty(ab, idToName) });

    const bm = b?.middle?.type || 'unused';
    const am = a?.middle?.type || 'unused';
    if (bm !== am) changes.push({ field: cellLabel(i, 'Middle'), from: bm, to: am });
  }

  return changes;
}

router.get('/', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const r = await pool.query(
    `SELECT layout_json
     FROM jetty_layouts
     WHERE port_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [selectedPortId]
  );
  const layout = r.rows[0]?.layout_json ?? null;
  res.json(layout ? { portId: selectedPortId, ...layout } : { portId: selectedPortId, columns: [] });
});

router.put('/', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const parsed = normalizeLayoutInput(req.body || {});
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const after = parsed.layout;
  const beforeRes = await pool.query(
    `SELECT id, layout_json
     FROM jetty_layouts
     WHERE port_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [selectedPortId]
  );
  const beforeRow = beforeRes.rows[0] ?? null;
  const before = beforeRow?.layout_json ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Unique constraint is partial (deleted_at IS NULL), so use an explicit update-or-insert flow.
    let saved = null;
    if (beforeRow?.id) {
      const up = await client.query(
        `UPDATE jetty_layouts
         SET layout_json = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL
         RETURNING id, layout_json, created_at, updated_at`,
        [JSON.stringify(after), beforeRow.id]
      );
      saved = up.rows[0] ?? null;
    }
    if (!saved) {
      const ins = await client.query(
        `INSERT INTO jetty_layouts (port_id, layout_json)
         VALUES ($1, $2)
         RETURNING id, layout_json, created_at, updated_at`,
        [selectedPortId, JSON.stringify(after)]
      );
      saved = ins.rows[0];
    }

    const idToName = await jettyIdToNameMap(selectedPortId);
    const changes = diffLayout(before, after, idToName);
    await writeActivityLog({
      pageKey: 'master-jetty-layout',
      action: before ? 'update' : 'add',
      entityType: 'Jetty Layout',
      entityId: String(saved.id),
      entityLabel: `Port ${selectedPortId}`,
      summary: before ? 'Updated jetty layout' : 'Created jetty layout',
      changes: changes.length ? changes : [{ field: 'Layout', from: summarizeLayout(before), to: summarizeLayout(after) }],
      meta: { portId: selectedPortId },
      actorUserId: req.userId ?? null,
    });

    await client.query('COMMIT');
    res.json({ portId: selectedPortId, ...saved.layout_json });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;

