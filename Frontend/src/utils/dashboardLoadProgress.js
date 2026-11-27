/**
 * Management Dashboard loading progress. The page loads in four steps, one after the other;
 * each step has a weight so the bar moves steadily instead of jumping.
 */
export const LOAD_STAGES = [
  { key: 'ops', label: 'Loading operations', weight: 10 },
  { key: 'rates', label: 'Calculating cargo rates', weight: 25 },
  { key: 'acts', label: 'Loading cargo activities', weight: 25 },
  { key: 'timelines', label: 'Loading activity timelines', weight: 40 },
]

/**
 * @param {string} stageKey one of LOAD_STAGES
 * @param {number} done items finished in this step
 * @param {number} total items in this step (0 = unknown, counts as just started)
 * @returns {number} 0–100, whole percent
 */
export function loadPercent(stageKey, done = 0, total = 0) {
  const at = LOAD_STAGES.findIndex((s) => s.key === stageKey)
  if (at < 0) return 0
  const before = LOAD_STAGES.slice(0, at).reduce((sum, s) => sum + s.weight, 0)
  const share = total > 0 ? Math.min(Math.max(done / total, 0), 1) : 0
  return Math.round(before + LOAD_STAGES[at].weight * share)
}

export const loadLabel = (stageKey) => LOAD_STAGES.find((s) => s.key === stageKey)?.label ?? 'Loading'
