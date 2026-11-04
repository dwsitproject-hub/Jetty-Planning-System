import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { applyCardExtract, samplingViewFromCard } from '../utils/samplingCommodity'
import { formatSamplingExtractApplyMessage } from '../utils/samplingExtractI18n'
import { useSamplingDocumentExtract } from './useSamplingDocumentExtract'

/**
 * Report-file extract for the QC entry screen: runs the OCR extract for one document and applies
 * the reviewed values either to the whole sampling record or to one commodity card.
 *
 * @param {{ entry: object, vesselName: string, notify: (message: {type: string, text: string}) => void }} args
 */
export function useQcSamplingExtractFlow({ entry, vesselName, notify }) {
  const { t } = useTranslation('qc')
  const { t: tLoading } = useTranslation('loading')
  const extract = useSamplingDocumentExtract()
  const commodityRef = useRef(null)
  const { sampling } = entry

  const findCard = (commodityId) =>
    commodityId == null ? null : (sampling.commodities || []).find((c) => Number(c.commodityId) === Number(commodityId))

  const requestExtract = (doc, index, commodityId = null) => {
    commodityRef.current = commodityId
    const card = findCard(commodityId)
    return extract.requestExtract({
      doc,
      docKey: commodityId == null ? `sampling-${index}` : `sampling-${commodityId}-${index}`,
      sampling: card ? samplingViewFromCard(sampling, card) : sampling,
      context: { vesselName },
      onError: (text) => notify({ type: 'error', text: text || t('documents.extractError') }),
    })
  }

  const applyExtract = (choices) => {
    const commodityId = commodityRef.current
    const card = findCard(commodityId)
    const result = extract.applyReview(choices, card ? samplingViewFromCard(sampling, card) : sampling)
    if (!result) return
    if (commodityId == null) entry.replaceSampling(result.nextSampling)
    else {
      entry.setField('startTime', result.nextSampling.startTime ?? sampling.startTime)
      entry.setField('endTime', result.nextSampling.endTime ?? sampling.endTime)
      entry.patchCommodity(commodityId, applyCardExtract(card, result.nextSampling))
    }
    notify({
      type: 'success',
      text: formatSamplingExtractApplyMessage(tLoading, result.summary, extract.fileName),
    })
  }

  return { extract, requestExtract, applyExtract }
}
