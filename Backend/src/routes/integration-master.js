/**
 * Partner integration API — master data routes (terms, agents, surveyors, shippers).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import {
  listNamedMaster,
  listTradeTerms,
  getNamedMasterById,
  normalizeLongName,
  upsertNamedMaster,
  updateNamedMaster,
} from '../lib/integration-master-data.js';
import { sendIntegrationError, sendIntegrationSuccess } from '../middleware/integration-auth.js';

const router = express.Router();

function parseId(raw) {
  const id = Number.parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

function parseNamedBody(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const longNameRaw = body?.long_name ?? body?.longName;
  const longName =
    longNameRaw === undefined ? undefined : normalizeLongName(longNameRaw);
  return { name, longName };
}

router.get('/terms', async (_req, res) => {
  const data = await listTradeTerms(pool);
  return sendIntegrationSuccess(res, 200, data);
});

router.get('/agents', async (_req, res) => {
  const data = await listNamedMaster(pool, 'si_agents');
  return sendIntegrationSuccess(res, 200, data);
});

router.get('/agents/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const row = await getNamedMasterById(pool, 'si_agents', id);
  if (!row) return sendIntegrationError(res, 404, 'NOT_FOUND', `Agent ${id} not found`);
  return sendIntegrationSuccess(res, 200, row);
});

router.post('/agents', async (req, res) => {
  const { name, longName } = parseNamedBody(req.body);
  if (!name) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'name', issue: 'required' },
    ]);
  }
  const result = await upsertNamedMaster(pool, 'si_agents', { name, longName: longName ?? null });
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', result.error, [
      { field: 'name', issue: result.error },
    ]);
  }

  writeActivityLog({
    pageKey: 'master-si-agent',
    action: result.created ? 'add' : 'update',
    entityType: 'SiAgent',
    entityId: String(result.row.id),
    entityLabel: result.row.name,
    summary: `${result.created ? 'Created' : 'Matched'} agent "${result.row.name}" via integration API (${req.integrationKey.partnerName})`,
    meta: { source: 'integration-api', partner: req.integrationKey.partnerName },
    actorUserId: null,
  }).catch(() => {});

  return sendIntegrationSuccess(res, result.created ? 201 : 200, result.row);
});

router.patch('/agents/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const { name, longName } = parseNamedBody(req.body);
  if (!name && longName === undefined) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'body', issue: 'at least one of name or long_name is required' },
    ]);
  }
  const existing = await getNamedMasterById(pool, 'si_agents', id);
  if (!existing) return sendIntegrationError(res, 404, 'NOT_FOUND', `Agent ${id} not found`);

  const result = await updateNamedMaster(pool, 'si_agents', id, {
    name: name || existing.name,
    longName,
  });
  if (result.error === 'not_found') {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Agent ${id} not found`);
  }
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'name', issue: result.error },
    ]);
  }

  writeActivityLog({
    pageKey: 'master-si-agent',
    action: 'update',
    entityType: 'SiAgent',
    entityId: String(id),
    entityLabel: result.row.name,
    summary: `Updated agent "${result.row.name}" via integration API (${req.integrationKey.partnerName})`,
    meta: { source: 'integration-api', partner: req.integrationKey.partnerName },
    actorUserId: null,
  }).catch(() => {});

  return sendIntegrationSuccess(res, 200, result.row);
});

router.get('/surveyors', async (_req, res) => {
  const data = await listNamedMaster(pool, 'si_surveyors');
  return sendIntegrationSuccess(res, 200, data);
});

router.get('/surveyors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const row = await getNamedMasterById(pool, 'si_surveyors', id);
  if (!row) return sendIntegrationError(res, 404, 'NOT_FOUND', `Surveyor ${id} not found`);
  return sendIntegrationSuccess(res, 200, row);
});

router.get('/shippers', async (_req, res) => {
  const data = await listNamedMaster(pool, 'si_shippers');
  return sendIntegrationSuccess(res, 200, data);
});

router.get('/shippers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const row = await getNamedMasterById(pool, 'si_shippers', id);
  if (!row) return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipper ${id} not found`);
  return sendIntegrationSuccess(res, 200, row);
});

router.post('/shippers', async (req, res) => {
  const { name, longName } = parseNamedBody(req.body);
  if (!name) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'name', issue: 'required' },
    ]);
  }
  const result = await upsertNamedMaster(pool, 'si_shippers', { name, longName: longName ?? null });
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', result.error, [
      { field: 'name', issue: result.error },
    ]);
  }

  writeActivityLog({
    pageKey: 'master-si-shipper',
    action: result.created ? 'add' : 'update',
    entityType: 'SiShipper',
    entityId: String(result.row.id),
    entityLabel: result.row.name,
    summary: `${result.created ? 'Created' : 'Matched'} shipper "${result.row.name}" via integration API (${req.integrationKey.partnerName})`,
    meta: { source: 'integration-api', partner: req.integrationKey.partnerName },
    actorUserId: null,
  }).catch(() => {});

  return sendIntegrationSuccess(res, result.created ? 201 : 200, result.row);
});

router.patch('/shippers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const { name, longName } = parseNamedBody(req.body);
  if (!name && longName === undefined) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'body', issue: 'at least one of name or long_name is required' },
    ]);
  }
  const existing = await getNamedMasterById(pool, 'si_shippers', id);
  if (!existing) return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipper ${id} not found`);

  const result = await updateNamedMaster(pool, 'si_shippers', id, {
    name: name || existing.name,
    longName,
  });
  if (result.error === 'not_found') {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Shipper ${id} not found`);
  }
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'name', issue: result.error },
    ]);
  }

  writeActivityLog({
    pageKey: 'master-si-shipper',
    action: 'update',
    entityType: 'SiShipper',
    entityId: String(id),
    entityLabel: result.row.name,
    summary: `Updated shipper "${result.row.name}" via integration API (${req.integrationKey.partnerName})`,
    meta: { source: 'integration-api', partner: req.integrationKey.partnerName },
    actorUserId: null,
  }).catch(() => {});

  return sendIntegrationSuccess(res, 200, result.row);
});

export default router;
