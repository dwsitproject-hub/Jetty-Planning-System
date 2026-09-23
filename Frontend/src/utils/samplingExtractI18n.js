/**
 * i18n helpers for sampling document extract UI (toast + review modal warnings).
 * Merge logic stays English-free in the UI layer via these formatters.
 */

/** @param {import('i18next').TFunction} t loading namespace */
export function translateExtractWarning(t, warning) {
  if (!warning?.code) return warning?.message || ''
  return t(`extractWarning.${warning.code}`, warning.params || {})
}

/** @param {import('i18next').TFunction} t loading namespace */
export function formatSamplingExtractApplyMessage(t, summary, fileName = '') {
  const bits = []
  if (summary?.added) {
    bits.push(t('extractApply.added', { count: summary.added }))
  }
  if (summary?.updated) {
    bits.push(t('extractApply.updated', { count: summary.updated }))
  }
  if (summary?.startTimeSet) {
    bits.push(t('extractApply.startTimeSet'))
  }
  if (summary?.qualityFilled) {
    bits.push(t('extractApply.qualityFilled', { count: summary.qualityFilled }))
  }
  if (!bits.length) {
    return t('extractApply.none')
  }
  const from = fileName ? t('extractApply.fromFile', { fileName }) : ''
  return `${bits.join(', ')}${from}.`
}
