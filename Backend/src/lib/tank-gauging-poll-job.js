/**
 * Poll one or more Tankvision ATG hosts and upsert tank_gauging_latest.
 * Sources: tank_gauging_sources table (primary) or env fallback when table empty.
 */
import fs from 'fs';
import {
  fetchTankMeta,
  fetchTankParameters,
  parseTankMetaResponse,
  parseTankParameterResponse,
  readingToRawPayload,
  trimBaseUrl,
} from './tankvision-client.js';
import {
  resolveEnabledSources,
  updateSourcePollHealth,
} from './tank-gauging-source-config.js';

/** Dedicated advisory lock (distinct from SLA 930931). */
const ADVISORY_LOCK_KEY = 930932;

/**
 * @param {import('pg').Pool} db
 */
async function tryAdvisoryLock(db) {
  const r = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
  return Boolean(r.rows[0]?.ok);
}

/**
 * @param {import('pg').Pool} db
 */
async function releaseAdvisoryLock(db) {
  await db.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
}

function hostLabel(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return String(baseUrl || '').replace(/^https?:\/\//i, '');
  }
}

/**
 * Ensure master_tanks + tank_gauging_tank_map rows for tanks from one ATG source.
 * @param {import('pg').Pool} db
 * @param {number} portId
 * @param {string} sourceBaseUrl
 * @param {string|null} sourceUnitName
 * @param {Array<{ externalTankId: number, name: string, code: string }>} tanks
 */
export async function syncTankGaugingMap(db, portId, sourceBaseUrl, sourceUnitName, tanks) {
  let ensured = 0;
  let mapped = 0;
  const base = trimBaseUrl(sourceBaseUrl);

  await db.query(
    `DELETE FROM tank_gauging_tank_map WHERE port_id = $1 AND source_base_url = $2`,
    [portId, base]
  );

  for (const tank of tanks) {
    if (!tank.code) continue;

    let code = tank.code;
    let existing = await db.query(
      `SELECT id FROM master_tanks
       WHERE port_id = $1 AND deleted_at IS NULL AND LOWER(code) = LOWER($2)
       LIMIT 1`,
      [portId, code]
    );

    // If code already mapped to a different ATG source, disambiguate.
    if (existing.rows[0]) {
      const mappedElsewhere = await db.query(
        `SELECT 1 FROM tank_gauging_tank_map
         WHERE tank_id = $1 AND source_base_url <> $2
         LIMIT 1`,
        [existing.rows[0].id, base]
      );
      if (mappedElsewhere.rows[0]) {
        code = `${tank.code}@${hostLabel(base)}`;
        existing = await db.query(
          `SELECT id FROM master_tanks
           WHERE port_id = $1 AND deleted_at IS NULL AND LOWER(code) = LOWER($2)
           LIMIT 1`,
          [portId, code]
        );
      }
    }

    let tankId;
    if (existing.rows[0]) {
      tankId = existing.rows[0].id;
      await db.query(
        `UPDATE master_tanks
         SET name = COALESCE(NULLIF($2, ''), name), updated_at = NOW()
         WHERE id = $1`,
        [tankId, tank.name]
      );
    } else {
      const maxSort = await db.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
         FROM master_tanks WHERE port_id = $1 AND deleted_at IS NULL`,
        [portId]
      );
      const ins = await db.query(
        `INSERT INTO master_tanks (port_id, code, name, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [portId, code, tank.name, Number(maxSort.rows[0].next)]
      );
      tankId = ins.rows[0].id;
      ensured += 1;
    }

    await db.query(
      `INSERT INTO tank_gauging_tank_map (
         port_id, source_base_url, source_unit_name, external_tank_id, tank_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (port_id, source_base_url, external_tank_id) DO UPDATE SET
         tank_id = EXCLUDED.tank_id,
         source_unit_name = EXCLUDED.source_unit_name,
         updated_at = NOW()`,
      [portId, base, sourceUnitName, tank.externalTankId, tankId]
    );
    mapped += 1;
  }
  return { ensured, mapped, sourceBaseUrl: base, sourceUnitName };
}

/**
 * Poll a single ATG base URL.
 */
async function pollOneSource(db, portId, opts, baseUrl, sourceMeta = {}) {
  const base = trimBaseUrl(baseUrl);
  const auth = sourceMeta.auth;
  const sourceId = sourceMeta.id ?? null;
  const fetchOpts = { baseUrl: base, auth };

  async function finish(result) {
    await updateSourcePollHealth(db, sourceId, {
      ok: Boolean(result.ok),
      error: result.ok
        ? null
        : result.error || result.metaSync?.error || result.errors?.[0]?.message || 'poll failed',
    });
    return result;
  }

  let metaSync = null;
  let sourceUnitName = null;
  let productByExternalId = new Map();

  if (!opts.skipMetaSync) {
    let metaText = null;
    if (opts.metaFixturePath) {
      metaText = fs.readFileSync(opts.metaFixturePath, 'utf8');
    } else if (!opts.fixturePath) {
      const metaRes = await fetchTankMeta({ ...fetchOpts });
      if (metaRes.ok) metaText = metaRes.text;
      else metaSync = { ok: false, error: `meta HTTP ${metaRes.status}`, sourceBaseUrl: base };
    }
    if (metaText) {
      const parsed = parseTankMetaResponse(metaText);
      sourceUnitName = parsed.unitName;
      productByExternalId = parsed.productByExternalId ?? new Map();
      if (parsed.tanks.length) {
        const sync = await syncTankGaugingMap(db, portId, base, sourceUnitName, parsed.tanks);
        metaSync = {
          ok: true,
          parseMode: parsed.parseMode,
          tankCount: parsed.tanks.length,
          productMapSize: productByExternalId.size,
          ...sync,
        };
      } else {
        metaSync = { ok: false, parseMode: parsed.parseMode, error: 'No tanks in DATATYPE=23', sourceBaseUrl: base };
      }
    }
  } else if (opts.metaFixturePath) {
    const parsed = parseTankMetaResponse(fs.readFileSync(opts.metaFixturePath, 'utf8'));
    productByExternalId = parsed.productByExternalId ?? new Map();
    sourceUnitName = parsed.unitName;
  }

  let bodyText;
  let sourceUrl = null;
  let httpStatus = null;

  if (opts.fixturePath) {
    bodyText = fs.readFileSync(opts.fixturePath, 'utf8');
    sourceUrl = `fixture:${opts.fixturePath}`;
  } else {
    const res = await fetchTankParameters({ ...fetchOpts });
    bodyText = res.text;
    sourceUrl = res.url;
    httpStatus = res.status;
    if (!res.ok) {
      return finish({
        ok: false,
        sourceBaseUrl: base,
        sourceUnitName,
        httpStatus,
        sourceUrl,
        metaSync,
        error: `Tankvision HTTP ${res.status}`,
        fetched: 0,
        upserted: 0,
        unmapped: 0,
      });
    }
  }

  const { readings, parseMode } = parseTankParameterResponse(bodyText, productByExternalId);
  if (!readings.length) {
    return finish({
      ok: false,
      sourceBaseUrl: base,
      sourceUnitName,
      httpStatus,
      sourceUrl,
      metaSync,
      parseMode,
      error: 'No readings parsed from Tankvision response',
      fetched: 0,
      upserted: 0,
      unmapped: 0,
      rawPreview: bodyText.slice(0, 500),
    });
  }

  const mapRes = await db.query(
    `SELECT external_tank_id, tank_id, source_unit_name
     FROM tank_gauging_tank_map
     WHERE port_id = $1 AND source_base_url = $2`,
    [portId, base]
  );
  const mapByExternal = new Map(
    mapRes.rows.map((row) => [Number(row.external_tank_id), Number(row.tank_id)])
  );
  if (!sourceUnitName && mapRes.rows[0]?.source_unit_name) {
    sourceUnitName = mapRes.rows[0].source_unit_name;
  }

  const fetchedAt = new Date();
  let upserted = 0;
  let unmapped = 0;
  const errors = [];

  for (const reading of readings) {
    const tankId = mapByExternal.get(reading.externalTankId);
    if (tankId == null) {
      unmapped += 1;
      continue;
    }

    let recordedAt = null;
    if (reading.recordedAt) {
      const d = new Date(reading.recordedAt);
      if (!Number.isNaN(d.getTime())) recordedAt = d;
    }

    try {
      const rawPayload = JSON.stringify(readingToRawPayload(reading));

      await db.query(
        `INSERT INTO tank_gauging_latest (
           tank_id, product_name, tank_comment, level_mm, temperature_c,
           observed_density_kg_m3, total_observed_volume, total_mass,
           flow_rate_tph, status_text, tank_status_code, level_movement,
           gauge_ref_height_mm, recorded_at, fetched_at, raw_payload, source,
           source_base_url, source_unit_name
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)
         ON CONFLICT (tank_id) DO UPDATE SET
           product_name = EXCLUDED.product_name,
           tank_comment = EXCLUDED.tank_comment,
           level_mm = EXCLUDED.level_mm,
           temperature_c = EXCLUDED.temperature_c,
           observed_density_kg_m3 = EXCLUDED.observed_density_kg_m3,
           total_observed_volume = EXCLUDED.total_observed_volume,
           total_mass = EXCLUDED.total_mass,
           flow_rate_tph = EXCLUDED.flow_rate_tph,
           status_text = EXCLUDED.status_text,
           tank_status_code = EXCLUDED.tank_status_code,
           level_movement = EXCLUDED.level_movement,
           gauge_ref_height_mm = EXCLUDED.gauge_ref_height_mm,
           recorded_at = EXCLUDED.recorded_at,
           fetched_at = EXCLUDED.fetched_at,
           raw_payload = EXCLUDED.raw_payload,
           source = EXCLUDED.source,
           source_base_url = EXCLUDED.source_base_url,
           source_unit_name = EXCLUDED.source_unit_name`,
        [
          tankId,
          reading.productName,
          reading.tankComment,
          reading.levelMm,
          reading.temperatureC,
          reading.observedDensityKgM3,
          reading.totalObservedVolume,
          reading.totalMass,
          reading.flowRateTph,
          reading.statusText,
          reading.tankStatusCode,
          reading.levelMovement,
          reading.gaugeRefHeightMm,
          recordedAt,
          fetchedAt,
          rawPayload,
          opts.fixturePath ? 'fixture' : 'tankvision-gwt',
          base,
          sourceUnitName,
        ]
      );
      await db.query(
        `INSERT INTO tank_gauging_samples (
           tank_id, source_base_url, product_name, tank_comment, total_mass,
           flow_rate_tph, level_mm, temperature_c, observed_density_kg_m3,
           total_observed_volume, status_text, sampled_at, raw_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          tankId,
          base,
          reading.productName,
          reading.tankComment,
          reading.totalMass,
          reading.flowRateTph,
          reading.levelMm,
          reading.temperatureC,
          reading.observedDensityKgM3,
          reading.totalObservedVolume,
          reading.statusText,
          fetchedAt,
          rawPayload,
        ]
      );
      upserted += 1;
    } catch (e) {
      errors.push({
        externalTankId: reading.externalTankId,
        tankId,
        message: e?.message || String(e),
      });
    }
  }

  return finish({
    ok: errors.length === 0 && unmapped === 0,
    sourceBaseUrl: base,
    sourceUnitName,
    httpStatus,
    sourceUrl,
    metaSync,
    parseMode,
    fetched: readings.length,
    upserted,
    unmapped,
    mapSize: mapByExternal.size,
    errors,
    fetchedAt: fetchedAt.toISOString(),
  });
}

/**
 * @param {import('pg').Pool} db
 * @param {object} [opts]
 * @param {number} [opts.portId]
 * @param {string[]} [opts.baseUrls]
 * @param {string} [opts.fixturePath]
 * @param {string} [opts.metaFixturePath]
 * @param {boolean} [opts.skipLock]
 * @param {boolean} [opts.skipMetaSync]
 */
export async function runTankGaugingPollJob(db, opts = {}) {
  const filterPortId =
    opts.portId != null && Number.isFinite(Number(opts.portId)) && Number(opts.portId) > 0
      ? Number(opts.portId)
      : null;

  const skipLock = Boolean(opts.skipLock);
  if (!skipLock) {
    const locked = await tryAdvisoryLock(db);
    if (!locked) return { skipped: true, reason: 'lock_not_acquired' };
  }

  try {
    // Fixture mode stays single-source (dev/offline).
    if (opts.fixturePath) {
      const portId = Number(filterPortId ?? process.env.TANK_GAUGING_PORT_ID);
      if (!Number.isFinite(portId) || portId <= 0) {
        return { skipped: true, reason: 'missing_or_invalid_TANK_GAUGING_PORT_ID' };
      }
      const baseUrl = trimBaseUrl(
        opts.baseUrls?.[0] || process.env.TANK_GAUGING_BASE_URL || 'http://172.16.11.77'
      );
      const sources = [await pollOneSource(db, portId, opts, baseUrl)];
      const fetched = sources.reduce((n, s) => n + (s.fetched || 0), 0);
      const upserted = sources.reduce((n, s) => n + (s.upserted || 0), 0);
      const unmapped = sources.reduce((n, s) => n + (s.unmapped || 0), 0);
      return {
        skipped: false,
        ok: sources.every((s) => s.ok),
        portId,
        sourceCount: 1,
        fetched,
        upserted,
        unmapped,
        sources,
      };
    }

    const enabledSources = await resolveEnabledSources(db, { portId: filterPortId });
    if (!enabledSources.length) {
      return {
        skipped: true,
        reason: filterPortId
          ? 'no_enabled_sources_for_port'
          : 'no_enabled_sources',
      };
    }

    const sources = [];
    for (const src of enabledSources) {
      try {
        sources.push(
          await pollOneSource(db, src.portId, opts, src.baseUrl, {
            id: src.id,
            auth: src.auth,
          })
        );
      } catch (e) {
        const errMsg = e?.message || String(e);
        await updateSourcePollHealth(db, src.id, { ok: false, error: errMsg });
        sources.push({
          ok: false,
          sourceBaseUrl: trimBaseUrl(src.baseUrl),
          error: errMsg,
          fetched: 0,
          upserted: 0,
          unmapped: 0,
        });
      }
    }

    const fetched = sources.reduce((n, s) => n + (s.fetched || 0), 0);
    const upserted = sources.reduce((n, s) => n + (s.upserted || 0), 0);
    const unmapped = sources.reduce((n, s) => n + (s.unmapped || 0), 0);

    const portIds = [...new Set(enabledSources.map((s) => s.portId))];

    return {
      skipped: false,
      ok: sources.length > 0 && sources.every((s) => s.ok),
      portId: portIds.length === 1 ? portIds[0] : null,
      portIds,
      sourceCount: sources.length,
      fetched,
      upserted,
      unmapped,
      sources,
    };
  } finally {
    if (!skipLock) await releaseAdvisoryLock(db);
  }
}
