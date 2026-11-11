import { fetchCustomClearanceQueue } from '../api/customClearance'
import { clearanceStatusOf } from '../utils/customClearance'
import { useFieldQueue } from './useFieldQueue'

const OPTIONS = { statusOf: clearanceStatusOf, ns: 'customClearance' }

/** Custom Clearance queue: berthed operations with their Post-Checking clearance state. */
export function useCustomClearanceQueue() {
  return useFieldQueue(fetchCustomClearanceQueue, OPTIONS)
}
