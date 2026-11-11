import { fetchQcSamplingQueue } from '../api/qc'
import { samplingStatusOf } from '../utils/qcQueue'
import { useFieldQueue } from './useFieldQueue'

const OPTIONS = { statusOf: samplingStatusOf, ns: 'qc' }

/** QC Sampling queue: berthed operations with their Pre-Checking sampling state. */
export function useQcSamplingQueue() {
  return useFieldQueue(fetchQcSamplingQueue, OPTIONS)
}
