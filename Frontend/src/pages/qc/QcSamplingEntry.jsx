import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PurposeBadge from '../../components/PurposeBadge'
import QcEntryBanners from '../../components/qc/QcEntryBanners'
import QcReportSummary from '../../components/qc/QcReportSummary'
import QcSamplingDocuments from '../../components/qc/QcSamplingDocuments'
import QcSaveBar from '../../components/qc/QcSaveBar'
import QcStatusChip from '../../components/qc/QcStatusChip'
import SampleList from '../../components/qc/SampleList'
import SampleQuickAdd from '../../components/qc/SampleQuickAdd'
import SamplingCommodityCards from '../../components/sampling/SamplingCommodityCards'
import SamplingExtractReviewModal from '../../components/SamplingExtractReviewModal'
import SamplingSummaryStrip from '../../components/qc/SamplingSummaryStrip'
import { usePortScope } from '../../context/PortScopeContext'
import { useRbac } from '../../context/RbacContext'
import { usePortTanks } from '../../hooks/usePortTanks'
import { useQcSamplingEntry } from '../../hooks/useQcSamplingEntry'
import { useQcSamplingExtractFlow } from '../../hooks/useQcSamplingExtractFlow'
import { computeAverages } from '../../utils/qcSampling'
import { sampleRefKindFromPurpose } from '../../utils/samplingSampleRef'

function statusOf(sampling) {
  if (sampling.status === 'Done') return 'done'
  if (sampling.status || sampling.records.length > 0) return 'draft'
  return 'not_started'
}

/**
 * Sampling entry for one operation. Used full-screen on phones and inside the desktop workspace.
 *
 * @param {object} props
 * @param {number} props.operationId
 * @param {() => void} props.onBack leave the entry (phone: back to the queue; desktop: clear selection)
 * @param {(mode: 'draft'|'final') => void} [props.onSaved] called after any successful save
 * @param {() => void} [props.onFinalSaved] called after a final save; defaults to `onBack`
 * @param {boolean} [props.embedded] desktop pane: hides the back button
 */
export default function QcSamplingEntry({ operationId, onBack, onSaved, onFinalSaved, embedded = false }) {
  const { t } = useTranslation('qc')
  const { loading: rbacLoading, canView } = useRbac()
  const { selectedPortId } = usePortScope()
  const entry = useQcSamplingEntry(operationId)
  const [message, setMessage] = useState(null)
  const [summaryErrors, setSummaryErrors] = useState({})
  const [pendingTyped, setPendingTyped] = useState(false)

  const { sampling, header } = entry
  const { extract, requestExtract, applyExtract } = useQcSamplingExtractFlow({
    entry,
    vesselName: header?.vesselName,
    notify: setMessage,
  })
  const sampleRecords = useMemo(
    () =>
      (sampling.commodities || []).length > 0
        ? sampling.commodities.flatMap((card) => card.records || [])
        : sampling.records,
    [sampling.commodities, sampling.records]
  )
  const averages = useMemo(() => computeAverages(sampleRecords), [sampleRecords])
  const sampleRefKind = sampleRefKindFromPurpose(header?.purpose, header?.loadDischarge)
  const tanks = usePortTanks(selectedPortId, sampleRefKind === 'tank')
  const fail = (text) => setMessage({ type: 'error', text })

  if (rbacLoading || entry.loading) return <div className="operator-queue__status">{t('entry.loading')}</div>
  if (!canView('quality-control')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('entry.noAccess')}</p>
      </div>
    )
  }
  if (entry.error || !header) {
    const notFound = entry.status === 404
    return (
      <div className="operator-queue qc-entry">
        <p className="operator-error-banner" role="alert">
          {notFound ? t('entry.notFound') : entry.error || t('entry.loadFailed')}
        </p>
        <button type="button" className="op-btn op-btn--soft" onClick={onBack}>
          {t('entry.back')}
        </button>
      </div>
    )
  }

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
    onSaved?.(mode)
    if (mode === 'final') return (onFinalSaved ?? onBack)()
    setMessage({ type: 'success', text: t('save.successDraft') })
    return undefined
  }

  const hasCards = (sampling.commodities || []).length > 0

  return (
    <div className={`qc-entry${embedded ? ' qc-entry--embedded' : ''}`}>
      <div className="qc-entry__scroll">
        <header className="qc-entry__header">
          {embedded ? null : (
            <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={onBack}>
              ‹ {t('entry.back')}
            </button>
          )}
          <div className="qc-entry__title-row">
            <div className="qc-entry__identity">
              <h1 className="qc-entry__vessel">{header.vesselName}</h1>
              <PurposeBadge purpose={header.purpose} loadDischarge={header.loadDischarge} />
            </div>
            <QcStatusChip status={statusOf(sampling)} />
          </div>
          <p className="qc-entry__meta">
            {[header.shippingInstruction, header.commodityShortDisplay || header.commodityDisplay, header.jetty]
              .filter((v) => v && v !== '-')
              .join(' · ')}
          </p>
        </header>

        <SamplingSummaryStrip count={sampleRecords.length} avgFfa={averages.avgFfa} avgMoisture={averages.avgMoisture} />

        <QcEntryBanners
          entry={entry}
          message={message}
          onOverwrite={(mode) => handleSave(mode, { force: true })}
        />

        {hasCards ? (
          <div className="qc-entry__body qc-entry__body--cards">
            <QcReportSummary sampling={sampling} onChange={entry.setField} timesOnly />
            <SamplingCommodityCards
              commodities={sampling.commodities}
              legacyUnassigned={sampling.legacyUnassigned}
              variant="qc"
              sampleRefKind={sampleRefKind}
              tanks={tanks}
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
          </div>
        ) : (
          <div className="qc-entry__body">
            <div className="qc-entry__col qc-entry__col--main">
              <SampleQuickAdd
                records={sampling.records}
                onAdd={entry.addRecord}
                onPendingChange={setPendingTyped}
                sampleRefKind={sampleRefKind}
                tanks={tanks}
              />
              <SampleList
                records={sampling.records}
                onUpdate={entry.updateRecord}
                onRemove={entry.removeRecord}
                sampleRefKind={sampleRefKind}
                tanks={tanks}
              />
            </div>
            <div className="qc-entry__col qc-entry__col--side">
              <QcReportSummary sampling={sampling} errors={summaryErrors} computed={averages} onChange={entry.setField} />
              <QcSamplingDocuments
                documents={sampling.documents}
                extractingKey={extract.extractingKey}
                onAddFiles={entry.addFiles}
                onRemove={entry.removeDocument}
                onExtract={requestExtract}
              />
            </div>
          </div>
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
