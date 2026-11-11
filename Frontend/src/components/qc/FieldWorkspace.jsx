import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRbac } from '../../context/RbacContext'
import QcQueuePanel from './QcQueuePanel'

/**
 * Desktop field menu: queue on the left, the entry for the selected SI on the right.
 * The selection lives in the URL (`${basePath}/:operationId`), so it survives reloads and resizes.
 * Rendered with the `operator-mobile` class so the shared field styles apply inside `Layout`.
 *
 * @param {object} props
 * @param {(args: { operationId: number, clearSelection: () => void }) => JSX.Element} props.renderEntry
 */
export default function FieldWorkspace({ pageKey, basePath, operationId, queue, renderDetail, renderEntry }) {
  const navigate = useNavigate()
  const { t } = useTranslation(queue.ns)
  const { loading: rbacLoading, canView } = useRbac()

  if (rbacLoading) return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  if (!canView(pageKey)) {
    return <p className="operator-error-banner">{t('queue.noAccess')}</p>
  }

  const clearSelection = () => navigate(basePath)

  return (
    <div className="operator-mobile qc-workspace">
      <aside className="qc-workspace__queue" aria-label={t('queue.title')}>
        <QcQueuePanel
          queue={queue}
          selectedOperationId={operationId}
          onSelect={(row) => navigate(`${basePath}/${row.operationId}`)}
          renderDetail={renderDetail}
        />
      </aside>
      <section className="qc-workspace__entry">
        {operationId == null ? (
          <div className="qc-workspace__empty">
            <p className="qc-workspace__empty-title">{t('workspace.selectTitle')}</p>
            <p className="qc-muted">{t('workspace.selectHint')}</p>
          </div>
        ) : (
          renderEntry({ operationId, clearSelection })
        )}
      </section>
    </div>
  )
}
