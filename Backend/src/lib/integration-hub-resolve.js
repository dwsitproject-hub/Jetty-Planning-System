/**
 * Partner integration API — resolve port / commodity hub codes to internal ids.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md v5.2.
 */

export const PORT_HUB_CODE_MAX_LEN = 50;
export const CARGO_HUB_CODE_MAX_LEN = 50;

/** Same normalization as integrations.js cargo short names. */
export function normalizeCargoShortName(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return v || null;
}

/**
 * @returns {{ errors: Array<{field: string, issue: string}>, portId: number | null, portHubCode: string | null }}
 */
export function validateIntegrationPortInput(portIdRaw, portHubCodeRaw) {
  const errors = [];
  const push = (field, issue) => errors.push({ field, issue });

  const portHubCode =
    portHubCodeRaw != null && String(portHubCodeRaw).trim() !== ''
      ? String(portHubCodeRaw).trim()
      : null;
  const portIdParsed =
    portIdRaw != null && portIdRaw !== '' ? Number.parseInt(portIdRaw, 10) : Number.NaN;
  const portId = Number.isFinite(portIdParsed) && !Number.isNaN(portIdParsed) ? portIdParsed : null;

  if (portHubCode && portHubCode.length > PORT_HUB_CODE_MAX_LEN) {
    push('port_hub_code', `max length ${PORT_HUB_CODE_MAX_LEN}`);
  }

  if (portId != null) {
    push('port_id', 'legacy port_id is not accepted; use port_hub_code');
  }
  if (!portHubCode) {
    push('port_hub_code', 'required');
  }

  return { errors, portId: null, portHubCode };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ portId?: number | null, portHubCode?: string | null }} opts
 */
export async function resolvePortForIntegration(db, { portId, portHubCode }) {
  const hub =
    portHubCode != null && String(portHubCode).trim() !== '' ? String(portHubCode).trim() : null;
  const id = portId != null && Number.isFinite(portId) ? Number(portId) : null;

  if (hub) {
    const r = await db.query(
      `SELECT id, hub_code, name FROM ports
       WHERE hub_code = $1 AND deleted_at IS NULL AND is_active IS TRUE`,
      [hub]
    );
    if (r.rows.length === 0) {
      return { error: `No port found for port_hub_code "${hub}"`, field: 'port_hub_code' };
    }
    const row = r.rows[0];
    if (id != null && Number(row.id) !== id) {
      return {
        error: 'port_id does not match the port for port_hub_code',
        field: 'port_id',
      };
    }
    return row;
  }

  if (id != null) {
    const r = await db.query(
      `SELECT id, hub_code, name FROM ports
       WHERE id = $1 AND deleted_at IS NULL AND is_active IS TRUE`,
      [id]
    );
    if (r.rows.length === 0) {
      return { error: 'unknown port', field: 'port_id' };
    }
    return r.rows[0];
  }

  return { error: 'port_id or port_hub_code is required', field: 'port_id' };
}

/**
 * @param {string | null | undefined} cargoTypeRaw
 * @param {string | null | undefined} cargoHubCodeRaw
 * @param {number} index
 * @returns {{ errors: Array<{field: string, issue: string}>, cargoType: string | null, cargoHubCode: string | null }}
 */
export function validateIntegrationCargoLineIdentifiers(cargoTypeRaw, cargoHubCodeRaw, index) {
  const errors = [];
  const push = (field, issue) => errors.push({ field, issue });

  const cargoHubCode =
    cargoHubCodeRaw != null && String(cargoHubCodeRaw).trim() !== ''
      ? String(cargoHubCodeRaw).trim()
      : null;
  const cargoType =
    cargoTypeRaw != null && String(cargoTypeRaw).trim() !== '' ? String(cargoTypeRaw).trim() : null;

  if (cargoHubCode && cargoHubCode.length > CARGO_HUB_CODE_MAX_LEN) {
    push(`cargo[${index}].cargo_hub_code`, `max length ${CARGO_HUB_CODE_MAX_LEN}`);
  }
  if (cargoType && cargoType.length > 100) {
    push(`cargo[${index}].cargo_type`, 'max length 100');
  }

  if (cargoType) {
    push(`cargo[${index}].cargo_type`, 'legacy cargo_type is not accepted; use cargo_hub_code');
  }
  if (!cargoHubCode) {
    push(`cargo[${index}].cargo_hub_code`, 'required');
  }

  return { errors, cargoType: null, cargoHubCode };
}

export async function listCommodityShortNamesForCatalog(db) {
  const r = await db.query(
    `SELECT short_name FROM si_commodities WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY short_name`
  );
  return r.rows.map((row) => row.short_name);
}

export async function listActivePortHubCodes(db) {
  const r = await db.query(
    `SELECT hub_code FROM ports
     WHERE deleted_at IS NULL AND is_active IS TRUE AND hub_code IS NOT NULL
     ORDER BY hub_code`
  );
  return r.rows.map((row) => row.hub_code);
}

export async function listPortsForCatalog(db) {
  const r = await db.query(
    `SELECT id, hub_code, name FROM ports
     WHERE deleted_at IS NULL AND is_active IS TRUE
     ORDER BY id`
  );
  return r.rows.map((row) => ({
    jps_port_id: Number(row.id),
    hub_code: row.hub_code ?? null,
    name: row.name ?? null,
  }));
}

export async function listActiveCommodityHubCodes(db) {
  const r = await db.query(
    `SELECT hub_code FROM si_commodities
     WHERE deleted_at IS NULL AND is_active IS TRUE AND hub_code IS NOT NULL
     ORDER BY hub_code`
  );
  return r.rows.map((row) => row.hub_code);
}

export async function listCommoditiesForCatalog(db) {
  const r = await db.query(
    `SELECT id, hub_code, short_name, name FROM si_commodities
     WHERE deleted_at IS NULL AND is_active IS TRUE
     ORDER BY short_name`
  );
  return r.rows.map((row) => ({
    jps_commodity_id: Number(row.id),
    hub_code: row.hub_code ?? null,
    short_name: row.short_name ?? null,
    name: row.name ?? null,
  }));
}

const COMMODITY_SELECT = `
  SELECT c.id, c.short_name, c.hub_code, c.commodity_type, c.default_metric_id, dm.code AS default_metric_code
  FROM si_commodities c
  LEFT JOIN metric dm ON dm.id = c.default_metric_id AND dm.deleted_at IS NULL`;

/**
 * Resolve each cargo line to a commodity row (hub code preferred, short_name fallback).
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {Array<{ cargoType: string | null, cargoHubCode: string | null, [key: string]: unknown }>} cargoLines
 */
export async function resolveCargoCommodities(db, cargoLines) {
  const errors = [];
  const hubCodes = [...new Set(cargoLines.map((l) => l.cargoHubCode).filter(Boolean))];
  const shortNames = [
    ...new Set(cargoLines.map((l) => normalizeCargoShortName(l.cargoType)).filter(Boolean)),
  ];

  const byHub = new Map();
  if (hubCodes.length > 0) {
    const r = await db.query(
      `${COMMODITY_SELECT}
       WHERE c.hub_code = ANY($1) AND c.deleted_at IS NULL AND c.is_active = TRUE`,
      [hubCodes]
    );
    for (const row of r.rows) byHub.set(String(row.hub_code), row);
  }

  const byShort = new Map();
  if (shortNames.length > 0) {
    const r = await db.query(
      `${COMMODITY_SELECT}
       WHERE UPPER(c.short_name) = ANY($1) AND c.deleted_at IS NULL AND c.is_active = TRUE`,
      [shortNames]
    );
    for (const row of r.rows) byShort.set(normalizeCargoShortName(row.short_name), row);
  }

  const resolvedCargo = [];
  for (let i = 0; i < cargoLines.length; i += 1) {
    const line = cargoLines[i];
    let row = null;

    if (line.cargoHubCode) {
      row = byHub.get(line.cargoHubCode) ?? null;
      if (!row) {
        errors.push({
          field: `cargo[${i}].cargo_hub_code`,
          issue: `unknown cargo hub code: ${line.cargoHubCode}`,
        });
        continue;
      }
      const typedShort = normalizeCargoShortName(line.cargoType);
      if (typedShort && typedShort !== normalizeCargoShortName(row.short_name)) {
        errors.push({
          field: `cargo[${i}].cargo_type`,
          issue: 'does not match the commodity for cargo_hub_code',
        });
        continue;
      }
    } else if (line.cargoType) {
      row = byShort.get(normalizeCargoShortName(line.cargoType)) ?? null;
      if (!row) {
        errors.push({
          field: `cargo[${i}].cargo_type`,
          issue: `unknown cargo type: ${line.cargoType}`,
        });
        continue;
      }
    }

    resolvedCargo.push({
      ...line,
      cargoType: row.short_name,
      cargoHubCode: line.cargoHubCode ?? row.hub_code ?? null,
    });
  }

  if (errors.length > 0) {
    return { errors, commodityByShortName: null, cargo: [] };
  }

  const commodityByShortName = new Map();
  for (const line of resolvedCargo) {
    const key = normalizeCargoShortName(line.cargoType);
    // Resolved lines may echo hub_code from master even when partner sent cargo_type only;
    // byHub is only prefetched from submitted hub codes, so prefer byShort (canonical short_name).
    let row = byShort.get(key);
    if (!row && line.cargoHubCode) {
      row = byHub.get(line.cargoHubCode) ?? null;
    }
    if (row) commodityByShortName.set(key, row);
  }

  return { errors: [], commodityByShortName, cargo: resolvedCargo };
}
