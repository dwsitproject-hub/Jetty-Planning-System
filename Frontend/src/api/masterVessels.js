import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client.js'

/** Vessel master replica held in JPS (synced from DataHub). */
export function fetchMasterVessels({ search, activeOnly } = {}) {
  const params = new URLSearchParams()
  if (search && String(search).trim()) params.set('search', String(search).trim())
  if (activeOnly) params.set('activeOnly', '1')
  const q = params.toString() ? `?${params.toString()}` : ''
  return apiGet(`/master/vessels${q}`)
}

export function fetchMasterVesselById(id) {
  return apiGet(`/master/vessels/${id}`)
}

function vesselBody({
  vesselName,
  vesselImo,
  vesselMmsi,
  vesselCodeSap,
  vesselCapacityMt,
  vesselGrossTonnage,
  vesselDraft,
  vesselLengthOverall,
  vesselType,
  heater,
  typeLambung,
  typeCharter,
  hubCode,
  isActive,
} = {}) {
  const trimmed = (v) => {
    if (v == null) return null
    const s = String(v).trim()
    return s === '' ? null : s
  }
  const numeric = (v) => {
    if (v == null || String(v).trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    vesselName: trimmed(vesselName),
    vesselImo: trimmed(vesselImo),
    vesselMmsi: trimmed(vesselMmsi),
    vesselCodeSap: trimmed(vesselCodeSap),
    vesselCapacityMt: numeric(vesselCapacityMt),
    vesselGrossTonnage: numeric(vesselGrossTonnage),
    vesselDraft: numeric(vesselDraft),
    vesselLengthOverall: trimmed(vesselLengthOverall),
    vesselType: trimmed(vesselType),
    heater: heater == null ? null : heater === true,
    typeLambung: trimmed(typeLambung),
    typeCharter: trimmed(typeCharter),
    hubCode: trimmed(hubCode),
    isActive: isActive !== false,
  }
}

export function createMasterVessel(input) {
  return apiPost('/master/vessels', vesselBody(input))
}

export function updateMasterVesselApi(id, input) {
  return apiPut(`/master/vessels/${id}`, vesselBody(input))
}

export function deleteMasterVessel(id) {
  return apiDelete(`/master/vessels/${id}`)
}

/** Recent sync runs, newest first. */
export function fetchSyncRuns({ limit = 10 } = {}) {
  return apiGet(`/master/vessels/sync/runs?limit=${limit}`)
}

/** Pull the hub and stage a diff. Writes nothing to the master yet. */
export function startSyncRun() {
  // The hub pull can take a while on a cold cache, so allow more than the default.
  return apiPost('/master/vessels/sync/runs', {}, 120000)
}

export function fetchSyncRun(runId) {
  return apiGet(`/master/vessels/sync/runs/${runId}`)
}

export function saveSyncDecisions(runId, decisions) {
  return apiPatch(`/master/vessels/sync/runs/${runId}/items`, { decisions })
}

/** Apply the staged run; itemIds is the final approved selection. */
export function applySyncRun(runId, itemIds) {
  return apiPost(
    `/master/vessels/sync/runs/${runId}/apply`,
    { itemIds: Array.isArray(itemIds) ? itemIds : [] },
    120000
  )
}

export function discardSyncRun(runId) {
  return apiPost(`/master/vessels/sync/runs/${runId}/discard`, {})
}
