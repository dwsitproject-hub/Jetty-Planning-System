/**
 * Multi-jetty berthing: adjacency, commodity-type, and occupancy-conflict validation.
 *
 * A vessel may be allocated to a primary jetty (jetty_id) plus one or more additional
 * jetties (additional_jetties) when the port's allow_multi_jetty_berthing flag is on.
 * "Adjacent" is an explicit admin config (jetty_adjacencies, set in Master – Jetty),
 * independent of the visual jetty_layouts schematic.
 */

/** True if the port allows spanning a vessel across multiple jetties. */
export async function getPortAllowsMultiJetty(db, portId) {
  const r = await db.query('SELECT allow_multi_jetty_berthing FROM ports WHERE id = $1', [portId]);
  return r.rows[0]?.allow_multi_jetty_berthing === true;
}

/** Explicitly-configured adjacent jetty ids (Master – Jetty "Adjacent Jetties" multi-select). */
export async function getAdjacentJettyIds(db, jettyId) {
  const r = await db.query('SELECT adjacent_jetty_id FROM jetty_adjacencies WHERE jetty_id = $1', [jettyId]);
  return r.rows.map((row) => Number(row.adjacent_jetty_id));
}

/** True if `jettyId` has at least one jetty_commodities link of `commodityType` for `operationalPurpose`. */
export async function jettySupportsCommodityType(db, jettyId, commodityType, operationalPurpose) {
  if (!commodityType || !operationalPurpose) return true;
  const r = await db.query(
    `SELECT 1 FROM jetty_commodities jc
     JOIN si_commodities sc ON sc.id = jc.commodity_id AND sc.deleted_at IS NULL
     WHERE jc.jetty_id = $1 AND jc.operational_purpose = $2 AND sc.commodity_type = $3
     LIMIT 1`,
    [jettyId, operationalPurpose, commodityType]
  );
  return r.rows.length > 0;
}

/**
 * Active (non-SAILED, not shifting-out) operations occupying any of `jettyIds`,
 * either as primary (jetty_id) or as a secondary/spanned berth (additional_jetties).
 */
export async function findActiveOccupants(db, jettyIds, { excludeOperationId = null } = {}) {
  const ids = (jettyIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return [];
  const r = await db.query(
    `SELECT o.id, o.jetty_id, o.additional_jetties, sp.vessel_name
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.status, '') <> 'SAILED'
       AND COALESCE(o.shifting_out, false) = false
       AND (o.jetty_id = ANY($1::bigint[]) OR o.additional_jetties && $1::bigint[])
       AND ($2::bigint IS NULL OR o.id <> $2)`,
    [ids, excludeOperationId]
  );
  return r.rows;
}

/** Normalize a mixed array of jetty ids/strings to a de-duplicated array of positive numbers. */
export function normalizeJettyIdList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
}

/**
 * Full validation for assigning `additionalJettyIds` alongside `primaryJettyId`.
 * Returns { ok: true } or { ok: false, status, error }.
 *
 * `db` may be a pool or an in-transaction client — pass the transaction client when called
 * from a write path so occupancy reads are consistent with the surrounding UPDATE.
 */
export async function validateMultiJettySelection(db, {
  portId,
  primaryJettyId,
  additionalJettyIds,
  commodityType = null,
  operationalPurpose = null,
  excludeOperationId = null,
}) {
  const additionalIds = normalizeJettyIdList(additionalJettyIds);
  if (!additionalIds.length) return { ok: true };

  if (!(await getPortAllowsMultiJetty(db, portId))) {
    return { ok: false, status: 400, error: 'Multi-jetty berthing is not enabled for this port.' };
  }

  if (primaryJettyId != null && additionalIds.includes(Number(primaryJettyId))) {
    return { ok: false, status: 400, error: 'The primary jetty cannot also be selected as an additional jetty.' };
  }

  const adjacent = new Set(await getAdjacentJettyIds(db, primaryJettyId));
  for (const id of additionalIds) {
    if (!adjacent.has(id)) {
      return {
        ok: false,
        status: 400,
        error: `Jetty ${id} is not configured as adjacent to the primary jetty (see Master – Jetty) and cannot be spanned.`,
      };
    }
  }

  const statusRows = await db.query(
    'SELECT id, name, status FROM jetties WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL',
    [additionalIds]
  );
  const outOfService = statusRows.rows.find((r) => r.status === 'Out of Service');
  if (outOfService) {
    return {
      ok: false,
      status: 409,
      error: `Jetty ${outOfService.name} is out of service and cannot be spanned into.`,
    };
  }

  if (commodityType) {
    const supportChecks = await Promise.all(
      additionalIds.map((id) => jettySupportsCommodityType(db, id, commodityType, operationalPurpose))
    );
    if (!supportChecks.some(Boolean)) {
      return {
        ok: false,
        status: 400,
        error: `None of the selected additional jetties support ${commodityType} cargo.`,
      };
    }
  }

  const occupants = await findActiveOccupants(db, additionalIds, { excludeOperationId });
  if (occupants.length) {
    return {
      ok: false,
      status: 409,
      error: `Jetty already occupied by ${occupants[0].vessel_name} and cannot be spanned into.`,
    };
  }

  return { ok: true };
}
