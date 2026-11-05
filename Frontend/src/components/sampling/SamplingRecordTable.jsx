import { useTranslation } from 'react-i18next'
import { metricValue, paramFieldLabel, paramUnit, sampleParams, specOf, valueCodesOf } from '../../utils/qcSpec'

function formatMetric(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  return Number.isNaN(n) ? String(value) : n.toFixed(2)
}

export default function SamplingRecordTable({ card, records, onEdit, onDelete, sampleRefKind = 'palka' }) {
  const { t, i18n } = useTranslation('loading')
  const params = sampleParams(specOf(card))
  const codes = params.flatMap(valueCodesOf)
  const rows = records || []
  if (rows.length === 0 && !onEdit) return null
  return (
    <table className="loading-detail-activity-table sampling-recorded-table">
      <thead>
        <tr>
          <th>{t(sampleRefKind === 'tank' ? 'sampling.tank' : 'sampling.noPalka')}</th>
          {params.map((param) =>
            valueCodesOf(param).map((code) => (
              <th key={code}>
                <span className="sampling-col-name">{paramFieldLabel(param, code, i18n.language)}</span>
                {paramUnit(param) ? <span className="sampling-col-unit">{paramUnit(param)}</span> : null}
              </th>
            ))
          )}
          <th>{t('sampling.remark')}</th>
          {onEdit ? <th>{t('sampling.actions')}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={(onEdit ? 3 : 2) + codes.length}>{t('sampling.noRecordsYet')}</td>
          </tr>
        ) : (
          rows.map((record) => (
            <tr key={record.id}>
              <td>{record.noPalka || '—'}</td>
              {codes.map((code) => (
                <td key={code}>{formatMetric(metricValue(record, code))}</td>
              ))}
              <td className="sampling-record-remark" title={record.remark || undefined}>
                {record.remark || '—'}
              </td>
              {onEdit ? (
                <td>
                  <button type="button" className="btn btn--small btn--edit" onClick={() => onEdit(record)}>
                    {t('sampling.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--delete"
                    onClick={() => {
                      if (window.confirm(t('sampling.delete'))) onDelete?.(record.id)
                    }}
                  >
                    {t('sampling.delete')}
                  </button>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
