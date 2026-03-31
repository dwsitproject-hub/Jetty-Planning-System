import { apiGet } from './client.js'

export function fetchSlaConfig() {
  return apiGet('/sla-config')
}

