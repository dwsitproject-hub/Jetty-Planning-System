import { apiGet, apiPost, apiPatch } from './client.js'

const SYNC_PATH = {
  'trade-terms': '/si-lookups/trade-terms/datahub/sync',
  commodities: '/si-lookups/commodities/datahub/sync',
}

export function createSiDataHubSyncApi(apiType) {
  const base = SYNC_PATH[apiType]
  if (!base) return null

  return {
    fetchSyncRuns: ({ limit = 10 } = {}) => apiGet(`${base}/runs?limit=${limit}`),
    startSyncRun: () => apiPost(`${base}/runs`, {}, 120000),
    fetchSyncRun: (runId) => apiGet(`${base}/runs/${runId}`),
    applySyncRun: (runId, itemIds) =>
      apiPost(`${base}/runs/${runId}/apply`, { itemIds: Array.isArray(itemIds) ? itemIds : [] }, 120000),
    discardSyncRun: (runId) => apiPost(`${base}/runs/${runId}/discard`, {}),
  }
}

export const DATAHUB_SI_FIELD_LABELS = {
  'trade-terms': {
    code: 'Term (short name)',
    long_name: 'Long name',
    description: 'Description',
  },
  commodities: {
    name: 'Commodity name',
    short_name: 'Short name',
    commodity_type: 'Type',
    kl_to_mt_factor: 'KL→MT factor',
    default_metric_id: 'Default unit (metric id)',
    hs_code: 'HS code',
  },
}

export const DATAHUB_SI_ENTITY_META = {
  'trade-terms': {
    entityKind: 'incoterm',
    recordNoun: 'terms',
    newHint: 'Terms not yet in the JPS master.',
  },
  commodities: {
    entityKind: 'commodity',
    recordNoun: 'commodities',
    newHint: 'Commodities not yet in the JPS master.',
  },
}
