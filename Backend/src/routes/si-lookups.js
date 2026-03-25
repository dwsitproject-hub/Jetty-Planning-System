/**
 * Shipping Instruction dropdown lookups (DB-backed, soft-delete aware).
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  const [
    commodities,
    tradeTerms,
    purposes,
    shippers,
    loadingPorts,
    surveyors,
    agents,
    jetties,
    metrics,
  ] = await Promise.all([
    pool.query(
      `SELECT id, name, sort_order FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, code, sort_order FROM si_trade_terms WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
    pool.query(
      `SELECT id, code, label, sort_order FROM si_purposes WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_shippers WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_loading_ports WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(
      `SELECT id, name, sort_order FROM si_surveyors WHERE deleted_at IS NULL ORDER BY sort_order, name`
    ),
    pool.query(`SELECT id, name, sort_order FROM si_agents WHERE deleted_at IS NULL ORDER BY sort_order, name`),
    pool.query(
      `SELECT j.id, j.name, j.port_id, p.name AS port_name
       FROM jetties j
       JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.deleted_at IS NULL
       ORDER BY p.name, j.order_no, j.name`
    ),
    pool.query(
      `SELECT id, code, label, sort_order FROM public.metric WHERE deleted_at IS NULL ORDER BY sort_order, code`
    ),
  ]);

  res.json({
    commodities: commodities.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    tradeTerms: tradeTerms.rows.map((r) => ({
      id: r.id,
      code: r.code,
      sortOrder: r.sort_order,
    })),
    purposes: purposes.rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sort_order,
    })),
    shippers: shippers.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    loadingPorts: loadingPorts.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    surveyors: surveyors.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    agents: agents.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    })),
    jetties: jetties.rows.map((r) => ({
      id: r.id,
      name: r.name,
      portId: r.port_id,
      portName: r.port_name,
      label: `${r.port_name} — ${r.name}`,
    })),
    metrics: metrics.rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sort_order,
    })),
  });
});

export default router;
