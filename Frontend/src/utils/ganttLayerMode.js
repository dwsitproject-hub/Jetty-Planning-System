export const GANTT_LAYER_STORAGE_KEY = 'jps-gantt-layer-mode'

export const GANTT_LAYER_MODES = ['both', 'planned', 'actual']

/** @param {string | null | undefined} v */
export function normalizeGanttLayerMode(v) {
  return GANTT_LAYER_MODES.includes(v) ? v : 'both'
}

export function readGanttLayerMode() {
  try {
    return normalizeGanttLayerMode(localStorage.getItem(GANTT_LAYER_STORAGE_KEY))
  } catch {
    return 'both'
  }
}

/** @param {string} mode */
export function writeGanttLayerMode(mode) {
  try {
    localStorage.setItem(GANTT_LAYER_STORAGE_KEY, normalizeGanttLayerMode(mode))
  } catch {
    /* ignore */
  }
}

/** @param {string | null | undefined} layerMode */
export function resolveGanttLayerVisibility(layerMode) {
  const mode = normalizeGanttLayerMode(layerMode)
  return {
    layerMode: mode,
    showPlanned: mode === 'both' || mode === 'planned',
    showActual: mode === 'both' || mode === 'actual',
    showDualLanes: mode === 'both',
  }
}
