import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export const fetchQcSpecTemplates = () => apiGet('/qc-specs').then((out) => out?.templates || [])
export const fetchQcSpecParameters = () => apiGet('/qc-specs/parameters').then((out) => out?.parameters || [])
export const fetchQcSpecCommodities = () => apiGet('/qc-specs/commodities').then((out) => out?.commodities || [])

export const createQcSpecTemplate = (body) => apiPost('/qc-specs', body)
export const updateQcSpecTemplate = (id, body) => apiPatch(`/qc-specs/${id}`, body)
export const deleteQcSpecTemplate = (id) => apiDelete(`/qc-specs/${id}`)
export const createQcSpecParameter = (body) => apiPost('/qc-specs/parameters', body)
export const updateQcSpecParameter = (id, body) => apiPatch(`/qc-specs/parameters/${id}`, body)
