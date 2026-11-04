import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QcReportSummary from '../../components/qc/QcReportSummary'
import QcSamplingDocuments from '../../components/qc/QcSamplingDocuments'
import QcSaveBar from '../../components/qc/QcSaveBar'
import QcStatusChip from '../../components/qc/QcStatusChip'
import SampleList from '../../components/qc/SampleList'
import SampleQuickAdd from '../../components/qc/SampleQuickAdd'
import SamplingCommodityCards from '../../components/sampling/SamplingCommodityCards'
import SamplingExtractReviewModal from '../../components/SamplingExtractReviewModal'
import SamplingSummaryStrip from '../../components/qc/SamplingSummaryStrip'
import { useRbac } from '../../context/RbacContext'
import { useQcSamplingEntry } from '../../hooks/useQcSamplingEntry'
import { useSamplingDocumentExtract } from '../../hooks/useSamplingDocumentExtract'
import { computeAverages } from '../../utils/qcSampling'
import { applyCardExtract, samplingViewFromCard } from '../../utils/samplingCommodity'
import { formatSamplingExtractApplyMessage } from '../../utils/samplingExtractI18n'

function statusOf(sampling) {
  if (sampling.status === 'Done') return 'done'
  if (sampling.status || sampling.records.length > 0) return 'draft'
  return 'not_started'
}

export default function QcSamplingEntry() {
  const { operationId: rawId } = useParams()
  const operationId = Number(rawId)
  const navigate = useNavigate()
  const { t } = useTranslation('qc')
  const { t: tLoading } = useTranslation('loading')
  const { loading: rbacLoading, canView } = useRbac()
  const entry = useQcSamplingEntry(operationId)
  const extract = useSamplingDocumentExtract()
  const extractCommodityRef = useRef(null)
  const [message, setMessage] = useState(null)
  const [summaryErrors, setSummaryErrors] = useState({})
  const [pendingTyped, setPendingTyped] = useState(false)

  const { sampling } = entry
  const sampleRecords = useMemo(
    () =>
      (sampling.commodities || []).length > 0
        ? sampling.commodities.flatMap((card) => card.records || [])
        : sampling.records,
    [sampling.commodities, sampling.records]
  )
  const averages = useMemo(() => computeAverages(sampleRecords), [sampleRecords])
  const backToQueue = () => navigate('/qc/sampling')
  const fail = (text) => setMessage({ type: 'error', text })

  if (rbacLoading || entry.loading) return <div className="operator-queue__status">{t('entry.loading')}</div>
  if (!canView('quality-control')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('entry.noAccess')}</p>
      </div>
    )
  }
  if (entry.error || !entry.header) {
    const notFound = entry.status === 404
    return (
      <div className="operator-queue qc-entry">
        <p className="operator-error-banner" role="alert">
          {notFound ? t('entry.notFound') : entry.error || t('entry.loadFailed')}
        </p>
        <button type="button" className="op-btn op-btn--soft" onClick={backToQueue}>
          {t('entry.back')}
        </button>
      </div>
    )
  }

  const { header } = entry

  const handleSave = async (mode, options) => {
    setMessage(null)
    setSummaryErrors({})
    if (pendingTyped) return fail(t('save.pendingSample'))
    const out = await entry.save(mode, options)
    if (out.conflict) return undefined
    if (out.errors) {
      setSummaryErrors(out.errors)
      return fail(t('save.fixErrors'))
    }
    if (!out.ok) return fail(out.message || t('save.error'))
    if (mode === 'final') return backToQueue()
    setMessage({ type: 'success', text: t('save.successDraft') })
    return undefined
  }

  const requestExtract = (doc, index, commodityId = null) => {
    extractCommodityRef.current = commodityId
    const card =
      commodityId == null
        ? null
        : (sampling.commodities || []).find((c) => Number(c.commodityId) === Number(commodityId))
    return extract.requestExtract({
      doc,
      docKey: commodityId == null ? `sampling-${index}` : `sampling-${commodityId}-${index}`,
      sampling: card ? samplingViewFromCard(sampling, card) : sampling,
      context: { vesselName: header.vesselName },
      onError: (text) => fail(text || t('documents.extractError')),
    })
  }

  const applyExtract = (choices) => {
    const commodityId = extractCommodityRef.current
    const card =
      commodityId == null
        ? null
        : (sampling.commodities || []).find((c) => Number(c.commodityId) === Number(commodityId))
    const result = extract.applyReview(choices, card ? samplingViewFromCard(sampling, card) : sampling)
    if (!result) return
    if (commodityId == null) entry.replaceSampling(result.nextSampling)
    else {
      entry.setField('startTime', result.nextSampling.startTime ?? sampling.startTime)
      entry.setField('endTime', result.nextSampling.endTime ?? sampling.endTime)
      entry.patchCommodity(commodityId, applyCardExtract(card, result.nextSampling))
    }
    setMessage({
      type: 'success',
      text: formatSamplingExtractApplyMessage(tLoading, result.summary, extract.fileName),
    })
  }

  const hasCards = (sampling.commodities || []).length > 0

  return (
    <div className="qc-entry">
      <div className="qc-entry__scroll">
        <header className="qc-entry__header">
          <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={backToQueue}>
            ‹ {t('entry.back')}
          </button>
          <div className="qc-entry__title-row">
            <h1 className="qc-entry__vessel">{header.vesselName}</h1>
            <QcStatusChip status={statusOf(sampling)} />
          </div>
          <p className="qc-entry__meta">
            {[header.shippingInstruction, header.commodityShortDisplay || header.commodityDisplay, header.jetty]
              .filter((v) => v && v !== '-')
              .join(' · ')}
          </p>
        </header>

        <SamplingSummaryStrip count={hasCards ? sampling.commodities.reduce((n, c) => n + (c.records || []).length, 0) : sampling.records.length} avgFfa={averages.avgFfa} avgMoisture={averages.avgMoisture} />

        {entry.restored ? (
          <div className="qc-banner" role="status">
            <span>{t('entry.restoredDraft')}</span>
            <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={entry.discardLocalDraft}>
              {t('entry.discardDraft')}
            </button>
          </div>
        ) : null}
        {entry.conflict ? (
          <div className="operator-error-banner qc-conflict" role="alert">
            <p>{t('conflict.message')}</p>
            <div className="qc-conflict__actions">
              <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={entry.reload}>
                {t('conflict.reload')}
              </button>
              <button
                type="button"
                className="op-btn op-btn--soft op-btn--compact"
                onClick={() => handleSave(entry.conflict.mode, { force: true })}
              >
                {t('conflict.overwrite')}
              </button>
            </div>
          </div>
        ) : null}
        {entry.recordError ? (
          <p className="operator-error-banner" role="alert">
            {t('save.recordError', { message: entry.recordError })}
          </p>
        ) : null}
        {message ? (
          <p className={message.type === 'error' ? 'operator-error-banner' : 'qc-banner qc-banner--ok'} role="status">
            {message.text}
          </p>
        ) : null}

        {hasCards ? (
          <>
            <QcReportSummary sampling={sampling} onChange={entry.setField} timesOnly />
            <SamplingCommodityCards
              commodities={sampling.commodities}
              legacyUnassigned={sampling.legacyUnassigned}
              variant="qc"
              errors={summaryErrors}
              onPatch={entry.patchCommodity}
              onAddRecord={(commodityId, record) => entry.addRecord(record, commodityId)}
              onUpdateRecord={(commodityId, id, patch) => entry.updateRecord(id, patch, commodityId)}
              onDeleteRecord={(commodityId, id) => entry.removeRecord(id, commodityId)}
              renderDocuments={(card) => (
                <QcSamplingDocuments
                  documents={card.documents || []}
                  extractingKey={extract.extractingKey}
                  onAddFiles={(files) => entry.addFiles(files, card.commodityId)}
                  onRemove={(index) => entry.removeDocument(index, card.commodityId)}
                  keyPrefix={`sampling-${card.commodityId}`}
                  onExtract={(doc, index) => requestExtract(doc, index, card.commodityId)}
                />
              )}
            />
          </>
        ) : (
          <>
        <SampleQuickAdd records={sampling.records} onAdd={entry.addRecord} onPendingChange={setPendingTyped} />
        <SampleList records={sampling.records} onUpdate={entry.updateRecord} onRemove={entry.removeRecord} />
        <QcReportSummary sampling={sampling} errors={summaryErrors} computed={averages} onChange={entry.setField} />
        <QcSamplingDocuments
          documents={sampling.documents}
          extractingKey={extract.extractingKey}
          onAddFiles={entry.addFiles}
          onRemove={entry.removeDocument}
          onExtract={requestExtract}
        />
          </>
        )}
      </div>

      <QcSaveBar
        saving={entry.saving}
        dirty={entry.dirty}
        lastSavedAt={sampling.lastSavedAt}
        localSavedAt={entry.localSavedAt}
        onSave={handleSave}
      />

      <SamplingExtractReviewModal
        open={extract.reviewOpen}
        proposal={extract.proposal}
        fileName={extract.fileName}
        source={extract.source}
        onCancel={extract.cancelReview}
        onApply={applyExtract}
      />
    </div>
  )
}
