/**
 * Partner integration API — catalog discovery (v5.1).
 * `GET /catalog` and `GET /catalog/{entity}` let partners inspect the live
 * field contract instead of hard-coding it from the handoff doc.
 */
import express from 'express';
import { pool } from '../db.js';
import { buildIntegrationCatalog, getIntegrationCatalogEntity } from '../lib/integration-catalog.js';
import { sendIntegrationError, sendIntegrationSuccess } from '../middleware/integration-auth.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  const catalog = await buildIntegrationCatalog(pool);
  return sendIntegrationSuccess(res, 200, catalog);
});

router.get('/:entity', async (req, res) => {
  const entity = await getIntegrationCatalogEntity(pool, req.params.entity);
  if (!entity) {
    return sendIntegrationError(res, 404, 'NOT_FOUND', `Unknown catalog entity '${req.params.entity}'`, {
      entity: req.params.entity,
    });
  }
  return sendIntegrationSuccess(res, 200, entity);
});

export default router;
