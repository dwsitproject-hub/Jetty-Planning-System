/**
 * GET /no-flow-report — stops and delays of the selected port for a period.
 * Query: from, to (ISO instants, default last 30 days), purpose (Loading|Unloading), jettyId.
 * Mounted behind FEATURE_NOFLOW_REPORT (404 while off).
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageViewAny } from '../middleware/permissions.js';
import { buildNoFlowReport, loadNoFlowReportInputs } from '../lib/no-flow-report.js';

const router = express.Router();
const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;

function parseInstant(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? undefined : t;
}

router.get('/', ...requirePageViewAny(['reporting', 'management-dashboard']), async (req, res) => {
  const to = parseInstant(req.query.to) ?? new Date();
  const from = parseInstant(req.query.from) ?? new Date(to.getTime() - 30 * DAY_MS);
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ error: 'from and to must be valid dates' });
  }
  if (to <= from) return res.status(400).json({ error: 'to must be after from' });
  if ((to - from) / DAY_MS > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: `Period cannot be longer than ${MAX_RANGE_DAYS} days` });
  }
  const purpose = ['Loading', 'Unloading'].includes(req.query.purpose) ? req.query.purpose : null;
  const jettyId = Number.parseInt(req.query.jettyId, 10);

  const inputs = await loadNoFlowReportInputs(pool, {
    portId: Number(req.selectedPortId),
    from: from.toISOString(),
    to: to.toISOString(),
    purpose,
    jettyId: Number.isFinite(jettyId) && jettyId > 0 ? jettyId : null,
  });
  return res.json(buildNoFlowReport({ ...inputs, range: { from: from.toISOString(), to: to.toISOString() } }));
});

export default router;
