import { evaluatePreCheckingComplete } from './loadingHubProcessStagesFromApi'
import { getScheduleEntryTimeZone } from './scheduleDateTime'

export const OPERATOR_PRECHECK_BLOCKED_MSG =
  'This vessel is still in Pre-Checking. Please check with your Supervisor before starting operational activities.'

export async function canOpenOperatorExecution(row, scheduleIana = getScheduleEntryTimeZone()) {
  const operationId = row?.operationId ?? row?.id
  if (operationId == null) return { allowed: false, reason: 'Invalid operation' }
  try {
    const complete = await evaluatePreCheckingComplete(operationId, row?.purpose, scheduleIana)
    return complete ? { allowed: true } : { allowed: false, reason: OPERATOR_PRECHECK_BLOCKED_MSG }
  } catch (e) {
    return { allowed: false, reason: e?.message || 'Could not verify Pre-Checking status' }
  }
}
