import { apiGet, apiPost, apiPut } from './client.js'

/** @returns {Promise<Array<{ id: number, name: string, description: string | null, createdAt: string, updatedAt: string }>>} */
export function fetchPorts() {
  return apiGet('/ports')
}

export function createPort({ name, description }) {
  return apiPost('/ports', {
    name,
    description: description ?? null,
  })
}

export function updatePortApi(id, { name, description }) {
  return apiPut(`/ports/${id}`, {
    name,
    description: description ?? null,
  })
}
