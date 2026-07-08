import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchShippingInstruction } from '../api/shippingInstructions'
import { fetchOperation } from '../api/operations'
import { formatDateDisplay, formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  loadHubProcessStagesFromApi,
  mapOperationStatusToClearanceI18nKey,
  normalizeHubPurpose,
} from '../utils/loadingHubProcessStagesFromApi'
import { getScheduleEntryTimeZone } from '../utils/scheduleDateTime.js'
import OperationActivityTimeline from './OperationActivityTimeline'
import '../styles/modal.css'
import '../styles/si-detail-modal.css'

function emptyToDash(value) {
  if (value == null) return '—'
  const text = String(value).trim()
  return text ? text : '—'
}

function normalizeSiDetail(row) {
  if (!row) return null
  return {
    siNo: row.referenceNumber || (row.id != null ? `SI-${row.id}` : '—'),
    status: row.status || '—',
    source: row.source || ((row.purpose || '').toLowerCase() === 'unloading' ? 'External' : 'Internal'),
    vessel: row.vesselName || '—',
    purpose: row.purpose || '—',
    jetty: row.preferredJettyName || row.jetty || '—',
    etaFrom: row.etaFrom || null,
    etaTo: row.etaTo || null,
    eta: row.etaDateTime || row.eta || null,
    etb: row.etbDateTime || row.etb || null,
    tb: row.tbDateTime || row.tb || null,
    etc: row.estimatedCompletionDateTime || row.estimationOfCompletion || row.etcDateTime || null,
    operationsCompleted:
      row.operationsCompletedDateTime || row.operationsCompletedAt || row.operationsCompletedTime || null,
    actualCompletion: row.actualCompletionDateTime || row.actualCompletionTime || null,
    term: row.tradeTermCode || row.term || '—',
    voyage: row.voyageNo || '—',
    destination: row.destinationText || '—',
    freightTerms: row.freightTerms || '—',
    documentDate: row.documentDate || null,
    blClause: row.billOfLadingClause || '—',
    blSplit: row.blSplitText || '—',
    consignee: row.consigneeText || '—',
    notifyParty: row.notifyPartyText || '—',
    blIndicated: row.blIndicated || '—',
    shipper: row.shipperNames || '—',
    loadingPort: row.loadingPortName || '—',
    surveyor: row.surveyorName || '—',
    agent: row.agentName || '—',
    note: row.note || '—',
    approver: row.approverNameSnapshot || row.approverDisplayName || '—',
    approvalDate: row.approvedAt || null,
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
    operationId: row.operationId != null ? row.operationId : null,
    operationStatus: row.operationStatus ?? null,
    purposeRaw: row.purpose,
  }
}

function phaseStatusClass(countUnknown, done, total) {
  if (countUnknown) return 'not-started'
  const d = Number(done) || 0
  const n = Number(total) || 0
  if (n > 0 && d >= n) return 'done'
  if (d > 0) return 'in-progress'
  return 'not-started'
}

export default function SiDetailModal({ isOpen, siId, onClose }) {
  const scheduleEntryTz = getScheduleEntryTimeZone()
  const { t } = useTranslation('shippingInstruction')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [row, setRow] = useState(null)

  const [opSummaryLoading, setOpSummaryLoading] = useState(false)
  const [opSummaryError, setOpSummaryError] = useState('')
  const [hubStages, setHubStages] = useState(null)
  const [apiOpSnapshot, setApiOpSnapshot] = useState(null)
  const [opFetchFailed, setOpFetchFailed] = useState(false)

  const [executionsLogOpen, setExecutionsLogOpen] = useState(false)
  const [activityLogRefresh, setActivityLogRefresh] = useState(0)

  useEffect(() => {
    setExecutionsLogOpen(false)
  }, [isOpen, siId])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (executionsLogOpen) {
        e.preventDefault()
        setExecutionsLogOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, executionsLogOpen])

  const bumpActivityLogRefresh = useCallback(() => {
    setActivityLogRefresh((x) => x + 1)
  }, [])

  useEffect(() => {
    if (!isOpen || !siId) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchShippingInstruction(siId)
      .then((data) => {
        if (cancelled) return
        setRow(data || null)
      })
      .catch((err) => {
        if (cancelled) return
        setRow(null)
        setError(err?.message || t('siDetailError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, siId, t])

  useEffect(() => {
    if (!isOpen || !row?.operationId) {
      setOpSummaryLoading(false)
      setOpSummaryError('')
      setHubStages(null)
      setApiOpSnapshot(null)
      setOpFetchFailed(false)
      return
    }
    let cancelled = false
    const opId = row.operationId
    setOpSummaryLoading(true)
    setOpSummaryError('')
    setHubStages(null)
    setApiOpSnapshot(null)
    setOpFetchFailed(false)

    fetchOperation(opId)
      .then(async (op) => {
        if (cancelled) return
        setApiOpSnapshot(op || null)
        setOpFetchFailed(false)
        const purpose = normalizeHubPurpose(row.purposeRaw ?? op?.purpose)
        try {
          const { stages } = await loadHubProcessStagesFromApi({
            operationId: opId,
            purpose,
            commodityType: op?.commodityType,
            operationNorTenderedAt: op?.norTenderedAt ?? null,
            operationNorAcceptedAt: op?.norAcceptedAt ?? null,
            operationDemurrageLiabilityFromAt: op?.demurrageLiabilityFromAt ?? null,
            scheduleIana: scheduleEntryTz,
          })
          if (!cancelled) setHubStages(stages)
        } catch (e) {
          if (!cancelled) {
            setHubStages(null)
            setOpSummaryError(e?.message || t('operationSummaryPhasesError'))
          }
        }
        if (!cancelled) setOpSummaryLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setApiOpSnapshot(null)
        setOpFetchFailed(true)
        setHubStages(null)
        setOpSummaryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, row?.operationId, row?.purposeRaw, scheduleEntryTz, t])

  const detail = useMemo(() => normalizeSiDetail(row), [row])

  const clearanceStatusRaw = apiOpSnapshot?.status ?? row?.operationStatus ?? null
  const clearanceI18nSuffix = mapOperationStatusToClearanceI18nKey(clearanceStatusRaw)
  const clearanceLabel = row?.operationId
    ? t(`clearanceStatus_${clearanceI18nSuffix}`)
    : t('operationSummaryNoOperation')

  const renderPhaseStateText = (countUnknown, done, total) => {
    if (countUnknown) return t('operationSummaryStatePending')
    const d = Number(done) || 0
    const n = Number(total) || 0
    if (n > 0 && d >= n) return t('operationSummaryStateComplete')
    if (d > 0) return t('operationSummaryStateInProgress')
    return t('operationSummaryStateNotStarted')
  }

  const renderPhaseProgress = (countUnknown, done, total) => {
    if (countUnknown) return t('operationSummaryUnknownComplete', { total })
    return t('operationSummaryComplete', { done, total })
  }

  const hubBasePath = useMemo(() => {
    const p = normalizeHubPurpose(row?.purposeRaw ?? apiOpSnapshot?.purpose ?? '')
    return p === 'Unloading' ? '/unloading' : '/loading'
  }, [row?.purposeRaw, apiOpSnapshot?.purpose])

  if (!isOpen) return null

  const hubVesselId = detail?.operationId != null ? `op-${detail.operationId}` : null

  return (
    <>
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide si-detail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="si-detail-modal-title"
      >
        <h2 id="si-detail-modal-title" className="modal__title">
          {t('siDetailModalTitle')}
        </h2>
        {loading ? (
          <p className="text-steel">{t('siDetailLoading')}</p>
        ) : error ? (
          <p style={{ color: '#c00' }}>{error}</p>
        ) : detail ? (
          <div className="si-detail-modal__content">
            <dl className="si-detail-modal__grid">
              <dt>{t('dtSiNo')}</dt><dd>{emptyToDash(detail.siNo)}</dd>
              <dt>{t('dtStatus')}</dt><dd>{emptyToDash(detail.status)}</dd>
              <dt>{t('dtSource')}</dt><dd>{emptyToDash(detail.source)}</dd>
              <dt>{t('dtVessel')}</dt><dd>{emptyToDash(detail.vessel)}</dd>
              <dt>{t('dtPurpose')}</dt><dd>{emptyToDash(detail.purpose)}</dd>
              <dt>{t('dtJetty')}</dt><dd>{emptyToDash(detail.jetty)}</dd>
              <dt>{t('dtEtaFrom')}</dt><dd>{formatDateDisplay(detail.etaFrom)}</dd>
              <dt>{t('dtEtaTo')}</dt><dd>{formatDateDisplay(detail.etaTo)}</dd>
              <dt>{t('dtEta')}</dt><dd>{formatDateTimeDisplay(detail.eta)}</dd>
              <dt>{t('dtEtb')}</dt><dd>{formatDateTimeDisplay(detail.etb)}</dd>
              <dt>{t('dtTb')}</dt><dd>{formatDateTimeDisplay(detail.tb)}</dd>
              <dt>{t('dtEstimatedCompletion')}</dt><dd>{formatDateTimeDisplay(detail.etc)}</dd>
              <dt>{t('dtOperationsCompleted')}</dt><dd>{formatDateTimeDisplay(detail.operationsCompleted)}</dd>
              <dt>{t('dtActualCompletion')}</dt><dd>{formatDateTimeDisplay(detail.actualCompletion)}</dd>
              <dt>{t('dtTerm')}</dt><dd>{emptyToDash(detail.term)}</dd>
              <dt>{t('dtVoyage')}</dt><dd>{emptyToDash(detail.voyage)}</dd>
              <dt>{t('dtDestination')}</dt><dd>{emptyToDash(detail.destination)}</dd>
              <dt>{t('dtFreightTerms')}</dt><dd>{emptyToDash(detail.freightTerms)}</dd>
              <dt>{t('dtDocumentDate')}</dt><dd>{formatDateDisplay(detail.documentDate)}</dd>
              <dt>{t('dtBlClause')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.blClause)}</dd>
              <dt>{t('dtBlSplit')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.blSplit)}</dd>
              <dt>{t('dtConsignee')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.consignee)}</dd>
              <dt>{t('dtNotifyParty')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.notifyParty)}</dd>
              <dt>{t('dtBlIndicated')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.blIndicated)}</dd>
              <dt>{t('dtShipper')}</dt><dd>{emptyToDash(detail.shipper)}</dd>
              <dt>{t('dtLoadingPort')}</dt><dd>{emptyToDash(detail.loadingPort)}</dd>
              <dt>{t('dtSurveyor')}</dt><dd>{emptyToDash(detail.surveyor)}</dd>
              <dt>{t('dtAgent')}</dt><dd>{emptyToDash(detail.agent)}</dd>
              <dt>{t('dtNote')}</dt><dd className="si-detail-modal__pre">{emptyToDash(detail.note)}</dd>
              <dt>{t('dtApprover')}</dt><dd>{emptyToDash(detail.approver)}</dd>
              <dt>{t('dtApprovalDate')}</dt><dd>{formatDateTimeDisplay(detail.approvalDate)}</dd>
            </dl>

            <section className="si-detail-modal__operation-summary" aria-label={t('operationSummaryPhasesTitle')}>
              <h4 className="si-detail-modal__subhead">{t('operationSummaryPhasesTitle')}</h4>
              {!detail.operationId ? (
                <p className="text-steel si-detail-modal__muted">{t('operationSummaryNoOperation')}</p>
              ) : opSummaryLoading ? (
                <p className="text-steel si-detail-modal__muted">{t('operationSummaryLoadingPhases')}</p>
              ) : hubStages ? (
                <div className="table-wrap si-detail-modal__table-wrap">
                  <table className="si-detail-modal__summary-table">
                    <thead>
                      <tr>
                        <th>{t('operationSummaryPhaseCol')}</th>
                        <th>{t('operationSummaryProgressCol')}</th>
                        <th>{t('operationSummaryStateCol')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: 'pre', label: t('operationSummaryPhasePre'), s: hubStages.pre },
                        { key: 'op', label: t('operationSummaryPhaseOperational'), s: hubStages.operational },
                        { key: 'post', label: t('operationSummaryPhasePost'), s: hubStages.post },
                      ].map(({ key, label, s }) => {
                        const stClass = phaseStatusClass(s.countUnknown, s.done, s.total)
                        return (
                          <tr key={key}>
                            <td>{label}</td>
                            <td>{renderPhaseProgress(s.countUnknown, s.done, s.total)}</td>
                            <td>
                              <span className="si-detail-modal__state-cell">
                                <span
                                  className={`si-detail-modal__stage-dot si-detail-modal__stage-dot--${stClass}`}
                                  aria-hidden
                                />
                                {renderPhaseStateText(s.countUnknown, s.done, s.total)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : opFetchFailed || opSummaryError ? (
                <p className="si-detail-modal__inline-error">{opSummaryError || t('operationSummaryPhasesError')}</p>
              ) : (
                <p className="text-steel si-detail-modal__muted">{t('operationSummaryNoOperation')}</p>
              )}

              {detail.operationId ? (
                <p className="si-detail-modal__executions-log-link-wrap">
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => setExecutionsLogOpen(true)}
                  >
                    {t('executionsLogLink')}
                  </button>
                </p>
              ) : null}

              <h4 className="si-detail-modal__subhead si-detail-modal__subhead--spaced">{t('operationSummaryClearanceTitle')}</h4>
              {!detail.operationId ? (
                <p className="text-steel si-detail-modal__muted">{t('operationSummaryNoOperation')}</p>
              ) : opSummaryLoading ? (
                <p className="text-steel si-detail-modal__muted">{t('operationSummaryLoadingPhases')}</p>
              ) : (
                <div className="table-wrap si-detail-modal__table-wrap">
                  <table className="si-detail-modal__summary-table">
                    <tbody>
                      <tr>
                        <th scope="row">{t('operationSummaryClearanceStatus')}</th>
                        <td>{clearanceLabel}</td>
                      </tr>
                      {apiOpSnapshot?.castOffAt ? (
                        <tr>
                          <th scope="row">{t('operationSummaryCastOff')}</th>
                          <td>{formatDateTimeDisplay(apiOpSnapshot.castOffAt)}</td>
                        </tr>
                      ) : null}
                      {apiOpSnapshot?.sailedAt ? (
                        <tr>
                          <th scope="row">{t('operationSummarySailedAt')}</th>
                          <td>{formatDateTimeDisplay(apiOpSnapshot.sailedAt)}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <h4 className="si-detail-modal__subhead">{t('breakdownTitle')}</h4>
            {detail.breakdown.length === 0 ? (
              <p className="text-steel">{t('breakdownEmpty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('breakdownCommodity')}</th>
                      <th>{t('breakdownQty')}</th>
                      <th>{t('breakdownUnit')}</th>
                      <th>{t('breakdownContract')}</th>
                      <th>{t('breakdownPo')}</th>
                      <th>{t('breakdownSo')}</th>
                      <th>{t('breakdownRemarks')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.breakdown.map((item) => (
                      <tr key={item.id || `${item.commodityName}-${item.contractNo}-${item.poNo}`}>
                        <td>{emptyToDash(item.commodityName)}</td>
                        <td>{item.qty == null ? '—' : Number(item.qty).toLocaleString()}</td>
                        <td>{emptyToDash(item.metricCode)}</td>
                        <td>{emptyToDash(item.contractNo)}</td>
                        <td>{emptyToDash(item.poNo)}</td>
                        <td>{emptyToDash(item.soNo)}</td>
                        <td>{emptyToDash(item.remarks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-steel">{t('siDetailNotFound')}</p>
        )}

        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>

    {executionsLogOpen && detail?.operationId != null ? (
      <div
        className="modal-overlay si-detail-modal__nested-overlay"
        onClick={() => setExecutionsLogOpen(false)}
        role="presentation"
      >
        <div
          className="modal modal--wide si-detail-modal si-detail-modal--nested"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="si-detail-executions-log-title"
        >
          <h2 id="si-detail-executions-log-title" className="modal__title">
            {t('executionsLogModalTitle')}
          </h2>
          <div className="si-detail-modal__nested-body">
            <OperationActivityTimeline
              operationId={detail.operationId}
              refreshToken={activityLogRefresh}
              vesselId={hubVesselId}
              basePath={hubBasePath}
              onActivityLogRefresh={bumpActivityLogRefresh}
              className="si-detail-modal__timeline"
            />
          </div>
          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={() => setExecutionsLogOpen(false)}>
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}
