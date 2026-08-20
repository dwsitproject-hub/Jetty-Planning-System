/**
 * Segment inspect payload for Audit Inspector drawer (read-only).
 */
import { mapTankCargoSegment, parseAtgMassDetail } from './tank-cargo-movements.js';
import { computeAtgWindowMassDelta } from './atg-window-rate.js';

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {object} opts
 * @param {number} opts.portId
 * @param {number} opts.loadLineId
 * @param {number} opts.tankId
 */
export async function buildSegmentInspectPayload(db, { portId, loadLineId, tankId }) {
  const r = await db.query(
    `SELECT
       t.id AS tank_id,
       t.code,
       t.name,
       t.sort_order,
       (m.tank_id IS NOT NULL) AS has_atg,
       m.source_base_url,
       src.last_poll_ok AS source_last_poll_ok,
       src.last_poll_at AS source_last_poll_at,
       src.last_error AS source_last_error,
       l.id AS load_line_id,
       l.line_order,
       l.qty,
       l.manual_qty,
       l.atg_qty_mode,
       l.started_at,
       l.ended_at,
       l.atg_mass_delta,
       l.atg_mass_detail,
       l.atg_mass_computed_at,
       oa.id AS activity_id,
       o.id AS operation_id,
       COALESCE(NULLIF(BTRIM(sp.vessel_name), ''), NULLIF(BTRIM(si.reference_number), ''), '—') AS vessel_name,
       spp.code AS purpose,
       j.name AS jetty_name,
       si.reference_number,
       COALESCE(
         (SELECT array_agg(clt2.tank_id ORDER BY clt2.tank_id)
          FROM operation_cargo_load_line_tanks clt2
          WHERE clt2.load_line_id = l.id),
         ARRAY[]::bigint[]
       ) AS all_tank_ids
     FROM operation_cargo_load_lines l
     JOIN operation_cargo_load_line_tanks clt ON clt.load_line_id = l.id AND clt.tank_id = $3
     JOIN master_tanks t ON t.id = clt.tank_id AND t.deleted_at IS NULL AND t.port_id = $1
     LEFT JOIN tank_gauging_tank_map m ON m.tank_id = t.id AND m.port_id = t.port_id
     LEFT JOIN tank_gauging_sources src
       ON src.port_id = t.port_id AND src.base_url = m.source_base_url
     JOIN operation_operational_activities oa
       ON oa.id = l.operational_activity_id
      AND oa.deleted_at IS NULL
      AND oa.milestone_key = 'cargo_operations'
     JOIN operations o ON o.id = oa.operation_id AND o.deleted_at IS NULL AND o.port_id = $1
     LEFT JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(sp.jetty_id, o.jetty_id) AND j.deleted_at IS NULL
     WHERE l.id = $2`,
    [portId, loadLineId, tankId]
  );

  if (!r.rows[0]) return null;

  const row = r.rows[0];
  const segment = mapTankCargoSegment(row);
  const allTankIds = (row.all_tank_ids || []).map(Number).filter((n) => n > 0);

  let liveAtg = null;
  if (segment.startAt && allTankIds.length) {
    const endAt = segment.endAt || new Date().toISOString();
    liveAtg = await computeAtgWindowMassDelta(db, {
      tankIds: allTankIds,
      startAt: segment.startAt,
      endAt,
    });
  }

  const storedDetail = parseAtgMassDetail(row.atg_mass_detail);

  return {
    segment: {
      ...segment,
      allTankIds: allTankIds.map(String),
    },
    tank: {
      tankId: String(row.tank_id),
      code: row.code,
      name: row.name ?? null,
      hasAtg: Boolean(row.has_atg),
    },
    poller: {
      sourceBaseUrl: row.source_base_url ?? null,
      lastPollOk: row.source_last_poll_ok ?? null,
      lastPollAt: row.source_last_poll_at
        ? new Date(row.source_last_poll_at).toISOString()
        : null,
      lastError: row.source_last_error ?? null,
    },
    integrity: {
      atgQtyMode: segment.atgQtyMode,
      storedQty: segment.qty,
      storedAtgMassDelta: segment.atgMassDelta,
      atgMassComputedAt: segment.atgMassComputedAt,
      qtySource: segment.qtySource,
      atgAuditStatus: segment.atgAuditStatus,
      liveAtgMassDelta: liveAtg?.sumDeltaMass ?? null,
      liveAtgError: liveAtg?.error ?? null,
      liveAtgIncomplete: liveAtg?.incomplete ?? null,
      boundaryTanks: Array.isArray(storedDetail?.tanks) ? storedDetail.tanks : [],
    },
  };
}
