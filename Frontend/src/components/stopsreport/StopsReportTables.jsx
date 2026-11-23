import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { buildVesselReasonMatrix, reportReasonLabel } from '../../utils/noFlowReportView.js'
import '../../styles/stops-report.css'

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d })

/** Vessel by reason hours: the fleet table of the Tj Pura discharge report. */
export function VesselReasonMatrix({ report }) {
  const { t, i18n } = useTranslation('pages')
  const m = useMemo(() => buildVesselReasonMatrix(report, i18n.language), [report, i18n.language])
  return (
    <div className="table-wrap">
      <table className="data-table stops-matrix">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('stopsReportColVessel')}</th>
            {m.columns.map((c) => <th key={c.code} className="stops-matrix__num" title={c.label}>{c.label}</th>)}
            <th className="stops-matrix__num">{t('stopsReportColTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r, i) => (
            <tr key={r.operationId}>
              <td>{i + 1}</td>
              <td><b>{r.vessel || '—'}</b><br /><span className="text-steel">{r.jetty || '—'}</span></td>
              {m.columns.map((c) => <td key={c.code} className="stops-matrix__num">{r.cells[c.code] ? fmt(r.cells[c.code], 2) : ''}</td>)}
              <td className="stops-matrix__num"><b>{fmt(r.total, 2)}</b></td>
            </tr>
          ))}
          <tr className="stops-matrix__total">
            <td />
            <td><b>{t('stopsReportColTotal')}</b></td>
            {m.columns.map((c) => <td key={c.code} className="stops-matrix__num"><b>{fmt(c.total, 2)}</b></td>)}
            <td className="stops-matrix__num"><b>{fmt(m.grandTotal, 2)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const PHASE_KEYS = {
  before: 'noFlowPhase_before',
  after: 'noFlowPhase_after',
  during: 'stopsReportPhaseDuring',
  mixed: 'stopsReportPhaseMixed',
}

/** Every stop of the period, newest first. */
export function StopsList({ stops }) {
  const { t, i18n } = useTranslation('pages')
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('stopsReportColVessel')}</th>
            <th>{t('stopsReportColTime')}</th>
            <th className="stops-matrix__num">{t('stopsReportColHours')}</th>
            <th>{t('stopsReportColWhen')}</th>
            <th>{t('stopsReportColReason')}</th>
            <th>{t('noFlowColFoundBy')}</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((s) => (
            <tr key={s.id}>
              <td><b>{s.vessel || '—'}</b><br /><span className="text-steel">{s.jetty || '—'}</span></td>
              <td>{formatDateTimeDisplay(s.startedAt)} – {s.endedAt ? formatDateTimeDisplay(s.endedAt) : t('noFlowInProgress')}</td>
              <td className="stops-matrix__num">{fmt(s.hours, 2)}</td>
              <td>{t(PHASE_KEYS[s.phase] || PHASE_KEYS.during)}</td>
              <td>
                {reportReasonLabel(s, i18n.language)}
                {s.note ? <div className="text-steel">{s.note}</div> : null}
              </td>
              <td><span className="no-flow__pill">{t(`noFlowSourceShort_${s.source}`)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
