import { evaluatePreCheckingComplete } from './loadingHubProcessStagesFromApi'
import { getScheduleEntryTimeZone } from './scheduleDateTime'
import i18n from '../i18n'

export function getOperatorPrecheckBlockedMsg() {
  return i18n.t('operator:precheck.blocked')
}

export async function canOpenOperatorExecution(row, scheduleIana = getScheduleEntryTimeZone()) {
  const operationId = row?.operationId ?? row?.id
  if (operationId == null) return { allowed: false, reason: 'Invalid operation' }
  try {
    const complete = await evaluatePreCheckingComplete(operationId, row?.purpose, scheduleIana)
    return complete ? { allowed: true } : { allowed: false, reason: getOperatorPrecheckBlockedMsg() }
  } catch (e) {
    return { allowed: false, reason: e?.message || i18n.t('operator:toast.verifyPrecheckFailed') }
  }
}
