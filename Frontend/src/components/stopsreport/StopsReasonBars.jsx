import { useTranslation } from 'react-i18next'
import { CATEGORY_COLORS, CATEGORY_ORDER, reportReasonLabel } from '../../utils/noFlowReportView.js'
import '../../styles/stops-report.css'

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d })

/** Hours by reason as horizontal bars coloured by who caused the stop, with a colour legend. */
export default function StopsReasonBars({ reasons, limit = 10 }) {
  const { t, i18n } = useTranslation('pages')
  const top = reasons.slice(0, limit)
  const max = top[0]?.hours || 1
  const used = CATEGORY_ORDER.filter((c) => reasons.some((r) => r.category === c))
  return (
    <div className="stops-bars">
      {top.map((r) => (
        <div key={r.code} className="stops-bars__row">
          <span className="stops-bars__label" title={reportReasonLabel(r, i18n.language)}>{reportReasonLabel(r, i18n.language)}</span>
          <div className="stops-bars__track">
            <div
              className="stops-bars__fill"
              style={{ width: `${Math.max((r.hours / max) * 100, 1.5)}%`, background: CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other }}
            />
          </div>
          <span className="stops-bars__value">{fmt(r.hours)} h · {fmt(r.pct, 0)}%</span>
        </div>
      ))}
      {reasons.length > limit ? <p className="stops-bars__more">{t('stopsReportMoreReasons', { count: reasons.length - limit })}</p> : null}
      <div className="stops-bars__legend">
        {used.map((c) => (
          <span key={c}><i style={{ background: CATEGORY_COLORS[c] }} />{t(`noFlowCategory_${c}`)}</span>
        ))}
      </div>
    </div>
  )
}
