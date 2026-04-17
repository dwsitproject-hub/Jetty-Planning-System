import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchShippingInstruction } from '../api/shippingInstructions'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import '../styles/modal.css'
import '../styles/si-detail-modal.css'

function emptyToDash(value) {
  if (value == null) return '—'
  const text = String(value).trim()
  return text ? text : '—'
}

function formatDateOnly(value) {
  if (!value) return '—'
  const text = String(value).trim()
  if (!text) return '—'
  return text.length >= 10 ? text.slice(0, 10) : text
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
    etb: row.etbDateTime || row.etb || null,
    tb: row.tbDateTime || row.tb || null,
    etc: row.estimatedCompletionDateTime || row.estimationOfCompletion || row.etcDateTime || null,
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
    shipper: row.shipperName || '—',
    loadingPort: row.loadingPortName || '—',
    surveyor: row.surveyorName || '—',
    agent: row.agentName || '—',
    note: row.note || '—',
    approver: row.approverNameSnapshot || row.approverDisplayName || '—',
    approvalDate: row.approvedAt || null,
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
  }
}

export default function SiDetailModal({ isOpen, siId, onClose }) {
  const { t } = useTranslation('shippingInstruction')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [row, setRow] = useState(null)

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

  const detail = useMemo(() => normalizeSiDetail(row), [row])
  if (!isOpen) return null

  return (
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
              <dt>{t('dtEtaFrom')}</dt><dd>{formatDateOnly(detail.etaFrom)}</dd>
              <dt>{t('dtEtaTo')}</dt><dd>{formatDateOnly(detail.etaTo)}</dd>
              <dt>{t('dtEtb')}</dt><dd>{formatDateTimeDisplay(detail.etb)}</dd>
              <dt>{t('dtTb')}</dt><dd>{formatDateTimeDisplay(detail.tb)}</dd>
              <dt>{t('dtEstimatedCompletion')}</dt><dd>{formatDateTimeDisplay(detail.etc)}</dd>
              <dt>{t('dtTerm')}</dt><dd>{emptyToDash(detail.term)}</dd>
              <dt>{t('dtVoyage')}</dt><dd>{emptyToDash(detail.voyage)}</dd>
              <dt>{t('dtDestination')}</dt><dd>{emptyToDash(detail.destination)}</dd>
              <dt>{t('dtFreightTerms')}</dt><dd>{emptyToDash(detail.freightTerms)}</dd>
              <dt>{t('dtDocumentDate')}</dt><dd>{formatDateOnly(detail.documentDate)}</dd>
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
  )
}
