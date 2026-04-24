/**
 * QC surveys endpoints — Phase 4.
 *
 * - GET  /operations/:id/qc-surveys
 * - POST /operations/:id/qc-surveys
 * - PUT  /qc-surveys/:id
 */
import express from 'express';
import { pool } from '../db.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';

const router = express.Router();

router.get('/operations/:operationId/qc-surveys', async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operation id' });
  await assertOperationInSelectedPort(operationId, req.selectedPortId);

  const result = await pool.query(
    `SELECT s.id, s.operation_id, s.phase, s.step_key, s.status, s.result, s.remarks, s.occurred_at, s.created_at, s.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', d.id,
                  'fileName', d.file_name,
                  'fileUrl', d.file_url,
                  'uploadedAt', d.uploaded_at
                )
              ) FILTER (WHERE d.id IS NOT NULL),
              '[]'::json
            ) AS documents
     FROM qc_surveys s
     LEFT JOIN qc_documents d ON d.qc_survey_id = s.id AND d.deleted_at IS NULL
     WHERE s.operation_id = $1 AND s.deleted_at IS NULL
     GROUP BY s.id
     ORDER BY s.occurred_at NULLS LAST, s.id ASC`,
    [operationId]
  );

  res.json(result.rows.map(toSurvey));
});

router.post('/operations/:operationId/qc-surveys', async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operation id' });
  await assertOperationInSelectedPort(operationId, req.selectedPortId);

  const { phase, step_key, status, result, remarks, occurred_at, documents } = req.body || {};
  if (!phase || !['Pre-Checking', 'Post-Checking'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be Pre-Checking or Post-Checking' });
  }
  if (!step_key || typeof step_key !== 'string' || !step_key.trim()) {
    return res.status(400).json({ error: 'step_key is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO qc_surveys (operation_id, phase, step_key, status, result, remarks, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, operation_id, phase, step_key, status, result, remarks, occurred_at, created_at, updated_at`,
      [
        operationId,
        phase,
        step_key.trim(),
        status && ['Pending', 'Done'].includes(status) ? status : 'Pending',
        result ?? null,
        remarks ?? null,
        occurred_at ? new Date(occurred_at) : null,
      ]
    );
    const survey = ins.rows[0];

    const docs = Array.isArray(documents) ? documents : [];
    for (const d of docs) {
      if (!d?.fileName || !d?.fileUrl) continue;
      await client.query(
        `INSERT INTO qc_documents (qc_survey_id, file_name, file_url) VALUES ($1, $2, $3)`,
        [survey.id, String(d.fileName), String(d.fileUrl)]
      );
    }

    await client.query('COMMIT');

    const out = await pool.query(
      `SELECT s.id, s.operation_id, s.phase, s.step_key, s.status, s.result, s.remarks, s.occurred_at, s.created_at, s.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', d.id,
                    'fileName', d.file_name,
                    'fileUrl', d.file_url,
                    'uploadedAt', d.uploaded_at
                  )
                ) FILTER (WHERE d.id IS NOT NULL),
                '[]'::json
              ) AS documents
       FROM qc_surveys s
       LEFT JOIN qc_documents d ON d.qc_survey_id = s.id AND d.deleted_at IS NULL
       WHERE s.id = $1
       GROUP BY s.id`,
      [survey.id]
    );

    res.status(201).json(toSurvey(out.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.put('/qc-surveys/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const cur = await pool.query(
    `SELECT id, operation_id FROM qc_surveys WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (cur.rows.length === 0) return res.status(404).json({ error: 'QC survey not found' });
  await assertOperationInSelectedPort(cur.rows[0].operation_id, req.selectedPortId);

  const { status, result, remarks, occurred_at } = req.body || {};

  const upd = await pool.query(
    `UPDATE qc_surveys SET
       status = COALESCE($1, status),
       result = COALESCE($2, result),
       remarks = COALESCE($3, remarks),
       occurred_at = COALESCE($4, occurred_at),
       updated_at = NOW()
     WHERE id = $5 AND deleted_at IS NULL
     RETURNING id`,
    [
      status && ['Pending', 'Done'].includes(status) ? status : null,
      result !== undefined ? result : null,
      remarks !== undefined ? remarks : null,
      occurred_at !== undefined ? (occurred_at ? new Date(occurred_at) : null) : null,
      id,
    ]
  );
  if (upd.rows.length === 0) return res.status(404).json({ error: 'QC survey not found' });

  const out = await pool.query(
    `SELECT s.id, s.operation_id, s.phase, s.step_key, s.status, s.result, s.remarks, s.occurred_at, s.created_at, s.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', d.id,
                  'fileName', d.file_name,
                  'fileUrl', d.file_url,
                  'uploadedAt', d.uploaded_at
                )
              ) FILTER (WHERE d.id IS NOT NULL),
              '[]'::json
            ) AS documents
     FROM qc_surveys s
     LEFT JOIN qc_documents d ON d.qc_survey_id = s.id AND d.deleted_at IS NULL
     WHERE s.id = $1 AND s.deleted_at IS NULL
     GROUP BY s.id`,
    [id]
  );
  res.json(toSurvey(out.rows[0]));
});

router.delete('/qc-surveys/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const cur = await pool.query(
    `SELECT id, operation_id FROM qc_surveys WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (cur.rows.length === 0) return res.status(404).json({ error: 'QC survey not found' });
  await assertOperationInSelectedPort(cur.rows[0].operation_id, req.selectedPortId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query('SELECT id FROM qc_surveys WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (s.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'QC survey not found' });
    }
    await client.query(
      `UPDATE qc_documents SET deleted_at = NOW(), updated_at = NOW() WHERE qc_survey_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE qc_surveys SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

function toSurvey(row) {
  return {
    id: row.id,
    operationId: row.operation_id,
    phase: row.phase,
    stepKey: row.step_key,
    status: row.status,
    result: row.result ?? null,
    remarks: row.remarks ?? null,
    occurredAt: row.occurred_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents: row.documents ?? [],
  };
}

export default router;

