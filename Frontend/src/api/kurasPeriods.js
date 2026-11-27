import { apiPost } from './client.js'

/** Start kuras on another palka while the open cargo entry keeps pumping (sets the entry to Mixed). */
export function startKurasPeriod(operationId, { palka, startAt }) {
  return apiPost(`/operations/${operationId}/cargo-kuras-periods`, { palka, ...(startAt ? { startAt } : {}) })
}

/** Stop a running kuras period now; the quantity cleaned is optional. */
export function stopKurasPeriod(operationId, periodId, { qty } = {}) {
  return apiPost(`/operations/${operationId}/cargo-kuras-periods/${periodId}/stop`, qty != null && qty !== '' ? { qty: Number(qty) } : {})
}
