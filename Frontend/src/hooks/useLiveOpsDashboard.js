/**
 * Live Ops dashboard tier: real-time / today KPIs, at-berth board, arrivals.
 */
export function useLiveOpsDashboard() {
  return {
    mode: 'live',
    pageKey: 'dashboard',
    titleKey: 'liveOpsDashboard',
  }
}
