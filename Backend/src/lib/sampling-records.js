/**
 * Pure per-palka record operations for the `sampling` sub-process payload.
 * The store (`sampling-records-store.js`) applies these under a row lock so two editors
 * (QC menu and Loading hub) never overwrite each other's samples.
 */
import { metricToString, toMetricNumber } from './sampling-document-extract.js';

const MAX_PALKA_CHARS = 20;
const MAX_RECORD_REMARK_CHARS = 200;
const METRIC_MAX = 100;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function isLoadingSampleRef(purpose) {
  return String(purpose || '').trim().toLowerCase() === 'loading';
}

export function parseTankId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw badRequest('Invalid tankId');
  return id;
}

function snapshotCode(code) {
  const noPalka = String(code ?? '').trim();
  if (!noPalka) throw badRequest('tankId is required');
  if (noPalka.length > MAX_PALKA_CHARS) throw badRequest(`noPalka must be at most ${MAX_PALKA_CHARS} characters`);
  return noPalka;
}

function parsePalkaLabel(raw) {
  const noPalka = String(raw ?? '').trim();
  if (!noPalka) throw badRequest('noPalka is required');
  if (noPalka.length > MAX_PALKA_CHARS) throw badRequest(`noPalka must be at most ${MAX_PALKA_CHARS} characters`);
  return noPalka;
}

/** Active (or optionally deleted) Master Tank on this port. */
export async function resolvePortTank(db, tankId, portId, { includeDeleted = false } = {}) {
  const id = parseTankId(tankId);
  const pid = Number(portId);
  if (id == null || !Number.isFinite(pid) || pid <= 0) return null;
  const deleted = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const r = await db.query(
    `SELECT id, code FROM master_tanks WHERE id = $1 AND port_id = $2${deleted}`,
    [id, pid]
  );
  if (!r.rows[0]) return null;
  return { id: Number(r.rows[0].id), code: String(r.rows[0].code).trim() };
}

export async function resolvePortTanks(db, tankIds, portId, { includeDeleted = false } = {}) {
  const ids = [...new Set((tankIds || []).map((raw) => {
    try {
      return parseTankId(raw);
    } catch {
      return null;
    }
  }).filter((id) => id != null))];
  const map = new Map();
  const pid = Number(portId);
  if (ids.length === 0 || !Number.isFinite(pid) || pid <= 0) return map;
  const deleted = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const r = await db.query(
    `SELECT id, code FROM master_tanks WHERE id = ANY($1::bigint[]) AND port_id = $2${deleted}`,
    [ids, pid]
  );
  for (const row of r.rows) map.set(Number(row.id), { id: Number(row.id), code: String(row.code).trim() });
  return map;
}

export async function loadOperationSampleRef(db, operationId) {
  const r = await db.query(`SELECT purpose, port_id FROM operations WHERE id = $1`, [operationId]);
  const row = r.rows[0];
  return {
    purpose: row?.purpose ?? null,
    portId: row?.port_id != null ? Number(row.port_id) : null,
  };
}

function cleanMetric(raw, label) {
  if (raw == null || String(raw).trim() === '') return '';
  const n = toMetricNumber(raw);
  if (n == null || n < 0 || n > METRIC_MAX) throw badRequest(`Invalid ${label}`);
  return metricToString(n);
}

function parseRemark(raw) {
  const remark = String(raw ?? '').trim();
  if (remark.length > MAX_RECORD_REMARK_CHARS) {
    throw badRequest(`Remark must be at most ${MAX_RECORD_REMARK_CHARS} characters`);
  }
  return remark;
}

/**
 * Validate a record body. `partial` (PATCH) only checks fields that were sent.
 * `sampleCodes` comes from the commodity template; defaults to FFA + Moisture.
 */
export function parseRecordInput(body = {}, { partial = false, sampleCodes, purpose, tank = null, requireTank = false } = {}) {
  const codes = sampleCodes?.length ? sampleCodes : ['ffa', 'moisture'];
  const out = {};
  if (isLoadingSampleRef(purpose)) {
    const tankTouched = !partial || body.tankId !== undefined || body.noPalka !== undefined;
    if (tankTouched) {
      if (tank) {
        out.tankId = Number(tank.id);
        out.noPalka = snapshotCode(tank.code);
      } else if (requireTank) {
        throw badRequest('tankId is required');
      } else if (body.tankId !== undefined && String(body.tankId ?? '').trim() !== '') {
        throw badRequest('Tank is not on this port');
      } else if (!partial) {
        out.noPalka = parsePalkaLabel(body.noPalka);
      }
    }
  } else if (!partial || body.noPalka !== undefined) {
    out.noPalka = parsePalkaLabel(body.noPalka);
  }
  for (const code of codes) {
    if (!partial || body[code] !== undefined) out[code] = cleanMetric(body[code], code);
  }
  if (!partial || body.remark !== undefined) out.remark = parseRemark(body.remark);
  if (!partial && codes.every((code) => !out[code])) throw badRequest('Enter a sample value');
  return out;
}

function notFound() {
  return Object.assign(new Error('Sample not found'), { statusCode: 404 });
}

export function addRecord(records, input, id) {
  const record = { id, ...input };
  return { records: [...records, record], record };
}

export function updateRecord(records, id, patch) {
  let record = null;
  const next = records.map((r) => {
    if (r.id !== id) return r;
    record = { ...r, ...patch };
    return record;
  });
  if (!record) throw notFound();
  return { records: next, record };
}

export function removeRecord(records, id) {
  const record = records.find((r) => r.id === id);
  if (!record) throw notFound();
  return { records: records.filter((r) => r.id !== id), record };
}
