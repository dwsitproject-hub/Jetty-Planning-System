import { useEffect, useState } from 'react'
import {
  defaultSamplingExtractChoices,
  samplingExtractChoicesAreEmpty,
} from '../utils/samplingExtractMerge'

const SOURCE_LABELS = {
  xlsx: 'Excel file',
  pdf_text: 'PDF text',
  ocr_image: 'Scanned image',
}

/**
 * Review what was read from a sampling quality report before any of it reaches the form.
 *
 * Rendered as a nested overlay because the SAMPLING form itself already sits in a modal.
 *
 * @param {{
 *   open: boolean,
 *   proposal: object|null,
 *   fileName?: string,
 *   source?: string,
 *   onCancel: () => void,
 *   onApply: (choices: object) => void,
 * }} props
 */
export default function SamplingExtractReviewModal({
  open,
  proposal,
  fileName = '',
  source = '',
  onCancel,
  onApply,
}) {
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
          Review extracted sampling data
        </h2>
        <p className="text-steel sampling-extract-modal__meta">
          {foundCount > 0
            ? `Found ${foundCount} palka row${foundCount === 1 ? '' : 's'}`
            : 'No palka rows detected'}
          {fileName ? ` in ${fileName}` : ''}
          {SOURCE_LABELS[source] ? ` (${SOURCE_LABELS[source]})` : ''}. Nothing is changed until you
          press Apply.
        </p>

        {warnings.length > 0 && (
          <ul className="sampling-extract-modal__warnings" role="alert">
            {warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        )}

        {qualityProposals.length > 0 && (
          <div className="loading-detail-activity-table-wrap">
            <h4 className="sampling-entry-block__title sampling-entry-block__title--table">
              Quality Summary (as stated on the report)
            </h4>
            <table className="loading-detail-activity-table sampling-extract-modal__table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {qualityProposals.map((item) => {
                  const mode = choices.quality?.[item.key] || 'keep'
                  if (item.status === 'unchanged') {
                    return (
                      <tr key={item.key} className="sampling-extract-modal__row--muted">
                        <td>{item.label}</td>
                        <td className="sampling-cell--numeric">{item.extracted}</td>
                        <td>
                          <span className="sampling-extract-modal__badge">Already matches</span>
                        </td>
                        <td className="text-steel">No change</td>
                      </tr>
                    )
                  }
                  if (item.status === 'conflict') {
                    return (
                      <tr key={item.key}>
                        <td>{item.label}</td>
                        <td className="sampling-cell--numeric">
                          <span className="sampling-extract-modal__was">{item.current}</span>
                          {' → '}
                          {item.extracted}
                        </td>
                        <td>
                          <span className="sampling-extract-modal__badge sampling-extract-modal__badge--conflict">
                            Already entered
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
                              <span>Keep current</span>
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`sampling-quality-${item.key}`}
                                checked={mode === 'extracted'}
                                onChange={() => setQualityMode(item.key, 'extracted')}
                              />
                              <span>Use extracted</span>
                            </label>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={item.key}>
                      <td>{item.label}</td>
                      <td className="sampling-cell--numeric">{item.extracted}</td>
                      <td>
                        <span className="sampling-extract-modal__badge sampling-extract-modal__badge--new">
                          New
                        </span>
                      </td>
                      <td>
                        <label className="sampling-extract-modal__include">
                          <input
                            type="checkbox"
                            checked={mode === 'extracted'}
                            onChange={(e) => setQualityMode(item.key, e.target.checked ? 'extracted' : 'keep')}
                            aria-label={`Fill ${item.label}`}
                          />
                          <span>Include</span>
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
          <p className="sampling-extract-modal__empty">
            No palka FFA / Moisture values could be read from this file. Enter them manually, or try
            uploading the original Excel file or a clearer scan.
          </p>
        ) : (
          <div className="loading-detail-activity-table-wrap">
            <table className="loading-detail-activity-table sampling-extract-modal__table">
              <thead>
                <tr>
                  <th>No. Palka</th>
                  <th>(%), FFA</th>
                  <th>(%), Moisture</th>
                  <th>Status</th>
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
                        <span>All new</span>
                      </label>
                    ) : (
                      'Action'
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
                        New
                      </span>
                    </td>
                    <td>
                      <label className="sampling-extract-modal__include">
                        <input
                          type="checkbox"
                          checked={Boolean(choices.includeNew?.[row.key])}
                          onChange={(e) => setIncludeNew(row.key, e.target.checked)}
                          aria-label={`Include palka ${row.noPalka}`}
                        />
                        <span>Include</span>
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
                          Already entered
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
                            <span>Keep current</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`sampling-conflict-${row.key}`}
                              checked={mode === 'extracted'}
                              onChange={() => setConflictMode(row.key, 'extracted')}
                            />
                            <span>Use extracted</span>
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
                      <span className="sampling-extract-modal__badge">Already matches</span>
                    </td>
                    <td className="text-steel">No change</td>
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
                Set Start Time to the document date ({startTimeHint.value.replace('T', ' ')})
                {startTimeHint.currentValue
                  ? ` — replaces ${startTimeHint.currentValue.replace('T', ' ')}`
                  : ''}
              </span>
            </label>
          </div>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          {/* A report can yield only summary values when no palka label reads, and those are still worth applying. */}
          {(foundCount > 0 || qualityProposals.length > 0) && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onApply(choices)}
              disabled={nothingToApply}
              title={nothingToApply ? 'Select at least one row or option' : undefined}
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
