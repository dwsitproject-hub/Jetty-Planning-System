/** Query param used to carry port scope across windows/tabs (sessionStorage is per-tab). */
export const PORT_SCOPE_URL_PARAM = 'portId'

/** Query param to restore Allocation visualization tab after Full View return. */
export const ALLOCATION_VIZ_TAB_PARAM = 'vizTab'

/** @typedef {'schematic' | 'jettySchedule'} AllocationVizTab */

const VALID_ALLOCATION_VIZ_TABS = new Set(['schematic', 'jettySchedule'])

/**
 * @param {string|URLSearchParams|null|undefined} search
 * @returns {number|null}
 */
export function parsePortIdParam(search) {
  const raw =
    search instanceof URLSearchParams
      ? search.get(PORT_SCOPE_URL_PARAM)
      : new URLSearchParams(typeof search === 'string' ? search : '').get(PORT_SCOPE_URL_PARAM)
  const n = parseInt(String(raw ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {string|URLSearchParams|null|undefined} search
 * @returns {AllocationVizTab|null}
 */
export function parseVizTabParam(search) {
  const raw =
    search instanceof URLSearchParams
      ? search.get(ALLOCATION_VIZ_TAB_PARAM)
      : new URLSearchParams(typeof search === 'string' ? search : '').get(ALLOCATION_VIZ_TAB_PARAM)
  const v = String(raw ?? '').trim()
  return VALID_ALLOCATION_VIZ_TABS.has(v) ? /** @type {AllocationVizTab} */ (v) : null
}

/**
 * Map Full View popout route mode to Allocation page tab id.
 * @param {'schematic' | 'schedule'|string|null|undefined} mode
 * @returns {AllocationVizTab|null}
 */
export function popoutModeToVizTab(mode) {
  if (mode === 'schematic') return 'schematic'
  if (mode === 'schedule') return 'jettySchedule'
  return null
}

/**
 * @param {string} pathname
 * @param {{ portId?: number|null, vizTab?: AllocationVizTab|null }} [options]
 * @returns {string}
 */
export function withAllocationReturnParams(pathname, { portId, vizTab } = {}) {
  const params = new URLSearchParams()
  if (portId != null && Number.isFinite(Number(portId)) && Number(portId) > 0) {
    params.set(PORT_SCOPE_URL_PARAM, String(Number(portId)))
  }
  if (vizTab != null && VALID_ALLOCATION_VIZ_TABS.has(vizTab)) {
    params.set(ALLOCATION_VIZ_TAB_PARAM, vizTab)
  }
  const qs = params.toString()
  const base = pathname || '/'
  if (!qs) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${qs}`
}

/**
 * @param {string} pathname
 * @param {number|null|undefined} portId
 * @returns {string}
 */
export function withPortScopeParam(pathname, portId) {
  return withAllocationReturnParams(pathname, { portId })
}

/**
 * @param {URLSearchParams|string} search
 * @returns {string} search string without portId (may be empty)
 */
export function stripPortScopeParam(search) {
  const params =
    search instanceof URLSearchParams
      ? new URLSearchParams(search)
      : new URLSearchParams(typeof search === 'string' ? search : '')
  params.delete(PORT_SCOPE_URL_PARAM)
  const s = params.toString()
  return s ? `?${s}` : ''
}

/**
 * @param {URLSearchParams|string} search
 * @returns {string} search string without vizTab (may be empty)
 */
export function stripVizTabParam(search) {
  const params =
    search instanceof URLSearchParams
      ? new URLSearchParams(search)
      : new URLSearchParams(typeof search === 'string' ? search : '')
  params.delete(ALLOCATION_VIZ_TAB_PARAM)
  const s = params.toString()
  return s ? `?${s}` : ''
}
