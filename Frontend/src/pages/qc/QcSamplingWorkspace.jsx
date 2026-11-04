import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QcQueuePanel from '../../components/qc/QcQueuePanel'
import { useRbac } from '../../context/RbacContext'
import { useQcSamplingQueue } from '../../hooks/useQcSamplingQueue'
import QcSamplingEntry from './QcSamplingEntry'

/**
 * Desktop QC Sampling: queue on the left, sampling entry for the selected vessel on the right.
 * The selection lives in the URL (`/qc/sampling/:operationId`), so it survives reloads and resizes.
 * Rendered with the `operator-mobile` class so the shared QC and button styles apply inside `Layout`.
 */
export default function QcSamplingWorkspace({ operationId }) {
  const navigate = useNavigate()
  const { t } = useTranslation('qc')
  const { loading: rbacLoading, canView } = useRbac()
  const queue = useQcSamplingQueue()

  if (rbacLoading) return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  if (!canView('quality-control')) {
    return <p className="operator-error-banner">{t('queue.noAccess')}</p>
  }

  const clearSelection = () => navigate('/qc/sampling')

  return (
    <div className="operator-mobile qc-workspace">
      <aside className="qc-workspace__queue" aria-label={t('queue.title')}>
        <QcQueuePanel
          queue={queue}
          selectedOperationId={operationId}
          onSelect={(row) => navigate(`/qc/sampling/${row.operationId}`)}
        />
      </aside>
      <section className="qc-workspace__entry">
        {operationId == null ? (
          <div className="qc-workspace__empty">
            <p className="qc-workspace__empty-title">{t('workspace.selectTitle')}</p>
            <p className="qc-muted">{t('workspace.selectHint')}</p>
          </div>
        ) : (
          <QcSamplingEntry
            key={operationId}
            operationId={operationId}
            embedded
            onBack={clearSelection}
            onSaved={queue.reload}
            onFinalSaved={clearSelection}
          />
        )}
      </section>
    </div>
  )
}
