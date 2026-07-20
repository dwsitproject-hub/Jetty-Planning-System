/** Vessel Pipeline config — Actuals is default; legacy plan pipeline is opt-in. */

const COLLAPSED_KEY = 'jps_dashboard_pipeline_actuals_collapsed'

/** Show legacy plan-based pipeline when VITE_USE_LEGACY_VESSEL_PIPELINE=true (default off). */
export function isLegacyVesselPipelineEnabled() {
  return import.meta.env.VITE_USE_LEGACY_VESSEL_PIPELINE === 'true'
}

export function readPipelineActualsCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writePipelineActualsCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}
