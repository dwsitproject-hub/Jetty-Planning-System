/**
 * Link legacy shipment plans (master_vessel_id null) to master_vessels by vessel name.
 * Only an exact match after normalizing case and punctuation counts; anything else is left for admins.
 */
import { normalizeVesselName } from './vessel-name-similarity.js';

/**
 * @param {{ id: unknown, vessel_name: string }[]} plans
 * @param {{ id: unknown, vessel_name: string }[]} vessels active master vessels
 * @returns {{ matched: { planId: number, masterVesselId: number }[], unmatched: object[], ambiguous: object[] }}
 */
export function matchPlansToMasterVessels(plans, vessels) {
  const byName = new Map();
  for (const v of vessels) {
    const k = normalizeVesselName(v.vessel_name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(Number(v.id));
  }
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  for (const p of plans) {
    const ids = byName.get(normalizeVesselName(p.vessel_name)) || [];
    if (ids.length === 1) matched.push({ planId: Number(p.id), masterVesselId: ids[0] });
    else if (ids.length > 1) ambiguous.push({ planId: Number(p.id), vesselName: p.vessel_name, masterVesselIds: ids });
    else unmatched.push({ planId: Number(p.id), vesselName: p.vessel_name });
  }
  return { matched, unmatched, ambiguous };
}
