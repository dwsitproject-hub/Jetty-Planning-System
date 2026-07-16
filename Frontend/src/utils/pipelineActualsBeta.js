/** Vessel Pipeline — Actuals beta gate (staging / opt-in via VITE_ENABLE_PIPELINE_ACTUALS_BETA=true). */

const COLLAPSED_KEY = 'jps_dashboard_pipeline_actuals_collapsed'

export function isPipelineActualsBetaEnabled() {
  return import.meta.env.VITE_ENABLE_PIPELINE_ACTUALS_BETA === 'true'
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
