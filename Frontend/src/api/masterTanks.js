import { apiDelete, apiGet, apiPost, apiPostForm, apiPut } from './client.js'

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '')

function authHeadersForDownload() {
  const headers = { Accept: 'text/csv' }
  const selectedPortId =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('jps_selected_port_id') : null
  if (selectedPortId) headers['X-Selected-Port-Id'] = selectedPortId
  const m =
    typeof document !== 'undefined'
      ? document.cookie.match(/(?:^|;\s*)jps_xsrf=([^;]*)/)
      : null
  if (m) headers['X-XSRF-TOKEN'] = decodeURIComponent(m[1])
  return headers
}

/** @returns {Promise<Array<{ id: string, portId: number, portName: string|null, code: string, name: string|null, description: string|null, sortOrder: number }>>} */
export function fetchMasterTanks(portId) {
  const q = encodeURIComponent(String(portId))
  return apiGet(`/master/tanks?portId=${q}`)
}

export function createMasterTank({ portId, code, name, description, sortOrder } = {}) {
  return apiPost('/master/tanks', {
    portId,
    code,
    name: name ?? null,
    description: description ?? null,
    sortOrder: sortOrder ?? null,
  })
}

export function updateMasterTank(id, { code, name, description, sortOrder } = {}) {
  return apiPut(`/master/tanks/${id}`, {
    code,
    name: name ?? null,
    description: description ?? null,
    sortOrder: sortOrder ?? null,
  })
}

export function deleteMasterTank(id) {
  return apiDelete(`/master/tanks/${id}`)
}

export async function importMasterTanksCsv(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiPostForm('/master/tanks/import-csv', fd)
}

export async function downloadMasterTanksTemplate() {
  const url = `${BASE}/master/tanks/import-template.csv`
  const res = await fetch(url, {
    credentials: 'include',
    headers: authHeadersForDownload(),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = res.statusText
    try {
      const j = JSON.parse(text)
      msg = j.error || j.message || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg || 'Failed to download template')
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'master-tanks-template.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
