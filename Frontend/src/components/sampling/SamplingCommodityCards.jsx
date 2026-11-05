import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QcDecisionPill from '../qc/QcDecisionPill'
import { decisionTone } from '../../utils/samplingCommodity'
import { metricValue, paramLabel, patchCardMetric, reportParams, sampleParams, specOf, valueCodesOf } from '../../utils/qcSpec'
import { matchTankId, tankCodeOf } from '../../utils/samplingSampleRef'
import { MAX_REMARK_CHARS, MAX_SAMPLING_METRIC_CHARS, MAX_SAMPLING_PALKA_FIELD_CHARS } from '../../constants/inputLimits'
import SampleRefField from './SampleRefField'
import SamplingRecordTable from './SamplingRecordTable'

function newRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function decisionAction(decision) {
  if (typeof decision !== 'string') return null
  if (decision.startsWith('approve')) return 'approve'
  if (decision.startsWith('reject')) return 'reject'
  if (decision === 'hold') return 'hold'
  return null
}

function emptySampleForm(card) {
  const values = {}
  for (const code of sampleParams(specOf(card)).flatMap(valueCodesOf)) values[code] = ''
  return { commodityId: card.commodityId, id: null, noPalka: '', tankId: '', ...values }
}

/**
 * One sampling card per commodity. Fields come from the QC spec template (or the CPO-like fallback).
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
  sampleRefKind = 'palka',
  tanks = [],
}) {
  const { t, i18n } = useTranslation('loading')
  const { t: tQc } = useTranslation('qc')
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState({ commodityId: null, id: null, noPalka: '', tankId: '' })
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

  const saveRecord = (card) => {
    if (form.commodityId != null && form.commodityId !== card.commodityId) return
    const next = {}
    if (sampleRefKind === 'tank') {
      if (!String(form.tankId || '').trim()) return
      next.tankId = Number(form.tankId) || form.tankId
      next.noPalka = tankCodeOf(tanks, form.tankId) || form.noPalka.trim()
    } else {
      const noPalka = form.noPalka.trim()
      if (!noPalka) return
      next.noPalka = noPalka
    }
    for (const code of sampleParams(specOf(card)).flatMap(valueCodesOf)) next[code] = String(form[code] || '').trim()
    if (form.id) onUpdateRecord?.(card.commodityId, form.id, next)
    else onAddRecord?.(card.commodityId, { ...next, id: newRecordId() })
    setForm(emptySampleForm(card))
  }

  return (
    <div className="qc-commodity-list">
      {legacyUnassigned ? (
        <section className="qc-commodity-card qc-commodity-card--legacy">
          <h4 className="qc-commodity-card__title">{tQc('decision.legacyTitle')}</h4>
          <p className="qc-commodity-card__hint">{tQc('decision.legacyHint')}</p>
          <SamplingRecordTable records={legacyUnassigned.records} />
        </section>
      ) : null}
      {(commodities || []).map((card) => {
        const spec = specOf(card)
        const report = reportParams(spec)
        const sample = sampleParams(spec)
        const editing = form.commodityId === card.commodityId
        return (
          <section key={card.commodityId} className="qc-commodity-card">
            <header className="qc-commodity-card__head">
              <h4 className="qc-commodity-card__title">{card.shortName || card.name || card.commodityId}</h4>
              <QcDecisionPill decision={card.decision} remark={card.remark} />
            </header>
            {renderDocuments ? renderDocuments(card) : null}
            <div className={qc ? 'qc-field-grid' : 'sampling-entry-block__grid sampling-entry-block__grid--quality'}>
              {report.flatMap((param) =>
                valueCodesOf(param).map((code) => (
                  <div key={code} className={qc ? 'qc-field' : 'berthing-modal__field'}>
                    <label className={qc ? 'qc-field__label' : 'berthing-modal__label'}>
                      {param.kind === 'color_pair'
                        ? `${paramLabel(param, i18n.language)} ${code === 'color_red' ? 'R' : 'Y'}`
                        : paramLabel(param, i18n.language)}
                    </label>
                    {readOnly ? (
                      <span>{metricValue(card, code) || '—'}</span>
                    ) : (
                      <input
                        className={inputClass}
                        value={metricValue(card, code) || ''}
                        maxLength={MAX_SAMPLING_METRIC_CHARS}
                        onChange={(e) => onPatch?.(card.commodityId, patchCardMetric(card, code, e.target.value))}
                      />
                    )}
                    {errors[`${card.commodityId}.${code}`] ? (
                      <span className="qc-field__error">{tQc(`report.error.${errors[`${card.commodityId}.${code}`]}`)}</span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {sample.length === 0 ? null : readOnly ? (
              <SamplingRecordTable card={card} records={card.records} sampleRefKind={sampleRefKind} />
            ) : (
              <>
                <div
                  className={
                    qc
                      ? 'qc-palka-row'
                      : `sampling-entry-block__grid sampling-entry-block__grid--palka${sampleRefKind === 'tank' ? ' sampling-entry-block__grid--tank' : ''}`
                  }
                >
                  <SampleRefField
                    kind={sampleRefKind}
                    tanks={tanks}
                    tankId={editing ? form.tankId : ''}
                    noPalka={editing ? form.noPalka : ''}
                    inputClass={inputClass}
                    placeholder={t(sampleRefKind === 'tank' ? 'sampling.placeholderTank' : 'sampling.noPalka')}
                    searchPlaceholder={t('sampling.searchTank')}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    onChange={(next) =>
                      setForm((f) => ({ ...emptySampleForm(card), ...f, commodityId: card.commodityId, ...next }))
                    }
                  />
                  {sample.flatMap((param) =>
                    valueCodesOf(param).map((code) => (
                      <input
                        key={code}
                        className={inputClass}
                        value={editing ? form[code] || '' : ''}
                        placeholder={paramLabel(param, i18n.language)}
                        maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                        onChange={(e) =>
                          setForm((f) => ({ ...emptySampleForm(card), ...f, commodityId: card.commodityId, [code]: e.target.value }))
                        }
                      />
                    ))
                  )}
                  <button type="button" className={primary} onClick={() => saveRecord(card)}>
                    {form.id && editing ? t('sampling.update') : t('sampling.add')}
                  </button>
                </div>
                <SamplingRecordTable
                  card={card}
                  records={card.records}
                  sampleRefKind={sampleRefKind}
                  onEdit={(record) =>
                    setForm({
                      ...emptySampleForm(card),
                      id: record.id,
                      noPalka: record.noPalka || '',
                      tankId: matchTankId(record, tanks),
                      ...Object.fromEntries(sample.flatMap(valueCodesOf).map((code) => [code, metricValue(record, code)])),
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
                    <div className="qc-spec-inline" role="group">
                      <p className="qc-spec-inline__title">{tQc('decision.popupTitle')}</p>
                      <div className="qc-spec-inline__actions">
                        <button type="button" className={primary} onClick={() => { onPatch?.(pending.commodityId, { decision: `${pending.action}_in` }); setPending(null) }}>
                          {tQc(`decision.${pending.action}_in`)}
                        </button>
                        <button type="button" className={primary} onClick={() => { onPatch?.(pending.commodityId, { decision: `${pending.action}_out` }); setPending(null) }}>
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
