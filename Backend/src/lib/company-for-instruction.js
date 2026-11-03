/**
 * Company choice on a shipping instruction, driven by the port's mapped companies.
 * hidden: no companies mapped yet (optional, store null)
 * locked: exactly one (always that company)
 * required: several (the instruction must name one of them)
 */

export function companyChoiceMode(activeMappedCount) {
  const n = Number(activeMappedCount) || 0;
  if (n <= 0) return 'hidden';
  if (n === 1) return 'locked';
  return 'required';
}

function parseRequested(raw) {
  if (raw == null || raw === '') return { id: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return { error: 'Invalid company_id' };
  return { id: n };
}

/**
 * @param {number[]} activeMappedIds
 * @param {unknown} requestedRaw
 * @param {{ omitted?: boolean, previousId?: number|null }} [opts]
 * @returns {{ companyId: number|null } | { error: string }}
 */
export function pickCompanyId(activeMappedIds, requestedRaw, opts = {}) {
  const ids = [...new Set((activeMappedIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  const parsed = parseRequested(opts.omitted ? null : requestedRaw);
  if (parsed.error) return { error: parsed.error };

  if (ids.length === 0) {
    if (!opts.omitted && parsed.id != null) return { error: 'Company is not used at this port' };
    return { companyId: null };
  }
  if (ids.length === 1) return { companyId: ids[0] };

  const chosen = opts.omitted ? (opts.previousId != null ? Number(opts.previousId) : null) : parsed.id;
  if (chosen == null || !Number.isFinite(chosen)) return { error: 'Company is required' };
  if (!ids.includes(chosen)) return { error: 'Company is not used at this port' };
  return { companyId: chosen };
}

export async function loadActiveMappedCompanyIds(db, portId) {
  const r = await db.query(
    `SELECT c.id
     FROM port_companies pc
     JOIN master_companies c ON c.id = pc.company_id AND c.deleted_at IS NULL AND c.is_active = TRUE
     WHERE pc.port_id = $1
     ORDER BY LOWER(COALESCE(NULLIF(c.short_name, ''), c.name)), c.id`,
    [portId]
  );
  return r.rows.map((row) => Number(row.id));
}

export function companyLabel(row) {
  const shortName = row?.short_name ?? row?.shortName ?? row?.company_short_name ?? row?.companyShortName;
  const fullName = row?.name ?? row?.company_name ?? row?.companyName;
  const short = shortName != null && String(shortName).trim() ? String(shortName).trim() : '';
  const name = fullName != null && String(fullName).trim() ? String(fullName).trim() : '';
  if (short && name && short.toLowerCase() !== name.toLowerCase()) return `${short} - ${name}`;
  return short || name;
}
