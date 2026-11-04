import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QcDecisionPill from '../qc/QcDecisionPill'
import { decisionTone } from '../../utils/samplingCommodity'
import { MAX_REMARK_CHARS, MAX_SAMPLING_METRIC_CHARS, MAX_SAMPLING_PALKA_FIELD_CHARS } from '../../constants/inputLimits'

const METRICS = ['ffaAverage', 'moistureAverage', 'dobi', 'iodineValue']

function newRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatMetric(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  return Number.isNaN(n) ? String(value) : n.toFixed(2)
}

function decisionAction(decision) {
  if (typeof decision !== 'string') return null
  if (decision.startsWith('approve')) return 'approve'
  if (decision.startsWith('reject')) return 'reject'
  if (decision === 'hold') return 'hold'
  return null
}

/**
 * One sampling card per commodity: documents, lab result, decision, optional remark.
 * `renderDocuments` stays with the page so upload and extract keep their existing controls.
 */
export default function SamplingCommodityCards({
  commodities,
  legacyUnassigned = null,
  readOnly = false,
  variant = 'hub',
  errors = {},
  onPatch,
  onAddRecord,
  onUpdateRecord,
  onDeleteRecord,
  renderDocuments,
}) {
  const { t } = useTranslation('loading')
  const { t: tQc } = useTranslation('qc')
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState({ commodityId: null, id: null, noPalka: '', ffa: '', moisture: '' })
  const qc = variant === 'qc'
  const primary = qc ? 'op-btn op-btn--primary op-btn--compact' : 'btn btn--primary btn--small'
  const secondary = qc ? 'op-btn op-btn--soft op-btn--compact' : 'btn btn--small btn--secondary'
  const inputClass = qc ? 'qc-input' : 'berthing-modal__input'

  const choose = (commodityId, action) => {
    if (action === 'hold') {
      onPatch?.(commodityId, { decision: 'hold' })
      return
    }
    setPending({ commodityId, action })
  }

  const confirmSpec = (spec) => {
    if (!pending) return
    onPatch?.(pending.commodityId, { decision: `${pending.action}_${spec}` })
    setPending(null)
  }

  const saveRecord = (card) => {
    if (form.commodityId != null && form.commodityId !== card.commodityId) return
    const noPalka = form.noPalka.trim()
    if (!noPalka) return
    const next = { noPalka, ffa: form.ffa.trim(), moisture: form.moisture.trim() }
    if (form.id) onUpdateRecord?.(card.commodityId, form.id, next)
    else onAddRecord?.(card.commodityId, { ...next, id: newRecordId() })
    setForm({ commodityId: null, id: null, noPalka: '', ffa: '', moisture: '' })
  }

  return (
    <div className="qc-commodity-list">
      {legacyUnassigned ? (
        <section className="qc-commodity-card qc-commodity-card--legacy">
          <h4 className="qc-commodity-card__title">{tQc('decision.legacyTitle')}</h4>
          <p className="qc-commodity-card__hint">{tQc('decision.legacyHint')}</p>
          <p>
            {t('sampling.qualitySummaryReadonly', {
              ffa: legacyUnassigned.ffaAverage || '—',
              moisture: legacyUnassigned.moistureAverage || '—',
              dobi: legacyUnassigned.dobi || '—',
              iodine: legacyUnassigned.iodineValue || '—',
            })}
          </p>
          <RecordTable records={legacyUnassigned.records} />
        </section>
      ) : null}
      {(commodities || []).map((card) => {
        const editing = form.commodityId === card.commodityId
        return (
          <section key={card.commodityId} className="qc-commodity-card">
            <header className="qc-commodity-card__head">
              <h4 className="qc-commodity-card__title">{card.shortName || card.name || card.commodityId}</h4>
              <QcDecisionPill decision={card.decision} remark={card.remark} />
            </header>
            {renderDocuments ? renderDocuments(card) : null}
            <div className={qc ? 'qc-field-grid' : 'sampling-entry-block__grid sampling-entry-block__grid--quality'}>
              {METRICS.map((field) => (
                <div key={field} className={qc ? 'qc-field' : 'berthing-modal__field'}>
                  <label className={qc ? 'qc-field__label' : 'berthing-modal__label'}>{t(`sampling.${field}`)}</label>
                  {readOnly ? (
                    <span>{card[field] || '—'}</span>
                  ) : (
                    <input
                      className={inputClass}
                      value={card[field] || ''}
                      maxLength={MAX_SAMPLING_METRIC_CHARS}
                      onChange={(e) => onPatch?.(card.commodityId, { [field]: e.target.value })}
                    />
                  )}
                  {errors[`${card.commodityId}.${field}`] ? (
                    <span className="qc-field__error">
                      {tQc(`report.error.${errors[`${card.commodityId}.${field}`]}`)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {readOnly ? (
              <RecordTable records={card.records} />
            ) : (
              <>
                <div className={qc ? 'qc-palka-row' : 'sampling-entry-block__grid sampling-entry-block__grid--palka'}>
                  <input
                    className={inputClass}
                    value={editing ? form.noPalka : ''}
                    placeholder={t('sampling.noPalka')}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    onChange={(e) => setForm((f) => ({ ...f, commodityId: card.commodityId, noPalka: e.target.value }))}
                  />
                  <input
                    className={inputClass}
                    value={editing ? form.ffa : ''}
                    placeholder={t('sampling.ffa')}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    onChange={(e) => setForm((f) => ({ ...f, commodityId: card.commodityId, ffa: e.target.value }))}
                  />
                  <input
                    className={inputClass}
                    value={editing ? form.moisture : ''}
                    placeholder={t('sampling.moisture')}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    onChange={(e) => setForm((f) => ({ ...f, commodityId: card.commodityId, moisture: e.target.value }))}
                  />
                  <button type="button" className={primary} onClick={() => saveRecord(card)}>
                    {form.id && editing ? t('sampling.update') : t('sampling.add')}
                  </button>
                </div>
                <RecordTable
                  records={card.records}
                  onEdit={(record) =>
                    setForm({
                      commodityId: card.commodityId,
                      id: record.id,
                      noPalka: record.noPalka || '',
                      ffa: record.ffa || '',
                      moisture: record.moisture || '',
                    })
                  }
                  onDelete={(id) => onDeleteRecord?.(card.commodityId, id)}
                />
              </>
            )}
            <div className="qc-commodity-card__decision">
              {readOnly ? (
                card.remark ? <p className="qc-commodity-card__remark">{card.remark}</p> : null
              ) : (
                <>
                  <div className="qc-commodity-card__actions" role="group" aria-label={tQc('decision.groupLabel')}>
                    {['approve', 'hold', 'reject'].map((action) => {
                      const selected = decisionAction(card.decision) === action
                      const tone = selected ? decisionTone(card.decision) : ''
                      const label =
                        selected && card.decision !== action ? tQc(`decision.${card.decision}`) : tQc(`decision.${action}`)
                      return (
                        <button
                          key={action}
                          type="button"
                          className={`qc-decision-btn qc-decision-btn--${action}${selected ? ` is-selected is-${tone}` : ''}`}
                          aria-pressed={selected}
                          onClick={() => choose(card.commodityId, action)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {pending?.commodityId === card.commodityId ? (
                    <div className="qc-spec-inline" role="group" aria-labelledby={`qc-spec-${card.commodityId}`}>
                      <p id={`qc-spec-${card.commodityId}`} className="qc-spec-inline__title">
                        {tQc('decision.popupTitle')}
                      </p>
                      <div className="qc-spec-inline__actions">
                        <button type="button" className={primary} onClick={() => confirmSpec('in')}>
                          {tQc(`decision.${pending.action}_in`)}
                        </button>
                        <button type="button" className={primary} onClick={() => confirmSpec('out')}>
                          {tQc(`decision.${pending.action}_out`)}
                        </button>
                        <button type="button" className={secondary} onClick={() => setPending(null)}>
                          {t('sampling.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <label className="qc-commodity-card__remark-field">
                    <span className="qc-commodity-card__remark-label">{tQc('decision.remarkPlaceholder')}</span>
                    <textarea
                      className="qc-commodity-card__remark-input"
                      rows={2}
                      maxLength={MAX_REMARK_CHARS}
                      value={card.remark || ''}
                      onChange={(e) => onPatch?.(card.commodityId, { remark: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function RecordTable({ records, onEdit, onDelete }) {
  const { t } = useTranslation('loading')
  const rows = records || []
  if (rows.length === 0 && !onEdit) return null
  return (
    <table className="loading-detail-activity-table sampling-recorded-table">
      <thead>
        <tr>
          <th>{t('sampling.noPalka')}</th>
          <th>{t('sampling.ffa')}</th>
          <th>{t('sampling.moisture')}</th>
          {onEdit ? <th>{t('sampling.actions')}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={onEdit ? 4 : 3}>{t('sampling.noRecordsYet')}</td>
          </tr>
        ) : (
          rows.map((record) => (
            <tr key={record.id}>
              <td>{record.noPalka || '—'}</td>
              <td>{formatMetric(record.ffa)}</td>
              <td>{formatMetric(record.moisture)}</td>
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
