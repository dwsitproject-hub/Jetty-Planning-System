import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Persistent OCR result summary inside the shipment plan / SI form modal. */
export default function SiExtractResultPanel({ report, onDismiss, defaultExpanded = false }) {
  const { t } = useTranslation('shipmentPlan')
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!report) return null

  const appliedCount = report.applied?.length ?? 0
  const warningCount = report.unmatchedDropdowns?.length ?? 0

  let summary
  if (report.status === 'sparse') {
    summary = t('siExtractPanelSummarySparse', { fileName: report.fileName || '—' })
  } else if (report.status === 'warning') {
    summary = t('siExtractPanelSummaryWarning', {
      count: appliedCount,
      fileName: report.fileName || '—',
      warningCount,
    })
  } else {
    summary = t('siExtractPanelSummarySuccess', {
      count: appliedCount || report.detectedCount || 0,
      fileName: report.fileName || '—',
    })
  }

  const variantClass =
    report.status === 'sparse'
      ? 'si-extract-panel--sparse'
      : report.status === 'warning'
        ? 'si-extract-panel--warning'
        : 'si-extract-panel--success'

  const scopeLabel = (scope) =>
    scope === 'plan' ? t('siExtractPanelScopePlan') : t('siExtractPanelScopeSi')

  return (
    <div className={`si-extract-panel ${variantClass}`} role="region" aria-live="polite" aria-label={summary}>
      <div className="si-extract-panel__header">
        <p className="si-extract-panel__summary">{summary}</p>
        <div className="si-extract-panel__actions">
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('siExtractPanelCollapse') : t('siExtractPanelExpand')}
          </button>
          <button type="button" className="btn btn--secondary btn--small" onClick={onDismiss}>
            {t('siExtractPanelDismiss')}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="si-extract-panel__body">
          <Section title={t('siExtractPanelSectionApplied')}>
            {(report.applied || []).length > 0 ? (
              <ul className="si-extract-panel__list">
                {report.applied.map((row) => (
                  <li key={`${row.scope}-${row.key}`}>
                    <span className="si-extract-panel__field">{row.label}</span>
                    <span className="si-extract-panel__meta">{scopeLabel(row.scope)}</span>
                    <span className="si-extract-panel__value" title={row.value}>
                      {row.value}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="si-extract-panel__empty">{t('siExtractPanelAppliedEmpty')}</p>
            )}
          </Section>

          <Section title={t('siExtractPanelSectionPendingConflicts')}>
            {(report.pendingConflicts || []).length > 0 ? (
              <ul className="si-extract-panel__list">
                {report.pendingConflicts.map((c) => (
                  <li key={c.key}>
                    <span className="si-extract-panel__field">{c.label}</span>
                    <span className="si-extract-panel__value" title={c.proposed}>
                      {t('siExtractPanelPendingConflictRow', {
                        current: c.current || '—',
                        proposed: c.proposed || '—',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="si-extract-panel__empty">{t('siExtractPanelPendingConflictsEmpty')}</p>
            )}
          </Section>

          <Section title={t('siExtractPanelSectionUnmatched')}>
            {(report.unmatchedDropdowns || []).length > 0 ? (
              <ul className="si-extract-panel__list">
                {report.unmatchedDropdowns.map((w) => (
                  <li key={w.key}>
                    {t('siExtractPanelUnmatchedRow', { label: w.label, value: w.extractedLabel })}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="si-extract-panel__empty">{t('siExtractPanelUnmatchedEmpty')}</p>
            )}
          </Section>

          <Section title={t('siExtractPanelSectionNotDetected')}>
            {(report.notDetected || []).length > 0 ? (
              <ul className="si-extract-panel__list si-extract-panel__list--tags">
                {report.notDetected.map((row) => (
                  <li key={row.key}>
                    <span className="si-extract-panel__tag">{row.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="si-extract-panel__empty">{t('siExtractPanelNotDetectedEmpty')}</p>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <details className="si-extract-panel__section" open>
      <summary className="si-extract-panel__section-title">{title}</summary>
      <div className="si-extract-panel__section-body">{children}</div>
    </details>
  )
}
