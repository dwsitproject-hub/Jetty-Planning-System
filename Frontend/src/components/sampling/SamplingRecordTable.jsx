import { useTranslation } from 'react-i18next'
import { metricValue, paramLabel, sampleParams, specOf, valueCodesOf } from '../../utils/qcSpec'

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
              <th key={code}>{code.startsWith('color_') ? (code === 'color_red' ? 'R' : 'Y') : paramLabel(param, i18n.language)}</th>
            ))
          )}
          {onEdit ? <th>{t('sampling.actions')}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={(onEdit ? 2 : 1) + codes.length}>{t('sampling.noRecordsYet')}</td>
          </tr>
        ) : (
          rows.map((record) => (
            <tr key={record.id}>
              <td>{record.noPalka || '—'}</td>
              {codes.map((code) => (
                <td key={code}>{formatMetric(metricValue(record, code))}</td>
              ))}
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
