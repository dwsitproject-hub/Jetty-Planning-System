/**
 * Jetty Planning System - Backend API
 * Entry point; Phase 3 — Shipping instructions & operations + PostgreSQL + API prefix + CORS.
 */
import 'dotenv/config';
import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import http from 'http';
import { verifyConnection } from './db.js';
import { UPLOAD_ROOT } from './paths.js';
import authRoutes from './routes/auth.js';
import hubSsoRoutes from './routes/hub-sso.js';
import oidcSsoRoutes from './routes/oidc-sso.js';
import userRoutes from './routes/users.js';
import rbacRoutes from './routes/rbac.js';
import portsRoutes from './routes/ports.js';
import jettiesRoutes from './routes/jetties.js';
import slaConfigRoutes from './routes/sla-config.js';
import standardRatesRoutes from './routes/standard-rates.js';
import shippingInstructionsRoutes from './routes/shipping-instructions.js';
import siDocumentExtractRoutes from './routes/si-document-extract.js';
import siDocumentsRoutes from './routes/si-documents.js';
import siLookupsRoutes from './routes/si-lookups.js';
import operationsRoutes from './routes/operations.js';
import qcSurveysRoutes from './routes/qc-surveys.js';
import quantityChecksRoutes from './routes/quantity-checks.js';
import activityLogsRoutes from './routes/activity-logs.js';
import allocationRoutes from './routes/allocation.js';
import dashboardV2WeeklyRoutes from './routes/dashboard-v2-weekly.js';
import shipmentPlansRoutes from './routes/shipment-plans.js';
import operationDocumentsRoutes from './routes/operation-documents.js';
import operationSubProcessesRoutes from './routes/operation-sub-processes.js';
import operationOperationalActivitiesRoutes from './routes/operation-operational-activities.js';
import masterCargoHandlingMethodsRoutes from './routes/master-cargo-handling-methods.js';
import jettyLayoutRoutes from './routes/jetty-layout.js';
import adminSsoLinkingRoutes from './routes/admin-sso-linking.js';
import notificationsRoutes from './routes/notifications.js';
import storedFilesRoutes from './routes/stored-files.js';
import integrationsRoutes from './routes/integrations.js';
import { requireAuth } from './middleware/auth.js';
import { requirePortScope } from './middleware/port-scope.js';
import { csrfProtection } from './middleware/csrf.js';
import { startNotificationEmailWorker } from './lib/notification-email-worker.js';

const app = express();
const PORT = process.env.PORT || 3000;
const corsOrigin =
  process.env.CORS_ORIGIN ||
  // Vite + nginx app: allow both hostname spellings (browser fetch to 127.0.0.1:3000 is cross-origin from localhost:5173).
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001';

if (process.env.TRUST_PROXY) {
  const n = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(n) ? n : process.env.TRUST_PROXY);
} else {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
/** Downstream Hub bridge: POST /auth/hub (urlencoded body); separate from /api/v1/auth/login */
app.use('/auth', hubSsoRoutes);
app.use('/auth', oidcSsoRoutes);
/** C-01: public static uploads retired; use /api/v1/stored-files or document routes */
app.use('/uploads', (_req, res) => {
  res.status(404).json({ error: 'Uploads are not served publicly; use authenticated API endpoints' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const apiV1 = express.Router();

apiV1.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

apiV1.get('/ping', (req, res) => {
  res.json({ ok: true });
});

apiV1.use('/auth', authRoutes);
/** Partner machine-to-machine API (x-api-key auth); mounted before CSRF since partners have no cookie session. */
apiV1.use('/integrations', integrationsRoutes);
apiV1.use(csrfProtection);
apiV1.use('/users', userRoutes);
apiV1.use('/admin', adminSsoLinkingRoutes);
apiV1.use('/rbac', rbacRoutes);
apiV1.use('/ports', portsRoutes);
apiV1.use('/jetties', jettiesRoutes);
apiV1.use('/sla-config', slaConfigRoutes);
apiV1.use('/standard-rates', standardRatesRoutes);
apiV1.use('/si-document-extract', requireAuth, requirePortScope, siDocumentExtractRoutes);
apiV1.use('/si-documents', requireAuth, requirePortScope, siDocumentsRoutes);
apiV1.use('/shipping-instructions', requireAuth, requirePortScope, shippingInstructionsRoutes);
apiV1.use('/si-lookups', requireAuth, siLookupsRoutes);
apiV1.use('/operations', requireAuth, requirePortScope, operationsRoutes);
apiV1.use('/allocation', requireAuth, requirePortScope, allocationRoutes);
apiV1.use('/dashboard-v2', requireAuth, requirePortScope, dashboardV2WeeklyRoutes);
apiV1.use('/shipment-plans', requireAuth, requirePortScope, shipmentPlansRoutes);
apiV1.use('/operation-documents', requireAuth, requirePortScope, operationDocumentsRoutes);
apiV1.use('/stored-files', requireAuth, requirePortScope, storedFilesRoutes);
apiV1.use('/jetty-layout', requireAuth, requirePortScope, jettyLayoutRoutes);
apiV1.use('/activity-logs', requireAuth, requirePortScope, activityLogsRoutes);
apiV1.use('/notifications', requireAuth, notificationsRoutes);
apiV1.use('/', requireAuth, requirePortScope, qcSurveysRoutes);
apiV1.use('/', requireAuth, requirePortScope, quantityChecksRoutes);
apiV1.use('/', requireAuth, requirePortScope, operationSubProcessesRoutes);
apiV1.use('/', requireAuth, requirePortScope, operationOperationalActivitiesRoutes);
apiV1.use('/', requireAuth, masterCargoHandlingMethodsRoutes);

app.use('/api/v1', apiV1);

// Central error handler (prevents crashes on async errors)
app.use((err, req, res, next) => {
  const status = err?.statusCode ?? err?.status;
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return res.status(status).json({ error: err.message || 'Error' });
  }

  const code = err?.code;

  // Postgres common errors
  if (code === '23505') {
    return res.status(409).json({ error: 'Duplicate key' });
  }
  if (code === '22P02') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  if (code === '23514') {
    const constraint = err?.constraint || null;
    if (constraint === 'operation_sub_processes_time_range_check') {
      return res.status(400).json({ error: 'Invalid time range: end must be on or after start' });
    }
    // Other CHECK constraints (e.g., status/phase) also map to 23514; return a clearer message for debugging.
    return res.status(400).json({ error: constraint ? `Invalid input (${constraint})` : 'Invalid input' });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await verifyConnection();
    console.log('Database connection OK');
  } catch (err) {
    console.error('FATAL: Database connection failed:', err.message);
    process.exit(1);
  }
  try {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    fs.accessSync(UPLOAD_ROOT, fs.constants.W_OK);
    console.log(`Upload directory: ${UPLOAD_ROOT} (writable)`);
  } catch (err) {
    const msg = `Upload directory not writable (${UPLOAD_ROOT}): ${err.message}`;
    if (process.env.NODE_ENV === 'production') {
      console.error(`FATAL: ${msg}`);
      process.exit(1);
    }
    console.warn(`WARNING: ${msg}`);
  }
  let maxHeaderSize = Number(process.env.HTTP_MAX_HEADER_SIZE);
  if (!Number.isFinite(maxHeaderSize) || maxHeaderSize < 8192) maxHeaderSize = 131072;
  const server = http.createServer({ maxHeaderSize }, app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JPS API listening on http://0.0.0.0:${PORT} (map host port in Docker)`);
  });
  startNotificationEmailWorker();
}

start();
