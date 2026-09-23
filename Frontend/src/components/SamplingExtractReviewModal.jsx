import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultSamplingExtractChoices,
  samplingExtractChoicesAreEmpty,
} from '../utils/samplingExtractMerge'
import { translateExtractWarning } from '../utils/samplingExtractI18n'

const SOURCE_KEYS = {
  xlsx: 'extractReview.sourceXlsx',
  pdf_text: 'extractReview.sourcePdf',
  ocr_image: 'extractReview.sourceOcr',
}

/**
 * Review what was read from a sampling quality report before any of it reaches the form.
 *
 * Rendered as a nested overlay because the SAMPLING form itself already sits in a modal.
 */
export default function SamplingExtractReviewModal({
  open,
  proposal,
  fileName = '',
  source = '',
  onCancel,
  onApply,
}) {
  const { t } = useTranslation('loading')
  const [choices, setChoices] = useState(() => defaultSamplingExtractChoices(proposal))

  useEffect(() => {
    if (open) setChoices(defaultSamplingExtractChoices(proposal))
  }, [open, proposal])

  if (!open || !proposal) return null

  const {
    newRecords = [],
    conflicts = [],
    unchanged = [],
    warnings = [],
    qualityProposals = [],
    startTimeHint,
  } = proposal
  const foundCount = newRecords.length + conflicts.length + unchanged.length
  const nothingToApply = samplingExtractChoicesAreEmpty(proposal, choices)

  const setIncludeNew = (key, value) =>
    setChoices((c) => ({ ...c, includeNew: { ...c.includeNew, [key]: value } }))
  const setConflictMode = (key, mode) =>
    setChoices((c) => ({ ...c, conflictMode: { ...c.conflictMode, [key]: mode } }))
  const setQualityMode = (key, mode) =>
    setChoices((c) => ({ ...c, quality: { ...c.quality, [key]: mode } }))
  const allNewSelected = newRecords.length > 0 && newRecords.every((r) => choices.includeNew?.[r.key])

  const sourceLabel = SOURCE_KEYS[source] ? t(SOURCE_KEYS[source]) : ''
  const metaLead =
    foundCount > 0
      ? t('extractReview.foundRows', { count: foundCount })
      : t('extractReview.noRows')

  return (
    <div className="modal-overlay modal-overlay--nested" onClick={onCancel} aria-hidden="true">
      <div
        className="modal modal--wide sampling-extract-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sampling-extract-title"
      >
        <h2 id="sampling-extract-title" className="modal__title">
          {t('extractReview.title')}
        </h2>
        <p className="text-steel sampling-extract-modal__meta">
          {metaLead}
          {fileName ? t('extractReview.inFile', { fileName }) : ''}
          {sourceLabel ? ` (${sourceLabel})` : ''}. {t('extractReview.nothingUntilApply')}
        </p>

        {warnings.length > 0 && (
          <ul className="sampling-extract-modal__warnings" role="alert">
            {warnings.map((w) => (
              <li key={w.code}>{translateExtractWarning(t, w)}</li>
            ))}
          </ul>
        )}

        {qualityProposals.length > 0 && (
          <div className="loading-detail-activity-table-wrap">
            <h4 className="sampling-entry-block__title sampling-entry-block__title--table">
              {t('sampling.qualitySummaryTitle')}
            </h4>
            <table className="loading-detail-activity-table sampling-extract-modal__table">
              <thead>
                <tr>
                  <th>{t('extractReview.field')}</th>
                  <th>{t('extractReview.value')}</th>
                  <th>{t('extractReview.status')}</th>
                  <th>{t('extractReview.action')}</th>
                </tr>
              </thead>
              <tbody>
                {qualityProposals.map((item) => {
                  const mode = choices.quality?.[item.key] || 'keep'
                  const fieldLabel = t(`qualityField.${item.key}`)
                  if (item.status === 'unchanged') {
                    return (
                      <tr key={item.key} className="sampling-extract-modal__row--muted">
                        <td>{fieldLabel}</td>
                        <td className="sampling-cell--numeric">{item.extracted}</td>
                        <td>
                          <span className="sampling-extract-modal__badge">{t('extractReview.badgeUnchanged')}</span>
                        </td>
                        <td className="text-steel">{t('extractReview.noChange')}</td>
                      </tr>
                    )
                  }
                  if (item.status === 'conflict') {
                    return (
                      <tr key={item.key}>
                        <td>{fieldLabel}</td>
                        <td className="sampling-cell--numeric">
                          <span className="sampling-extract-modal__was">{item.current}</span>
                          {' → '}
                          {item.extracted}
                        </td>
                        <td>
                          <span className="sampling-extract-modal__badge sampling-extract-modal__badge--conflict">
                            {t('extractReview.badgeConflict')}
                          </span>
                        </td>
                        <td>
                          <div className="sampling-extract-modal__choice">
                            <label>
                              <input
                                type="radio"
                                name={`sampling-quality-${item.key}`}
                                checked={mode === 'keep'}
                                onChange={() => setQualityMode(item.key, 'keep')}
                              />
                              <span>{t('extractReview.keepCurrent')}</span>
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`sampling-quality-${item.key}`}
                                checked={mode === 'extracted'}
                                onChange={() => setQualityMode(item.key, 'extracted')}
                              />
                              <span>{t('extractReview.useExtracted')}</span>
                            </label>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={item.key}>
                      <td>{fieldLabel}</td>
                      <td className="sampling-cell--numeric">{item.extracted}</td>
                      <td>
                        <span className="sampling-extract-modal__badge sampling-extract-modal__badge--new">
                          {t('extractReview.badgeNew')}
                        </span>
                      </td>
                      <td>
                        <label className="sampling-extract-modal__include">
                          <input
                            type="checkbox"
                            checked={mode === 'extracted'}
                            onChange={(e) => setQualityMode(item.key, e.target.checked ? 'extracted' : 'keep')}
                            aria-label={t('extractReview.fillField', { field: fieldLabel })}
                          />
                          <span>{t('extractReview.include')}</span>
                        </label>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {foundCount === 0 ? (
          <p className="sampling-extract-modal__empty">{t('extractReview.emptyExtract')}</p>
        ) : (
          <div className="loading-detail-activity-table-wrap">
            <table className="loading-detail-activity-table sampling-extract-modal__table">
              <thead>
                <tr>
                  <th>{t('sampling.noPalka')}</th>
                  <th>{t('sampling.ffa')}</th>
                  <th>{t('sampling.moisture')}</th>
                  <th>{t('extractReview.status')}</th>
                  <th>
                    {newRecords.length > 0 ? (
                      <label className="sampling-extract-modal__select-all">
                        <input
                          type="checkbox"
                          checked={allNewSelected}
                          onChange={(e) => {
                            const next = {}
                            for (const r of newRecords) next[r.key] = e.target.checked
                            setChoices((c) => ({ ...c, includeNew: next }))
                          }}
                        />
                        <span>{t('extractReview.allNew')}</span>
                      </label>
                    ) : (
                      t('extractReview.action')
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {newRecords.map((row) => (
                  <tr key={`new-${row.key}`}>
                    <td>{row.noPalka}</td>
                    <td className="sampling-cell--numeric">{row.ffa}</td>
                    <td className="sampling-cell--numeric">{row.moisture}</td>
                    <td>
                      <span className="sampling-extract-modal__badge sampling-extract-modal__badge--new">
                        {t('extractReview.badgeNew')}
                      </span>
                    </td>
                    <td>
                      <label className="sampling-extract-modal__include">
                        <input
                          type="checkbox"
                          checked={Boolean(choices.includeNew?.[row.key])}
                          onChange={(e) => setIncludeNew(row.key, e.target.checked)}
                          aria-label={t('extractReview.includePalka', { palka: row.noPalka })}
                        />
                        <span>{t('extractReview.include')}</span>
                      </label>
                    </td>
                  </tr>
                ))}

                {conflicts.map((row) => {
                  const mode = choices.conflictMode?.[row.key] || 'keep'
                  return (
                    <tr key={`conflict-${row.key}`}>
                      <td>{row.noPalka}</td>
                      <td className="sampling-cell--numeric">
                        <span className="sampling-extract-modal__was">{row.current.ffa || '—'}</span>
                        {' → '}
                        {row.extracted.ffa}
                      </td>
                      <td className="sampling-cell--numeric">
                        <span className="sampling-extract-modal__was">
                          {row.current.moisture || '—'}
                        </span>
                        {' → '}
                        {row.extracted.moisture}
                      </td>
                      <td>
                        <span className="sampling-extract-modal__badge sampling-extract-modal__badge--conflict">
                          {t('extractReview.badgeConflict')}
                        </span>
                      </td>
                      <td>
                        <div className="sampling-extract-modal__choice">
                          <label>
                            <input
                              type="radio"
                              name={`sampling-conflict-${row.key}`}
                              checked={mode === 'keep'}
                              onChange={() => setConflictMode(row.key, 'keep')}
                            />
                            <span>{t('extractReview.keepCurrent')}</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`sampling-conflict-${row.key}`}
                              checked={mode === 'extracted'}
                              onChange={() => setConflictMode(row.key, 'extracted')}
                            />
                            <span>{t('extractReview.useExtracted')}</span>
                          </label>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {unchanged.map((row) => (
                  <tr key={`same-${row.key}`} className="sampling-extract-modal__row--muted">
                    <td>{row.noPalka}</td>
                    <td className="sampling-cell--numeric">{row.ffa}</td>
                    <td className="sampling-cell--numeric">{row.moisture}</td>
                    <td>
                      <span className="sampling-extract-modal__badge">{t('extractReview.badgeUnchanged')}</span>
                    </td>
                    <td className="text-steel">{t('extractReview.noChange')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {startTimeHint && (
          <div className="sampling-extract-modal__options">
            <label className="sampling-extract-modal__option">
              <input
                type="checkbox"
                checked={Boolean(choices.applyStartTime)}
                onChange={(e) => setChoices((c) => ({ ...c, applyStartTime: e.target.checked }))}
              />
              <span>
                {t('extractReview.startTimeOption', { value: startTimeHint.value.replace('T', ' ') })}
                {startTimeHint.currentValue
                  ? t('extractReview.startTimeReplace', { value: startTimeHint.currentValue.replace('T', ' ') })
                  : ''}
              </span>
            </label>
          </div>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            {t('extractReview.cancel')}
          </button>
          {(foundCount > 0 || qualityProposals.length > 0) && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onApply(choices)}
              disabled={nothingToApply}
              title={nothingToApply ? t('extractReview.applyDisabledTitle') : undefined}
            >
              {t('extractReview.apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
