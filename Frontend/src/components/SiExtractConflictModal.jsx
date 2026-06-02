import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * @param {{
 *   open: boolean,
 *   conflicts: Array<{ key: string, label: string, scope: string, current: string, proposed: string }>,
 *   warnings?: Array<{ key: string, label: string, extractedLabel: string }>,
 *   partialApply?: boolean,
 *   onCancel: () => void,
 *   onApply: (overwriteKeys: string[]) => void,
 * }} props
 */
export default function SiExtractConflictModal({
  open,
  conflicts,
  warnings = [],
  partialApply = false,
  onCancel,
  onApply,
}) {
  const { t } = useTranslation('shipmentPlan')
  const [choices, setChoices] = useState({})

  useEffect(() => {
    if (!open) return
    const init = {}
    for (const c of conflicts || []) {
      init[c.key] = 'keep'
    }
    setChoices(init)
  }, [open, conflicts])

  if (!open || !conflicts?.length) return null

  const setAll = (mode) => {
    const next = {}
    for (const c of conflicts) next[c.key] = mode
    setChoices(next)
  }

  const overwriteKeys = Object.entries(choices)
    .filter(([, v]) => v === 'ocr')
    .map(([k]) => k)

  return (
    <div className="modal-overlay" onClick={onCancel} aria-hidden="true">
        <div
          className="modal modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="si-extract-conflict-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="si-extract-conflict-title" className="modal__title">
            {t('siExtractConflictTitle')}
          </h2>
          <p
            className="text-steel"
            style={{
              fontSize: 'var(--font-size-small)',
              marginBottom: partialApply ? '0.5rem' : '1rem',
            }}
          >
            {t('siExtractConflictHint')}
          </p>
          {partialApply ? (
            <p
              className="text-steel"
              style={{ fontSize: 'var(--font-size-small)', marginBottom: '1rem', fontStyle: 'italic' }}
            >
              {t('siExtractConflictPartialHint')}
            </p>
          ) : null}
          {warnings.length > 0 ? (
            <div className="si-extract-conflict-warnings">
              <p className="si-extract-conflict-warnings__title">{t('siExtractConflictWarningsTitle')}</p>
              <p className="si-extract-conflict-warnings__hint">{t('siExtractConflictWarningsHint')}</p>
              <ul>
                {warnings.map((w) => (
                  <li key={w.key}>
                    {t('siExtractPanelUnmatchedRow', { label: w.label, value: w.extractedLabel })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setAll('ocr')}>
              {t('siExtractUseAllOcr')}
            </button>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setAll('keep')}>
              {t('siExtractKeepAllCurrent')}
            </button>
          </div>
          <table className="si-table" style={{ width: '100%', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('siExtractConflictField')}</th>
                <th style={{ textAlign: 'left' }}>{t('siExtractConflictCurrent')}</th>
                <th style={{ textAlign: 'left' }}>{t('siExtractConflictOcr')}</th>
                <th style={{ textAlign: 'left' }}>{t('siExtractConflictChoice')}</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td style={{ maxWidth: 160, wordBreak: 'break-word' }}>{c.current}</td>
                  <td style={{ maxWidth: 160, wordBreak: 'break-word' }}>{c.proposed}</td>
                  <td>
                    <label style={{ marginRight: '0.5rem' }}>
                      <input
                        type="radio"
                        name={`choice-${c.key}`}
                        checked={choices[c.key] === 'keep'}
                        onChange={() => setChoices((prev) => ({ ...prev, [c.key]: 'keep' }))}
                      />{' '}
                      {t('siExtractKeepCurrent')}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`choice-${c.key}`}
                        checked={choices[c.key] === 'ocr'}
                        onChange={() => setChoices((prev) => ({ ...prev, [c.key]: 'ocr' }))}
                      />{' '}
                      {t('siExtractUseOcr')}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--secondary" onClick={onCancel}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => onApply(overwriteKeys)}>
              {t('siExtractApplySelected')}
            </button>
          </div>
        </div>
    </div>
  )
}
