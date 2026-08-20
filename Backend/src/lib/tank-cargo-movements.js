/** Audit helpers for port tank cargo movement board (read-only aggregation). */

/** Rounding noise between stored qty and ATG delta (matches cargo-line-qty.js). */
export const QTY_EPSILON = 1e-6;

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>|null}
 */
export function parseAtgMassDetail(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {'auto'|'manual'|string|null|undefined} opts.atgQtyMode
 * @param {number|null|undefined} opts.qty
 * @param {number|null|undefined} opts.atgMassDelta
 * @param {unknown} opts.atgMassDetail
 * @param {string|null|undefined} opts.endAt
 */
export function deriveSegmentAudit({ atgQtyMode, qty, atgMassDelta, atgMassDetail, endAt }) {
  const mode = atgQtyMode === 'manual' ? 'manual' : 'auto';
  const hasEnd = endAt != null && endAt !== '';
  const detail = parseAtgMassDetail(atgMassDetail);
  const delta =
    atgMassDelta != null && Number.isFinite(Number(atgMassDelta)) ? Number(atgMassDelta) : null;
  const storedQty = qty != null && Number.isFinite(Number(qty)) ? Number(qty) : null;

  if (!hasEnd) {
    return { qtySource: null, atgAuditStatus: 'in_progress' };
  }

  if (mode === 'manual') {
    return { qtySource: 'manual', atgAuditStatus: 'manual_override' };
  }

  const err = typeof detail?.error === 'string' ? detail.error : null;
  if (err && (err === 'no_samples' || err.startsWith('no_sample') || err === 'partial_samples')) {
    return { qtySource: 'unverified', atgAuditStatus: 'sample_gap' };
  }
  if (detail?.incomplete === true && err) {
    return { qtySource: 'unverified', atgAuditStatus: 'sample_gap' };
  }

  if (delta != null && delta > 0 && storedQty != null && Math.abs(storedQty - delta) <= QTY_EPSILON) {
    return { qtySource: 'atg', atgAuditStatus: 'ok' };
  }

  if (storedQty != null && (delta == null || Math.abs(storedQty - delta) > QTY_EPSILON)) {
    return { qtySource: 'unverified', atgAuditStatus: 'qty_mismatch' };
  }

  if (delta != null && delta > 0) {
    return { qtySource: 'atg', atgAuditStatus: 'ok' };
  }

  return { qtySource: 'unverified', atgAuditStatus: 'sample_gap' };
}

/**
 * @param {object} row — DB row or test fixture
 */
export function mapTankCargoSegment(row) {
  const startAt = row.started_at
    ? new Date(row.started_at).toISOString()
    : row.startAt != null
      ? String(row.startAt)
      : null;
  const endAt = row.ended_at
    ? new Date(row.ended_at).toISOString()
    : row.endAt != null
      ? String(row.endAt)
      : null;
  const qty = row.qty != null ? Number(row.qty) : null;
  const manualQty = row.manual_qty != null ? Number(row.manual_qty) : row.manualQty ?? null;
  const atgMassDelta =
    row.atg_mass_delta != null && row.atg_mass_delta !== ''
      ? Number(row.atg_mass_delta)
      : row.atgMassDelta != null
        ? Number(row.atgMassDelta)
        : null;
  const atgQtyMode = row.atg_qty_mode || row.atgQtyMode || 'auto';
  const atgMassDetail = row.atg_mass_detail ?? row.atgMassDetail ?? null;
  const { qtySource, atgAuditStatus } = deriveSegmentAudit({
    atgQtyMode,
    qty,
    atgMassDelta,
    atgMassDetail,
    endAt,
  });

  return {
    loadLineId: String(row.load_line_id ?? row.loadLineId),
    lineOrder: Number(row.line_order ?? row.lineOrder ?? 0),
    tankId: String(row.tank_id ?? row.tankId),
    startAt,
    endAt,
    qty,
    manualQty: manualQty != null ? Number(manualQty) : null,
    atgQtyMode,
    atgMassDelta,
    atgMassDetail: parseAtgMassDetail(atgMassDetail),
    atgMassComputedAt: row.atg_mass_computed_at ?? row.atgMassComputedAt ?? null,
    operationId: String(row.operation_id ?? row.operationId),
    activityId: String(row.activity_id ?? row.activityId),
    vesselName: row.vessel_name ?? row.vesselName ?? '—',
    purpose: row.purpose ?? null,
    jettyName: row.jetty_name ?? row.jettyName ?? null,
    referenceNumber: row.reference_number ?? row.referenceNumber ?? null,
    qtySource,
    atgAuditStatus,
  };
}

/**
 * @param {Array<object>} rows — flat SQL rows (one per tank × segment)
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 */
export function groupTankBoardRows(rows, { nowMs = Date.now() } = {}) {
  const byTank = new Map();

  for (const row of rows) {
    const tankId = String(row.tank_id);
    if (!byTank.has(tankId)) {
      byTank.set(tankId, {
        tankId,
        code: row.code,
        name: row.name ?? null,
        sortOrder: row.sort_order != null ? Number(row.sort_order) : 0,
        hasAtg: Boolean(row.has_atg),
        sourceLastPollOk: row.source_last_poll_ok ?? null,
        sourceLastPollAt: row.source_last_poll_at
          ? new Date(row.source_last_poll_at).toISOString()
          : null,
        sourceLastError: row.source_last_error ?? null,
        sourceBaseUrl: row.source_base_url ?? null,
        productName: row.product_name ?? null,
        currentMass: row.current_mass != null ? Number(row.current_mass) : null,
        currentVolume:
          row.current_volume != null ? Number(row.current_volume) : null,
        recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
        segments: [],
      });
    }

    if (row.load_line_id != null) {
      byTank.get(tankId).segments.push(mapTankCargoSegment(row));
    }
  }

  const nowIso = new Date(nowMs).toISOString();

  return [...byTank.values()]
    .map((tank) => {
      tank.segments.sort((a, b) => {
        const ta = a.startAt ? Date.parse(a.startAt) : 0;
        const tb = b.startAt ? Date.parse(b.startAt) : 0;
        if (ta !== tb) return ta - tb;
        return a.lineOrder - b.lineOrder;
      });

      const open = tank.segments.find(
        (s) => s.endAt == null && s.startAt != null && s.startAt <= nowIso
      );
      tank.currentMovement = open
        ? {
            vesselName: open.vesselName,
            operationId: open.operationId,
            purpose: open.purpose,
            isOpen: true,
          }
        : null;

      return tank;
    })
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.code || '').localeCompare(String(b.code || ''), undefined, {
        sensitivity: 'base',
      });
    });
}
