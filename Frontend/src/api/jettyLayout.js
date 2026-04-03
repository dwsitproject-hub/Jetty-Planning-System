import { apiGet, apiPut } from './client.js'

export function fetchJettyLayout() {
  return apiGet('/jetty-layout')
}

export function saveJettyLayout(columns) {
  return apiPut('/jetty-layout', { columns })
}

